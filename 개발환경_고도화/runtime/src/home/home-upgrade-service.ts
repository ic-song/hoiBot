import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";

export type HomeUpgradeCommandCode = "home_upgrade_preview" | "home_upgrade_execute" | "home_upgrade_cancel";

export interface HomeUpgradeInput {
  externalUserId: string;
  channelId: string;
  message: string;
  eventId: string;
}

export interface HomeUpgradeResult {
  status: "completed" | "rejected" | "ignored";
  data?: string;
  outboxId?: string;
  auditId?: string;
}

interface ActorRow { identity_id: bigint; player_id: bigint; }
interface ContextRow { pet_id: bigint | null; pet_version: bigint | null; current_floor: bigint; home_version: bigint | null; }
interface DefinitionRow { id: bigint; floor_area: bigint; display_name: string; experience_reward: bigint; version: bigint; }
interface RequirementRow { item_id: bigint; item_code: string; display_name: string; required_quantity: bigint; current_quantity: bigint; stack_version: bigint | null; }
interface ConfirmationRow { id: bigint; definition_id: bigint; definition_version: bigint; status: string; expired: bigint | number; version: bigint; }

// 집 업그레이드 명령의 exact 별칭만 분류합니다.
export function parseHomeUpgradeCommand(message: string | null | undefined): HomeUpgradeCommandCode | null {
  if (message === "/집짓기") return "home_upgrade_preview";
  if (message === "/집뚝딱" || message === "집뚝딱") return "home_upgrade_execute";
  if (message === "/생각해본다" || message === "생각해본다") return "home_upgrade_cancel";
  return null;
}

// 공용 dispatch가 유사 접두 명령을 소비하지 않도록 exact parser만 사용합니다.
export function isHomeUpgradeCommandCandidate(message: string | null | undefined): boolean {
  return parseHomeUpgradeCommand(message) !== null;
}

// 긴 event ID를 operation idempotency key 범위로 정규화합니다.
function normalizeEventKey(eventId: string): string {
  return eventId.length <= 191 ? eventId : `sha256:${createHash("sha256").update(eventId).digest("hex")}`;
}

// DB에 저장된 재시도 결과를 복원합니다.
function parseStoredResult(value: string | HomeUpgradeResult): HomeUpgradeResult {
  return typeof value === "string" ? JSON.parse(value) as HomeUpgradeResult : value;
}

