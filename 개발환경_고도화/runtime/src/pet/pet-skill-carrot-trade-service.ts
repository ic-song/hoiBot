import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

export const PET_SKILL_CARROT_CODE = "ITEM-RWD-044";
export const PET_SKILL_CARROT_THERMOMETER_CODE = "pet_skill_carrot_thermometer";
export const PET_SKILL_CARROT_BAG_LIMIT = 100n;
export const PET_SKILL_CARROT_FEE_PER_SKILL = 50n;
export const PET_SKILL_CARROT_THERMOMETER_REWARD = 2n;
const UINT64_MAX = 18446744073709551615n;

export interface PetSkillCarrotTradeCommand {
  targetName: string;
  sourceIndex: bigint;
  quantity: bigint;
}

export interface PetSkillCarrotTradeResult {
  reply: string;
  outboxId: string;
  senderPlayerId: string;
  recipientPlayerId: string;
  skillId: string;
  quantity: string;
  carrotFee: string;
  thermometerReward: string;
}

interface PlayerRow {
  player_id: bigint;
  current_display_name: string;
  tier_code: string | null;
  rank_emoji: string | null;
}

interface SkillInventoryRow {
  skill_id: bigint;
  display_name: string;
  quantity: bigint;
  version: bigint;
}

// 레거시 outer guard처럼 명령어 뒤에 인자가 있는 입력만 후보로 분류합니다.
export function isPetSkillCarrotTradeCandidate(message: string | undefined): boolean {
  return message?.startsWith("/펫스킬당근 ") === true;
}

// 공백 포함 닉네임과 양의 uint64 가방 번호·수량을 완전 일치 패턴으로 해석합니다.
export function parsePetSkillCarrotTrade(message: string): PetSkillCarrotTradeCommand | null {
  const match = /^\/펫스킬당근\s+(.+)\s+([1-9]\d*)\s+([1-9]\d*)$/.exec(message);
  if (match === null) return null;
  const targetName = match[1]!.trim();
  const sourceIndex = BigInt(match[2]!);
  const quantity = BigInt(match[3]!);
  if (targetName === "" || sourceIndex > UINT64_MAX || quantity > UINT64_MAX / PET_SKILL_CARROT_FEE_PER_SKILL) return null;
  return { targetName, sourceIndex, quantity };
}

// 유효한 인자 명령을 DB 대표 alias로 정규화합니다.
export function normalizePetSkillCarrotTradeDispatchMessage(message: string): string {
  return parsePetSkillCarrotTrade(message) === null ? message : "/펫스킬당근 [받을유저닉] [가방번호] [수량]";
}

function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function eligibleTier(value: string | null): boolean {
  return value !== null && ["king", "emperor", "god"].includes(value.toLowerCase());
}

