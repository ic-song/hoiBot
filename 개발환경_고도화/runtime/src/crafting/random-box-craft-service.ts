import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const HEART_ITEM_CODE = "legacy-heart";
const RANDOM_BOX_ITEM_CODE = "legacy-random-box";
const HEARTS_PER_BOX = 20n;

export interface RandomBoxCraftCommand {
  externalUserId: string;
  channelId: string;
  message: string;
  eventId: string;
}

export interface RandomBoxCraftResult {
  status: "crafted" | "blocked_by_castle_siege";
  playerId?: string;
  craftQuantity?: string;
  heartQuantity?: string;
  boxQuantity?: string;
  outboxId?: string;
  data?: string;
  auditId?: string;
}

interface CraftOwnerRow {
  identity_id: bigint;
  player_id: bigint;
  current_display_name: string;
  tier_code: string | null;
}

// 인자 없는 명령과 숫자 수량 하나만 허용합니다.
export function isRandomBoxCraftCommand(message: string | undefined): boolean {
  return message === "/랜덤조합" || (message !== undefined && /^\/랜덤조합\s+\d+$/.test(message));
}

// legacy 기본 수량과 숫자 0 처리를 보존하면서 안전 상한을 적용합니다.
function parseCraftQuantity(message: string): bigint {
  if (message === "/랜덤조합") return 1n;
  const raw = message.trim().split(/\s+/)[1];
  if (raw === undefined) throw new ApplicationError("INVALID_RANDOM_BOX_CRAFT_COMMAND", "정확한 /랜덤조합 [수량]을 입력해주세요.", 422);
  const quantity = BigInt(raw);
  if (quantity > 1000000n) throw new ApplicationError("RANDOM_BOX_CRAFT_LIMIT", "한 번에 조합할 수 있는 수량을 초과했습니다.", 422);
  return quantity;
}

// 긴 event ID를 operations idempotency 길이에 맞게 정규화합니다.
function normalizeEventKey(eventId: string): string {
  return eventId.length <= 191 ? eventId : `sha256:${createHash("sha256").update(eventId).digest("hex")}`;
}

// MariaDB JSON 컬럼에서 재시도 결과를 복원합니다.
function parseStoredResult(value: string | RandomBoxCraftResult): RandomBoxCraftResult {
  return typeof value === "string" ? JSON.parse(value) as RandomBoxCraftResult : value;
}

// 신규 등급의 씨앗 이모지와 일반 표시 이름을 만듭니다.
function rankedName(owner: CraftOwnerRow): string {
  return `${owner.tier_code === "seedling" || owner.tier_code === "starter" ? "🌱" : ""}${owner.current_display_name}`;
}

// 하트 차감과 랜덤박스 지급을 원장·감사·outbox와 함께 저장합니다.
export class RandomBoxCraftService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(command: RandomBoxCraftCommand): Promise<RandomBoxCraftResult> {
    if (!isRandomBoxCraftCommand(command.message)) {
      throw new ApplicationError("INVALID_RANDOM_BOX_CRAFT_COMMAND", "정확한 /랜덤조합 [수량]을 입력해주세요.", 422);
    }
    const craftQuantity = parseCraftQuantity(command.message);
    const requiredHearts = HEARTS_PER_BOX * craftQuantity;

