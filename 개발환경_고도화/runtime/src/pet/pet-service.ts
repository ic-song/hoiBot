import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { positiveInteger } from "../shared/numeric-policy.js";
import { TransactionalOperationRunner, type OperationActor } from "../shared/transactional-operation.js";

interface PetCommandBase {
  playerId: string; reason: string; idempotencyKey: string; actor: OperationActor;
  sourceCode: "admin_api" | "iris" | "discord" | "external_api" | "system";
}

// 펫 경험치·스킬·타이틀 상태를 소유권 검증 후 원자적으로 변경합니다.
export class PetService {
  private readonly operations: TransactionalOperationRunner;
  constructor(database: DatabaseClient) { this.operations = new TransactionalOperationRunner(database); }

  async gainExperience(command: PetCommandBase & { amount: string; expectedVersion: string }): Promise<{ experience: string; version: string; auditId: string }> {
    const amount = positiveInteger(command.amount, "amount");
    return this.operations.run({ scope: `pet.experience:${command.playerId}`, idempotencyKey: command.idempotencyKey, actor: command.actor,
      sourceCode: command.sourceCode, actionCode: "pet.experience.gain", targetType: "player", targetId: command.playerId,
      reason: command.reason, outboxType: "pet.changed" }, async (transaction) => {
      const rows = await transaction.query<Array<{ id: bigint; experience: bigint; version: bigint }>>("SELECT id, experience, version FROM player_pets WHERE player_id = ? FOR UPDATE", [command.playerId]);
      const pet = rows[0]; if (pet === undefined) throw new ApplicationError("PET_NOT_FOUND", "회원의 펫을 찾을 수 없습니다.", 404);
      if (pet.version.toString() !== command.expectedVersion) throw new ApplicationError("PET_VERSION_CONFLICT", "펫 정보가 먼저 변경되었습니다.", 409);
      const experience = pet.experience + amount; const version = pet.version + 1n;
      await transaction.execute("UPDATE player_pets SET experience = ?, version = ? WHERE id = ? AND version = ?", [experience, version, pet.id, pet.version]);
      return { result: { experience: experience.toString(), version: version.toString() }, changeSummary: { amount: amount.toString(), experience: experience.toString() } };
    });
  }

  async equipSkill(command: PetCommandBase & { slotNo: string; skillCode: string; level: string; expectedVersion: string }): Promise<{ slotNo: string; skillCode: string; version: string; auditId: string }> {
    const slotNo = positiveInteger(command.slotNo, "slotNo"); const level = positiveInteger(command.level, "level");
    if (slotNo > 20n) throw new ApplicationError("INVALID_SKILL_SLOT", "스킬 슬롯 범위를 벗어났습니다.", 422);
    return this.operations.run({ scope: `pet.skill:${command.playerId}:${slotNo}`, idempotencyKey: command.idempotencyKey, actor: command.actor,
      sourceCode: command.sourceCode, actionCode: "pet.skill.equip", targetType: "player", targetId: command.playerId,
      reason: command.reason, outboxType: "pet.changed" }, async (transaction) => {
      const pets = await transaction.query<Array<{ id: bigint; version: bigint }>>("SELECT id, version FROM player_pets WHERE player_id = ? FOR UPDATE", [command.playerId]);
      const pet = pets[0]; if (pet === undefined) throw new ApplicationError("PET_NOT_FOUND", "회원의 펫을 찾을 수 없습니다.", 404);
      if (pet.version.toString() !== command.expectedVersion) throw new ApplicationError("PET_VERSION_CONFLICT", "펫 정보가 먼저 변경되었습니다.", 409);
      const skills = await transaction.query<Array<{ id: bigint }>>("SELECT id FROM skill_definitions WHERE code = ? AND active = TRUE", [command.skillCode]);
      if (skills[0] === undefined) throw new ApplicationError("SKILL_NOT_FOUND", "사용 가능한 스킬을 찾을 수 없습니다.", 404);
      await transaction.execute(`INSERT INTO pet_skills (player_pet_id, slot_no, skill_id, level, equipped) VALUES (?, ?, ?, ?, TRUE)
        ON DUPLICATE KEY UPDATE skill_id = VALUES(skill_id), level = VALUES(level), equipped = TRUE`, [pet.id, slotNo, skills[0].id, level]);
      const version = pet.version + 1n;
      await transaction.execute("UPDATE player_pets SET version = ? WHERE id = ? AND version = ?", [version, pet.id, pet.version]);
      return { result: { slotNo: slotNo.toString(), skillCode: command.skillCode, version: version.toString() }, changeSummary: { slotNo: slotNo.toString(), skillCode: command.skillCode, level: level.toString() } };
    });
  }

