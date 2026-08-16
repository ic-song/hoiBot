import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const JUNK_CODE = "legacy-junk-item";
const BOX_CODE = "legacy-pet-food-box";
const JUNK_PER_BOX = 300n;
const POINT_PER_BOX = 25000000n;

export interface PetFoodBoxCraftCommand { externalUserId: string; channelId: string; message: string; eventId: string; }
export interface PetFoodBoxCraftResult {
  status: "crafted" | "blocked_by_castle_siege"; playerId?: string; craftQuantity?: string;
  junkQuantity?: string; pointBalance?: string; boxQuantity?: string; outboxId?: string; data?: string; auditId?: string;
}
interface OwnerRow { identity_id: bigint; player_id: bigint; current_display_name: string; tier_code: string | null; }

// 인자 없는 명령과 숫자 수량 하나만 허용합니다.
export function isPetFoodBoxCraftCommand(message: string | undefined): boolean {
  return message === "/펫먹이조합" || (message !== undefined && /^\/펫먹이조합\s+\d+$/.test(message));
}

// legacy 최소 수량 1과 안전 상한을 적용합니다.
function craftQuantity(message: string): bigint {
  if (message === "/펫먹이조합") return 1n;
  const raw = message.trim().split(/\s+/)[1];
  if (raw === undefined) throw new ApplicationError("INVALID_PET_FOOD_BOX_CRAFT_COMMAND", "정확한 /펫먹이조합 [수량]을 입력해주세요.", 422);
  const value = BigInt(raw) < 1n ? 1n : BigInt(raw);
  if (value > 1000000n) throw new ApplicationError("PET_FOOD_BOX_CRAFT_LIMIT", "한 번에 조합할 수 있는 수량을 초과했습니다.", 422);
  return value;
}

// event ID를 operations key 길이에 맞게 정규화합니다.
function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// MariaDB JSON 결과를 재시도 응답으로 복원합니다.
function stored(value: string | PetFoodBoxCraftResult): PetFoodBoxCraftResult {
  return typeof value === "string" ? JSON.parse(value) as PetFoodBoxCraftResult : value;
}

// 정수 DECIMAL 문자열을 손실 없는 bigint로 변환합니다.
function integer(value: string): bigint {
  const match = /^(-?\d+)(?:\.0+)?$/.exec(value);
  if (match === null) throw new ApplicationError("NON_INTEGER_POINT_BALANCE", "포인트 금액을 정수로 확인할 수 없습니다.", 409);
  return BigInt(match[1]!);
}