// 펫스킬 이전과 당근 수수료·온도기·누적 카운터·감사 답장을 한 트랜잭션으로 저장합니다.
export class PetSkillCarrotTradeService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<PetSkillCarrotTradeResult> {
    const command = parsePetSkillCarrotTrade(input.message);
    if (command === null) {
      throw new ApplicationError("INVALID_PET_SKILL_CARROT_TRADE", "사용법: /펫스킬당근 [받을유저닉] [가방번호] [수량]", 422);
    }
    return this.database.withTransaction(async (transaction) => {
      const identity = (await transaction.query<Array<{ identity_id: bigint; player_id: bigint }>>(
        `SELECT identity_row.id identity_id,identity_row.player_id
         FROM external_identities identity_row JOIN players player ON player.id=identity_row.player_id
         WHERE identity_row.provider_code='kakao' AND identity_row.external_user_id=? AND identity_row.status='linked'
         AND player.status='active' AND player.deleted_at IS NULL LIMIT 1`, [input.externalUserId],
      ))[0];
      if (identity === undefined) throw new ApplicationError("PLAYER_IDENTITY_REQUIRED", "가입된 회원 정보를 찾을 수 없습니다.", 409);

      const key = eventKey(input.eventId);
      const prior = await transaction.query<Array<{ result_json: string | PetSkillCarrotTradeResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope='pet.skill_carrot_trade' AND idempotency_key=? FOR UPDATE", [key],
      );
      if (prior[0]?.result_json != null) {
        return typeof prior[0].result_json === "string" ? JSON.parse(prior[0].result_json) as PetSkillCarrotTradeResult : prior[0].result_json;
      }
      const operation = await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'pet.skill_carrot_trade',?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), key, identity.identity_id],
      );

      const target = (await transaction.query<Array<{ player_id: bigint }>>(
        `SELECT profile.player_id FROM player_profiles profile JOIN players player ON player.id=profile.player_id
         WHERE profile.current_display_name=? AND player.status='active' AND player.deleted_at IS NULL ORDER BY profile.player_id LIMIT 1`, [command.targetName],
      ))[0];
      if (target === undefined) throw new ApplicationError("PET_SKILL_CARROT_TARGET_REQUIRED", "거래 대상 유저를 찾을 수 없습니다.", 409);
      if (target.player_id === identity.player_id) throw new ApplicationError("PET_SKILL_CARROT_SELF_TRADE", "자기 자신에게는 펫스킬을 보낼 수 없습니다.", 409);

      const lockedPlayers = await transaction.query<PlayerRow[]>(
        `SELECT player.id player_id,profile.current_display_name,profile.tier_code,rank_profile.rank_emoji
         FROM players player JOIN player_profiles profile ON profile.player_id=player.id
         LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=player.id
         WHERE player.id IN (?,?) ORDER BY player.id FOR UPDATE`, [identity.player_id, target.player_id],
      );
      const sender = lockedPlayers.find((row) => row.player_id === identity.player_id);
      const recipient = lockedPlayers.find((row) => row.player_id === target.player_id);
      if (sender === undefined || recipient === undefined) throw new ApplicationError("PET_SKILL_CARROT_PLAYER_REQUIRED", "거래 회원 정보를 찾을 수 없습니다.", 409);
      if (!eligibleTier(sender.tier_code)) throw new ApplicationError("PET_SKILL_CARROT_SENDER_TIER_REQUIRED", `❌[${sender.rank_emoji ?? ""}${sender.current_display_name}]님 펫스킬 당근거래는 티어 👑킹 이상부터 가능합니다.`, 409);
      if (!eligibleTier(recipient.tier_code)) throw new ApplicationError("PET_SKILL_CARROT_RECIPIENT_TIER_REQUIRED", `❌[${recipient.rank_emoji ?? ""}${recipient.current_display_name}]님은 티어 👑킹 미만이라 펫스킬을 받을 수 없습니다.`, 409);

      const pets = await transaction.query<Array<{ id: bigint; player_id: bigint }>>(
        "SELECT id,player_id FROM player_pets WHERE player_id IN (?,?) ORDER BY player_id FOR UPDATE", [sender.player_id, recipient.player_id],
      );
      const senderPet = pets.find((row) => row.player_id === sender.player_id);
      const recipientPet = pets.find((row) => row.player_id === recipient.player_id);
      if (senderPet === undefined || recipientPet === undefined) throw new ApplicationError("PET_SKILL_CARROT_PET_REQUIRED", "거래하려면 양쪽 모두 등록된 펫이 필요합니다.", 409);

      const senderSkills = await transaction.query<SkillInventoryRow[]>(
        `SELECT inventory.skill_id,definition.display_name,inventory.quantity,inventory.version
         FROM pet_skill_inventory inventory JOIN skill_definitions definition ON definition.id=inventory.skill_id AND definition.active=TRUE
         WHERE inventory.player_pet_id=? AND inventory.quantity>0 ORDER BY definition.display_name,definition.id FOR UPDATE`, [senderPet.id],
      );
      const selected = command.sourceIndex > BigInt(senderSkills.length) ? undefined : senderSkills[Number(command.sourceIndex - 1n)];
      if (selected === undefined) throw new ApplicationError("PET_SKILL_CARROT_SKILL_REQUIRED", "해당 번호의 펫스킬이 존재하지 않습니다.", 409);
      if (selected.quantity < command.quantity) throw new ApplicationError("PET_SKILL_CARROT_QUANTITY_REQUIRED", "보유한 펫스킬 수량이 부족합니다.", 409);

      const recipientSkills = await transaction.query<Array<{ skill_id: bigint; quantity: bigint; version: bigint }>>(
        "SELECT skill_id,quantity,version FROM pet_skill_inventory WHERE player_pet_id=? ORDER BY skill_id FOR UPDATE", [recipientPet.id],
      );
      const recipientTotal = recipientSkills.reduce((sum, row) => sum + BigInt(row.quantity), 0n);
      if (recipientTotal + command.quantity > PET_SKILL_CARROT_BAG_LIMIT) throw new ApplicationError("PET_SKILL_CARROT_TARGET_BAG_FULL", "상대 펫스킬가방 공간이 부족합니다.", 409);
      const recipientSkill = recipientSkills.find((row) => row.skill_id === selected.skill_id);

      const items = await transaction.query<Array<{ id: bigint; code: string }>>(
        "SELECT id,code FROM item_definitions WHERE code IN (?,?) AND active=TRUE AND stackable=TRUE ORDER BY id",
        [PET_SKILL_CARROT_CODE, PET_SKILL_CARROT_THERMOMETER_CODE],
      );
      const carrotItem = items.find((row) => row.code === PET_SKILL_CARROT_CODE);
      const thermometerItem = items.find((row) => row.code === PET_SKILL_CARROT_THERMOMETER_CODE);
      if (carrotItem === undefined || thermometerItem === undefined) throw new ApplicationError("PET_SKILL_CARROT_ITEM_REQUIRED", "펫스킬 당근거래 아이템 설정을 찾을 수 없습니다.", 409);
      const carrot = (await transaction.query<Array<{ quantity: bigint; version: bigint }>>(
        "SELECT quantity,version FROM inventory_stacks WHERE player_id=? AND item_id=? FOR UPDATE", [sender.player_id, carrotItem.id],
      ))[0];
      const thermometer = (await transaction.query<Array<{ quantity: bigint; version: bigint }>>(
        "SELECT quantity,version FROM inventory_stacks WHERE player_id=? AND item_id=? FOR UPDATE", [recipient.player_id, thermometerItem.id],
      ))[0];
      const carrotFee = command.quantity * PET_SKILL_CARROT_FEE_PER_SKILL;
      if (carrot === undefined || carrot.quantity < carrotFee) throw new ApplicationError("PET_SKILL_CARROT_FEE_REQUIRED", `펫스킬 당근거래 수수료 당근🥕 ${carrotFee}개가 부족합니다.`, 409);

      const senderSkillAfter = selected.quantity - command.quantity;
      const recipientSkillAfter = BigInt(recipientSkill?.quantity ?? 0n) + command.quantity;
      const senderChanged = await transaction.execute(
        "UPDATE pet_skill_inventory SET quantity=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_pet_id=? AND skill_id=? AND version=?",
        [senderSkillAfter, senderPet.id, selected.skill_id, selected.version],
      );
      if (senderChanged.affectedRows !== 1n) throw new ApplicationError("PET_SKILL_CARROT_CONFLICT", "펫스킬가방이 먼저 변경되었습니다.", 409);
      if (recipientSkill === undefined) {
        await transaction.execute("INSERT INTO pet_skill_inventory(player_pet_id,skill_id,quantity,version,updated_at) VALUES (?,?,?,1,UTC_TIMESTAMP(3))", [recipientPet.id, selected.skill_id, command.quantity]);
      } else {
        const recipientChanged = await transaction.execute(
          "UPDATE pet_skill_inventory SET quantity=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_pet_id=? AND skill_id=? AND version=?",
          [recipientSkillAfter, recipientPet.id, selected.skill_id, recipientSkill.version],
        );
        if (recipientChanged.affectedRows !== 1n) throw new ApplicationError("PET_SKILL_CARROT_CONFLICT", "상대 펫스킬가방이 먼저 변경되었습니다.", 409);
      }
      const carrotChanged = await transaction.execute(
        "UPDATE inventory_stacks SET quantity=quantity-?,version=version+1 WHERE player_id=? AND item_id=? AND version=?",
        [carrotFee, sender.player_id, carrotItem.id, carrot.version],
      );
      if (carrotChanged.affectedRows !== 1n) throw new ApplicationError("PET_SKILL_CARROT_CONFLICT", "당근 보유량이 먼저 변경되었습니다.", 409);
      if (thermometer === undefined) {
        await transaction.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,?,1)", [recipient.player_id, thermometerItem.id, PET_SKILL_CARROT_THERMOMETER_REWARD]);
      } else {
        const thermometerChanged = await transaction.execute(
          "UPDATE inventory_stacks SET quantity=quantity+?,version=version+1 WHERE player_id=? AND item_id=? AND version=?",
          [PET_SKILL_CARROT_THERMOMETER_REWARD, recipient.player_id, thermometerItem.id, thermometer.version],
        );
        if (thermometerChanged.affectedRows !== 1n) throw new ApplicationError("PET_SKILL_CARROT_CONFLICT", "당근온도기가 먼저 변경되었습니다.", 409);
      }
      await transaction.execute(
        "INSERT INTO player_counters(player_id,counter_code,period_key,value,updated_at) VALUES (?,'carrot','lifetime',1,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE value=value+1,updated_at=UTC_TIMESTAMP(3)", [sender.player_id],
      );
      await transaction.execute(
        "INSERT INTO player_counters(player_id,counter_code,period_key,value,updated_at) VALUES (?,'thermo','lifetime',?,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE value=value+VALUES(value),updated_at=UTC_TIMESTAMP(3)",
        [recipient.player_id, PET_SKILL_CARROT_THERMOMETER_REWARD],
      );
      await transaction.execute(
        "INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,1,?,?,?,'pet_skill_carrot_fee'),(?,2,?,?,?,'pet_skill_carrot_thermometer_reward')",
        [operation.insertId, sender.player_id, carrotItem.id, -carrotFee, operation.insertId, recipient.player_id, thermometerItem.id, PET_SKILL_CARROT_THERMOMETER_REWARD],
      );
      await transaction.execute(
        `INSERT INTO pet_skill_carrot_trades(operation_id,sender_player_id,recipient_player_id,sender_pet_id,recipient_pet_id,skill_id,source_index,quantity,carrot_item_id,carrot_fee,thermometer_item_id,thermometer_reward,sender_skill_quantity_before,sender_skill_quantity_after,recipient_skill_quantity_before,recipient_skill_quantity_after)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [operation.insertId, sender.player_id, recipient.player_id, senderPet.id, recipientPet.id, selected.skill_id, command.sourceIndex, command.quantity, carrotItem.id, carrotFee, thermometerItem.id, PET_SKILL_CARROT_THERMOMETER_REWARD, selected.quantity, senderSkillAfter, recipientSkill?.quantity ?? 0n, recipientSkillAfter],
      );

      const reply = `📙스킬 당근거래 완료!\n[${sender.rank_emoji ?? ""}${sender.current_display_name}] 님 => [${recipient.rank_emoji ?? ""}${recipient.current_display_name}] 님에게\n${selected.display_name} ${command.quantity}개를 보냈습니다.`;
      const outbox = await transaction.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operation.insertId, input.destinationId, JSON.stringify({ data: reply })],
      );
      await transaction.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'PET_SKILL_CARROT_TRADE',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [input.eventId, operation.insertId],
      );
      await transaction.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,'pet.skill_carrot_trade','success','Iris /펫스킬당근',?,UTC_TIMESTAMP(3))",
        [operation.insertId, identity.identity_id, recipient.player_id, JSON.stringify({ sourceIndex: command.sourceIndex.toString(), skillId: selected.skill_id.toString(), quantity: command.quantity.toString(), carrotFee: carrotFee.toString(), thermometerReward: PET_SKILL_CARROT_THERMOMETER_REWARD.toString() })],
      );
      const result: PetSkillCarrotTradeResult = { reply, outboxId: outbox.insertId.toString(), senderPlayerId: sender.player_id.toString(), recipientPlayerId: recipient.player_id.toString(), skillId: selected.skill_id.toString(), quantity: command.quantity.toString(), carrotFee: carrotFee.toString(), thermometerReward: PET_SKILL_CARROT_THERMOMETER_REWARD.toString() };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}