  async equipTitle(command: PetCommandBase & { titleCode: string; target: "player" | "pet" }): Promise<{ titleCode: string; target: string; auditId: string }> {
    return this.operations.run({ scope: `title.equip:${command.target}:${command.playerId}`, idempotencyKey: command.idempotencyKey, actor: command.actor,
      sourceCode: command.sourceCode, actionCode: `${command.target}.title.equip`, targetType: "player", targetId: command.playerId,
      reason: command.reason, outboxType: "title.changed" }, async (transaction) => {
      await transaction.query("SELECT id FROM players WHERE id = ? AND status = 'active' FOR UPDATE", [command.playerId]);
      const titles = await transaction.query<Array<{ id: bigint }>>("SELECT id FROM title_definitions WHERE code = ? AND scope_code = ? AND active = TRUE", [command.titleCode, command.target]);
      if (titles[0] === undefined) throw new ApplicationError("TITLE_NOT_FOUND", "사용 가능한 타이틀을 찾을 수 없습니다.", 404);
      if (command.target === "player") {
        const owned = await transaction.query<Array<{ title_id: bigint }>>("SELECT title_id FROM player_titles WHERE player_id = ? AND title_id = ?", [command.playerId, titles[0].id]);
        if (owned[0] === undefined) throw new ApplicationError("TITLE_NOT_OWNED", "보유한 타이틀이 아닙니다.", 409);
        await transaction.execute("UPDATE player_titles SET equipped = (title_id = ?) WHERE player_id = ?", [titles[0].id, command.playerId]);
      } else {
        const pets = await transaction.query<Array<{ id: bigint }>>("SELECT id FROM player_pets WHERE player_id = ?", [command.playerId]);
        if (pets[0] === undefined) throw new ApplicationError("PET_NOT_FOUND", "회원의 펫을 찾을 수 없습니다.", 404);
        const owned = await transaction.query<Array<{ title_id: bigint }>>("SELECT title_id FROM pet_titles WHERE player_pet_id = ? AND title_id = ?", [pets[0].id, titles[0].id]);
        if (owned[0] === undefined) throw new ApplicationError("TITLE_NOT_OWNED", "펫이 보유한 타이틀이 아닙니다.", 409);
        await transaction.execute("UPDATE pet_titles SET equipped = (title_id = ?) WHERE player_pet_id = ?", [titles[0].id, pets[0].id]);
      }
      return { result: { titleCode: command.titleCode, target: command.target }, changeSummary: { titleCode: command.titleCode, target: command.target } };
    });
  }

  async equipInventory(command: PetCommandBase & { slotCode: string; instanceId: string; expectedPetVersion: string; expectedInstanceVersion: string }): Promise<{ slotCode: string; instanceId: string; petVersion: string; auditId: string }> {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(command.slotCode)) throw new ApplicationError("INVALID_EQUIPMENT_SLOT", "장비 슬롯 코드는 영문 소문자 코드여야 합니다.", 422);
    positiveInteger(command.instanceId, "instanceId");
    return this.operations.run({ scope: `pet.equipment:${command.playerId}:${command.slotCode}`, idempotencyKey: command.idempotencyKey, actor: command.actor,
      sourceCode: command.sourceCode, actionCode: "pet.equipment.equip", targetType: "player", targetId: command.playerId,
      reason: command.reason, outboxType: "pet.changed" }, async (transaction) => {
      const pets = await transaction.query<Array<{ id: bigint; version: bigint }>>("SELECT id, version FROM player_pets WHERE player_id = ? FOR UPDATE", [command.playerId]);
      const pet = pets[0]; if (pet === undefined) throw new ApplicationError("PET_NOT_FOUND", "회원의 펫을 찾을 수 없습니다.", 404);
      if (pet.version.toString() !== command.expectedPetVersion) throw new ApplicationError("PET_VERSION_CONFLICT", "펫 정보가 먼저 변경되었습니다.", 409);
      const instances = await transaction.query<Array<{ version: bigint; status: string; player_id: bigint }>>("SELECT version, status, player_id FROM inventory_instances WHERE id = ? FOR UPDATE", [command.instanceId]);
      const instance = instances[0];
      if (instance === undefined || instance.player_id.toString() !== command.playerId || instance.status !== "owned") throw new ApplicationError("INSTANCE_NOT_OWNED", "장착할 아이템을 소유하고 있지 않습니다.", 409);
      if (instance.version.toString() !== command.expectedInstanceVersion) throw new ApplicationError("INVENTORY_VERSION_CONFLICT", "장비 정보가 먼저 변경되었습니다.", 409);
      await transaction.execute("DELETE FROM pet_equipment WHERE player_pet_id = ? AND (slot_code = ? OR inventory_instance_id = ?)", [pet.id, command.slotCode, command.instanceId]);
      await transaction.execute("INSERT INTO pet_equipment (player_pet_id, slot_code, inventory_instance_id) VALUES (?, ?, ?)", [pet.id, command.slotCode, command.instanceId]);
      const version = pet.version + 1n;
      await transaction.execute("UPDATE player_pets SET version = ? WHERE id = ? AND version = ?", [version, pet.id, pet.version]);
      return { result: { slotCode: command.slotCode, instanceId: command.instanceId, petVersion: version.toString() }, changeSummary: { slotCode: command.slotCode, instanceId: command.instanceId } };
    });
  }
}