// bigint 금액을 legacy 천 단위 쉼표 형식으로 표시합니다.
function commas(value: bigint): string { return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

// 신규 등급의 씨앗 이모지와 일반 표시 이름을 만듭니다.
function ranked(owner: OwnerRow): string {
  return `${owner.tier_code === "seedling" || owner.tier_code === "starter" ? "🌱" : ""}${owner.current_display_name}`;
}

// 잡템·포인트 차감과 펫먹이상자 지급을 양쪽 원장과 함께 저장합니다.
export class PetFoodBoxCraftService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(command: PetFoodBoxCraftCommand): Promise<PetFoodBoxCraftResult> {
    if (!isPetFoodBoxCraftCommand(command.message)) throw new ApplicationError("INVALID_PET_FOOD_BOX_CRAFT_COMMAND", "정확한 /펫먹이조합 [수량]을 입력해주세요.", 422);
    const count = craftQuantity(command.message);
    const requiredJunk = JUNK_PER_BOX * count;
    const requiredPoint = POINT_PER_BOX * count;
    return this.database.withTransaction(async (tx) => {
      const siege = await tx.query<Array<{ active_count: bigint }>>(
        "SELECT COUNT(*) AS active_count FROM castle_battle_seasons WHERE status = 'active' AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP(3)) AND (ends_at IS NULL OR ends_at >= UTC_TIMESTAMP(3))"
      );
      if ((siege[0]?.active_count ?? 0n) > 0n) return { status: "blocked_by_castle_siege" };
      const owners = await tx.query<OwnerRow[]>(
        `SELECT identity.id AS identity_id, identity.player_id, profile.current_display_name, profile.tier_code
         FROM external_identities identity JOIN player_profiles profile ON profile.player_id = identity.player_id
         WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ? AND identity.status = 'linked' AND identity.player_id IS NOT NULL FOR UPDATE`,
        [command.externalUserId]
      );
      const owner = owners[0];
      if (owner === undefined) throw new ApplicationError("PLAYER_IDENTITY_REQUIRED", "가입된 회원 정보를 찾을 수 없습니다.", 409);
      const scope = `craft.pet-food-box:${owner.identity_id}`;
      const key = eventKey(command.eventId);
      const prior = await tx.query<Array<{ result_json: string | PetFoodBoxCraftResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE", [scope, key]
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) return stored(prior[0].result_json);
      const stacks = await tx.query<Array<{ item_id: bigint; code: string; quantity: bigint; version: bigint }>>(
        `SELECT stack.item_id, item.code, stack.quantity, stack.version FROM item_definitions item
         JOIN inventory_stacks stack ON stack.item_id = item.id AND stack.player_id = ?
         WHERE item.code IN (?, ?) AND item.active = TRUE AND item.stackable = TRUE ORDER BY item.code FOR UPDATE`,
        [owner.player_id, JUNK_CODE, BOX_CODE]
      );
      const junk = stacks.find((row) => row.code === JUNK_CODE);
      const box = stacks.find((row) => row.code === BOX_CODE);
      if (junk === undefined || junk.quantity < requiredJunk) throw new ApplicationError("JUNK_ITEM_REQUIRED", `잡템☠️ ${requiredJunk}개가 필요해요!`, 409);
      if (box === undefined) throw new ApplicationError("PET_FOOD_BOX_ITEM_REQUIRED", "펫먹이상자 설정을 찾을 수 없습니다.", 409);
      const accounts = await tx.query<Array<{ balance: string; version: bigint }>>(
        "SELECT CAST(balance AS CHAR) AS balance, version FROM currency_accounts WHERE player_id = ? AND currency_code = 'point' FOR UPDATE", [owner.player_id]
      );
      const account = accounts[0];
      const balance = account === undefined ? 0n : integer(account.balance);
      if (account === undefined || balance < requiredPoint) throw new ApplicationError("POINT_REQUIRED", `🅟${commas(requiredPoint)}가 필요해요!`, 409);
      const operation = await tx.execute(
        "INSERT INTO operations (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, created_at) VALUES (?, ?, ?, 'external_identity', ?, 'iris', 'processing', UTC_TIMESTAMP(3))",
        [randomUUID(), scope, key, owner.identity_id]
      );
      const junkAfter = junk.quantity - requiredJunk;
      const boxAfter = box.quantity + count;
      const pointAfter = balance - requiredPoint;
      const junkWrite = await tx.execute(
        "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
        [junkAfter, owner.player_id, junk.item_id, junk.version]
      );
      const boxWrite = await tx.execute(
        "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
        [boxAfter, owner.player_id, box.item_id, box.version]
      );
      const pointWrite = await tx.execute(
        "UPDATE currency_accounts SET balance = ?, version = version + 1 WHERE player_id = ? AND currency_code = 'point' AND version = ?",
        [pointAfter.toString(), owner.player_id, account.version]
      );
      if (junkWrite.affectedRows !== 1n || boxWrite.affectedRows !== 1n || pointWrite.affectedRows !== 1n) {
        throw new ApplicationError("PET_FOOD_BOX_CRAFT_CONFLICT", "재화 정보가 먼저 변경되었습니다.", 409);
      }
      await tx.execute(
        "INSERT INTO inventory_ledger (operation_id, sequence_no, player_id, item_id, quantity_delta, reason_code) VALUES (?, 1, ?, ?, ?, 'pet_food_box_craft_material'), (?, 2, ?, ?, ?, 'pet_food_box_crafted')",
        [operation.insertId, owner.player_id, junk.item_id, (-requiredJunk).toString(), operation.insertId, owner.player_id, box.item_id, count.toString()]
      );
      await tx.execute(
        "INSERT INTO currency_ledger (operation_id, sequence_no, player_id, currency_code, delta, balance_after, reason_code) VALUES (?, 1, ?, 'point', ?, ?, 'pet_food_box_craft_cost')",
        [operation.insertId, owner.player_id, (-requiredPoint).toString(), pointAfter.toString()]
      );
      const data = `[${ranked(owner)}] 님\n펫먹이상자📦(/상자오픈) ${count}개 조합이 완료되었습니다!\n(/상자오픈)`;
      const outbox = await tx.execute(
        "INSERT INTO outbox_messages (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at) VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
        [operation.insertId, command.channelId, JSON.stringify({ data })]
      );
      await tx.execute("INSERT INTO command_executions (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at) VALUES (?, 'pet_food_box_craft', ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))", [command.eventId, operation.insertId]);
      const audit = await tx.execute(
        "INSERT INTO command_audit (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at) VALUES (?, 'external_identity', ?, 'player', ?, 'craft.pet_food_box', 'success', 'Iris /펫먹이조합', ?, UTC_TIMESTAMP(3))",
        [operation.insertId, owner.identity_id, owner.player_id, JSON.stringify({ count: count.toString(), junkAfter: junkAfter.toString(), pointAfter: pointAfter.toString(), boxAfter: boxAfter.toString() })]
      );
      const result: PetFoodBoxCraftResult = { status: "crafted", playerId: owner.player_id.toString(), craftQuantity: count.toString(), junkQuantity: junkAfter.toString(), pointBalance: pointAfter.toString(), boxQuantity: boxAfter.toString(), outboxId: outbox.insertId.toString(), data, auditId: audit.insertId.toString() };
      await tx.execute("UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}