// 업그레이드 응답과 실행·감사·outbox 근거를 transaction 안에서 완료합니다.
async function complete(
  tx: DatabaseTransaction,
  operationId: bigint,
  actor: ActorRow,
  input: HomeUpgradeInput,
  commandCode: HomeUpgradeCommandCode,
  data: string,
  resultCode: "success" | "rejected",
  changeSummary: Record<string, unknown>
): Promise<HomeUpgradeResult> {
  const outbox = await tx.execute(
    `INSERT INTO outbox_messages
      (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at)
     VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [operationId, input.channelId, JSON.stringify({ data })]
  );
  await tx.execute(
    `INSERT INTO command_executions
      (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at)
     VALUES (?, ?, ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [input.eventId, commandCode, operationId]
  );
  const audit = await tx.execute(
    `INSERT INTO command_audit
      (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at)
     VALUES (?, 'external_identity', ?, 'player_home', ?, ?, ?, 'Iris home upgrade command', ?, UTC_TIMESTAMP(3))`,
    [operationId, actor.identity_id, actor.player_id, commandCode.replaceAll("_", "."), resultCode, JSON.stringify(changeSummary)]
  );
  const result: HomeUpgradeResult = {
    status: resultCode === "success" ? "completed" : "rejected",
    data,
    outboxId: outbox.insertId.toString(),
    auditId: audit.insertId.toString()
  };
  await tx.execute(
    "UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?",
    [JSON.stringify(result), operationId]
  );
  return result;
}

// 집 업그레이드 preview, 실행, 취소를 재시작 가능한 DB transaction으로 처리합니다.
export class HomeUpgradeService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(input: HomeUpgradeInput): Promise<HomeUpgradeResult> {
    const commandCode = parseHomeUpgradeCommand(input.message);
    if (commandCode === null) return { status: "ignored" };
    return this.database.withTransaction(async (tx) => {
      const actors = await tx.query<ActorRow[]>(
        `SELECT identity.id AS identity_id, identity.player_id
         FROM external_identities identity
         WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ?
           AND identity.status = 'linked' AND identity.player_id IS NOT NULL FOR UPDATE`,
        [input.externalUserId]
      );
      const actor = actors[0];
      if (actor === undefined) return { status: "ignored" };
      const scope = `home.upgrade:${commandCode}:${actor.identity_id}`;
      const eventKey = normalizeEventKey(input.eventId);
      const prior = await tx.query<Array<{ result_json: string | HomeUpgradeResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE",
        [scope, eventKey]
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) return parseStoredResult(prior[0].result_json);
      const operation = await tx.execute(
        `INSERT INTO operations
          (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, created_at)
         VALUES (?, ?, ?, 'external_identity', ?, 'iris', 'processing', UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, eventKey, actor.identity_id]
      );
      if (commandCode === "home_upgrade_preview") return this.preview(tx, operation.insertId, actor, input, commandCode);
      if (commandCode === "home_upgrade_execute") return this.execute(tx, operation.insertId, actor, input, commandCode);
      return this.cancel(tx, operation.insertId, actor, input, commandCode);
    });
  }

  private async preview(tx: DatabaseTransaction, operationId: bigint, actor: ActorRow, input: HomeUpgradeInput, commandCode: HomeUpgradeCommandCode): Promise<HomeUpgradeResult> {
    const context = (await tx.query<ContextRow[]>(
      `SELECT pet.id AS pet_id, pet.version AS pet_version,
              COALESCE(home.floor_area, 0) AS current_floor, home.version AS home_version
       FROM players player
       LEFT JOIN player_pets pet ON pet.player_id = player.id
       LEFT JOIN player_homes home ON home.player_id = player.id
       WHERE player.id = ? FOR UPDATE`, [actor.player_id]
    ))[0];
    if (context?.pet_id === null || context?.pet_id === undefined) {
      return complete(tx, operationId, actor, input, commandCode, "펫을 먼저 생성해주세요.", "rejected", { reason: "pet_required" });
    }
    const definition = (await tx.query<DefinitionRow[]>(
      `SELECT id, floor_area, display_name, experience_reward, version FROM home_upgrade_definitions
       WHERE floor_area = ? AND active = TRUE FOR UPDATE`, [context.current_floor + 1n]
    ))[0];
    if (definition === undefined) {
      return complete(tx, operationId, actor, input, commandCode, "이미 최고 단계의 집입니다.", "rejected", { reason: "max_floor" });
    }
    const requirements = await this.requirements(tx, actor.player_id, definition.id);
    const missing = requirements.filter((row) => row.current_quantity < row.required_quantity);
    if (missing.length > 0) {
      const data = "집을 짓기 위한 재료가 부족합니다.\n" + missing.map((row) => `${row.display_name}: ${row.current_quantity}/${row.required_quantity}`).join("\n");
      return complete(tx, operationId, actor, input, commandCode, data, "rejected", { reason: "materials_required" });
    }
    await tx.execute(
      `INSERT INTO home_upgrade_confirmations
        (player_id, definition_id, definition_version, required_snapshot_json, status, source_event_id, expires_at, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 15 MINUTE), 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE definition_id = VALUES(definition_id), definition_version = VALUES(definition_version),
         required_snapshot_json = VALUES(required_snapshot_json), status = 'pending', source_event_id = VALUES(source_event_id),
         expires_at = VALUES(expires_at), consumed_at = NULL, version = version + 1, updated_at = UTC_TIMESTAMP(3)`,
      [actor.player_id, definition.id, definition.version, JSON.stringify(requirements.map((row) => ({ itemCode: row.item_code, quantity: row.required_quantity.toString() }))), normalizeEventKey(input.eventId)]
    );
    const data = `${definition.display_name} 단계로 집을 지을 수 있습니다.\n진행: /집뚝딱\n보류: /생각해본다`;
    return complete(tx, operationId, actor, input, commandCode, data, "success", { definitionId: definition.id.toString(), targetFloor: definition.floor_area.toString() });
  }

  private async execute(tx: DatabaseTransaction, operationId: bigint, actor: ActorRow, input: HomeUpgradeInput, commandCode: HomeUpgradeCommandCode): Promise<HomeUpgradeResult> {
    const confirmation = (await tx.query<ConfirmationRow[]>(
      `SELECT id, definition_id, definition_version, status, expires_at < UTC_TIMESTAMP(3) AS expired, version
       FROM home_upgrade_confirmations WHERE player_id = ? FOR UPDATE`, [actor.player_id]
    ))[0];
    if (confirmation === undefined || confirmation.status !== "pending") {
      return complete(tx, operationId, actor, input, commandCode, "진행 중인 집 업그레이드가 없습니다.", "rejected", { reason: "pending_required" });
    }
    if (Boolean(confirmation.expired)) {
      await tx.execute("UPDATE home_upgrade_confirmations SET status = 'expired', version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ? AND version = ?", [confirmation.id, confirmation.version]);
      return complete(tx, operationId, actor, input, commandCode, "집 업그레이드 확인 시간이 만료되었습니다. /집짓기로 다시 확인해주세요.", "rejected", { reason: "pending_expired" });
    }
    const definition = (await tx.query<DefinitionRow[]>(
      "SELECT id, floor_area, display_name, experience_reward, version FROM home_upgrade_definitions WHERE id = ? AND active = TRUE FOR UPDATE",
      [confirmation.definition_id]
    ))[0];
    const context = (await tx.query<ContextRow[]>(
      `SELECT pet.id AS pet_id, pet.version AS pet_version,
              COALESCE(home.floor_area, 0) AS current_floor, home.version AS home_version
       FROM players player LEFT JOIN player_pets pet ON pet.player_id = player.id
       LEFT JOIN player_homes home ON home.player_id = player.id WHERE player.id = ? FOR UPDATE`, [actor.player_id]
    ))[0];
    if (definition === undefined || BigInt(definition.version) !== BigInt(confirmation.definition_version) || context?.pet_id === null
      || context?.pet_id === undefined || BigInt(context.current_floor) + 1n !== BigInt(definition.floor_area)) {
      await tx.execute("UPDATE home_upgrade_confirmations SET status = 'invalidated', version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ?", [confirmation.id]);
      return complete(tx, operationId, actor, input, commandCode, "집 또는 펫 정보가 변경되었습니다. /집짓기로 다시 확인해주세요.", "rejected", { reason: "stale_confirmation" });
    }
    const requirements = await this.requirements(tx, actor.player_id, definition.id);
    if (requirements.some((row) => row.current_quantity < row.required_quantity)) {
      await tx.execute("UPDATE home_upgrade_confirmations SET status = 'invalidated', version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ?", [confirmation.id]);
      return complete(tx, operationId, actor, input, commandCode, "집을 짓기 위한 재료가 부족합니다.", "rejected", { reason: "materials_changed" });
    }
    let sequence = 0;
    for (const row of requirements) {
      const requiredQuantity = BigInt(row.required_quantity);
      const after = BigInt(row.current_quantity) - requiredQuantity;
      const write = await tx.execute(
        "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
        [after, actor.player_id, row.item_id, row.stack_version]
      );
      if (write.affectedRows !== 1n) throw new Error("HOME_UPGRADE_INVENTORY_CONFLICT");
      sequence += 1;
      await tx.execute(
        "INSERT INTO inventory_ledger (operation_id, sequence_no, player_id, item_id, quantity_delta, reason_code) VALUES (?, ?, ?, ?, ?, 'home_upgrade')",
        [operationId, sequence, actor.player_id, row.item_id, -requiredQuantity]
      );
    }
    if (context.home_version === null) {
      await tx.execute(
        "INSERT INTO player_homes (player_id, display_name, base_experience, floor_area, version) VALUES (?, ?, ?, ?, 1)",
        [actor.player_id, definition.display_name, definition.experience_reward, definition.floor_area]
      );
    } else {
      const homeWrite = await tx.execute(
        "UPDATE player_homes SET display_name = ?, base_experience = base_experience + ?, floor_area = ?, version = version + 1 WHERE player_id = ? AND version = ?",
        [definition.display_name, definition.experience_reward, definition.floor_area, actor.player_id, context.home_version]
      );
      if (homeWrite.affectedRows !== 1n) throw new Error("HOME_UPGRADE_HOME_CONFLICT");
    }
    const petWrite = await tx.execute(
      "UPDATE player_pets SET experience = experience + ?, version = version + 1 WHERE id = ? AND version = ?",
      [definition.experience_reward, context.pet_id, context.pet_version]
    );
    if (petWrite.affectedRows !== 1n) throw new Error("HOME_UPGRADE_PET_CONFLICT");
    await tx.execute(
      "UPDATE home_upgrade_confirmations SET status = 'consumed', consumed_at = UTC_TIMESTAMP(3), version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ? AND version = ?",
      [confirmation.id, confirmation.version]
    );
    return complete(tx, operationId, actor, input, commandCode, `${definition.display_name} 집짓기가 완료되었습니다!`, "success", {
      definitionId: definition.id.toString(), floorArea: definition.floor_area.toString(), experience: definition.experience_reward.toString(), materials: requirements.length
    });
  }

  private async cancel(tx: DatabaseTransaction, operationId: bigint, actor: ActorRow, input: HomeUpgradeInput, commandCode: HomeUpgradeCommandCode): Promise<HomeUpgradeResult> {
    const rows = await tx.query<Array<{ id: bigint; version: bigint }>>(
      "SELECT id, version FROM home_upgrade_confirmations WHERE player_id = ? AND status = 'pending' FOR UPDATE", [actor.player_id]
    );
    const pending = rows[0];
    if (pending === undefined) {
      return complete(tx, operationId, actor, input, commandCode, "보류할 집 업그레이드가 없습니다.", "rejected", { reason: "pending_required" });
    }
    await tx.execute(
      "UPDATE home_upgrade_confirmations SET status = 'cancelled', version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ? AND version = ?",
      [pending.id, pending.version]
    );
    return complete(tx, operationId, actor, input, commandCode, "집 업그레이드를 보류했습니다.", "success", { confirmationId: pending.id.toString() });
  }

  private async requirements(tx: DatabaseTransaction, playerId: bigint, definitionId: bigint): Promise<RequirementRow[]> {
    return tx.query<RequirementRow[]>(
      `SELECT req.item_id, item.code AS item_code, item.display_name, req.quantity AS required_quantity,
              COALESCE(stack.quantity, 0) AS current_quantity, stack.version AS stack_version
       FROM home_upgrade_requirements req JOIN item_definitions item ON item.id = req.item_id
       LEFT JOIN inventory_stacks stack ON stack.player_id = ? AND stack.item_id = req.item_id
       WHERE req.definition_id = ? ORDER BY req.item_id FOR UPDATE`, [playerId, definitionId]
    );
  }
}