    return this.database.withTransaction(async (transaction) => {
      const activeSieges = await transaction.query<Array<{ active_count: bigint }>>(
        `SELECT COUNT(*) AS active_count FROM castle_battle_seasons
         WHERE status = 'active' AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP(3))
           AND (ends_at IS NULL OR ends_at >= UTC_TIMESTAMP(3))`
      );
      if ((activeSieges[0]?.active_count ?? 0n) > 0n) return { status: "blocked_by_castle_siege" };

      const owners = await transaction.query<CraftOwnerRow[]>(
        `SELECT identity.id AS identity_id, identity.player_id, profile.current_display_name, profile.tier_code
         FROM external_identities identity
         JOIN player_profiles profile ON profile.player_id = identity.player_id
         WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ?
           AND identity.status = 'linked' AND identity.player_id IS NOT NULL
         FOR UPDATE`,
        [command.externalUserId]
      );
      const owner = owners[0];
      if (owner === undefined) throw new ApplicationError("PLAYER_IDENTITY_REQUIRED", "가입된 회원 정보를 찾을 수 없습니다.", 409);

      const scope = `craft.random-box:${owner.identity_id}`;
      const eventKey = normalizeEventKey(command.eventId);
      const prior = await transaction.query<Array<{ result_json: string | RandomBoxCraftResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE",
        [scope, eventKey]
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) return parseStoredResult(prior[0].result_json);

      const stacks = await transaction.query<Array<{ item_id: bigint; code: string; quantity: bigint; version: bigint }>>(
        `SELECT stack.item_id, item.code, stack.quantity, stack.version
         FROM item_definitions item
         JOIN inventory_stacks stack ON stack.item_id = item.id AND stack.player_id = ?
         WHERE item.code IN (?, ?) AND item.active = TRUE AND item.stackable = TRUE
         ORDER BY item.code FOR UPDATE`,
        [owner.player_id, HEART_ITEM_CODE, RANDOM_BOX_ITEM_CODE]
      );
      const heart = stacks.find((row) => row.code === HEART_ITEM_CODE);
      const box = stacks.find((row) => row.code === RANDOM_BOX_ITEM_CODE);
      if (heart === undefined || heart.quantity === 0n || heart.quantity < requiredHearts) {
        throw new ApplicationError("HEART_ITEM_REQUIRED", `하트💝 ${requiredHearts}개가 필요해요!`, 409);
      }
      if (box === undefined) throw new ApplicationError("RANDOM_BOX_ITEM_REQUIRED", "랜덤박스 설정을 찾을 수 없습니다.", 409);

      const operation = await transaction.execute(
        `INSERT INTO operations
          (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, created_at)
         VALUES (?, ?, ?, 'external_identity', ?, 'iris', 'processing', UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, eventKey, owner.identity_id]
      );
      const heartQuantity = heart.quantity - requiredHearts;
      const boxQuantity = box.quantity + craftQuantity;
      const heartUpdate = await transaction.execute(
        "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
        [heartQuantity, owner.player_id, heart.item_id, heart.version]
      );
      const boxUpdate = await transaction.execute(
        "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
        [boxQuantity, owner.player_id, box.item_id, box.version]
      );
      if (heartUpdate.affectedRows !== 1n || boxUpdate.affectedRows !== 1n) {
        throw new ApplicationError("RANDOM_BOX_CRAFT_CONFLICT", "가방 정보가 먼저 변경되었습니다.", 409);
      }
      await transaction.execute(
        `INSERT INTO inventory_ledger
          (operation_id, sequence_no, player_id, item_id, quantity_delta, reason_code)
         VALUES (?, 1, ?, ?, ?, 'random_box_craft_material'),
                (?, 2, ?, ?, ?, 'random_box_crafted')`,
        [operation.insertId, owner.player_id, heart.item_id, (-requiredHearts).toString(),
          operation.insertId, owner.player_id, box.item_id, craftQuantity.toString()]
      );

      const data = `[${rankedName(owner)}] 아조씨 사랑해요..💝\n랜덤박스💝 ${craftQuantity}개를 획득하셨습니다.`;
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages
          (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at)
         VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [operation.insertId, command.channelId, JSON.stringify({ data })]
      );
      await transaction.execute(
        `INSERT INTO command_executions
          (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at)
         VALUES (?, 'random_box_craft', ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [command.eventId, operation.insertId]
      );
      const audit = await transaction.execute(
        `INSERT INTO command_audit
          (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at)
         VALUES (?, 'external_identity', ?, 'player', ?, 'craft.random_box', 'success', 'Iris /랜덤조합', ?, UTC_TIMESTAMP(3))`,
        [operation.insertId, owner.identity_id, owner.player_id, JSON.stringify({
          craftQuantity: craftQuantity.toString(), heartQuantity: heartQuantity.toString(), boxQuantity: boxQuantity.toString()
        })]
      );
      const result: RandomBoxCraftResult = {
        status: "crafted", playerId: owner.player_id.toString(), craftQuantity: craftQuantity.toString(),
        heartQuantity: heartQuantity.toString(), boxQuantity: boxQuantity.toString(), outboxId: outbox.insertId.toString(),
        data, auditId: audit.insertId.toString()
      };
      await transaction.execute(
        "UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?",
        [JSON.stringify(result), operation.insertId]
      );
      return result;
    });
  }
}
