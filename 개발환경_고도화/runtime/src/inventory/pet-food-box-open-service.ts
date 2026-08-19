import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND = "/펫먹이박스오픈";
const BOX_CODE = "pet_food_dungeon_box";
const FOOD_CODE = "pet_food";
const BOX_NAME = "펫먹이던전박스🍼(/펫먹이박스오픈)";
const ALLSEE = "​".repeat(500);

export interface PetFoodBoxOpenCommand { externalUserId: string; channelId: string; message: string; eventId: string; }
export interface PetFoodBoxOpenResult {
  status: "opened" | "blocked_by_castle_siege" | "ignored_unregistered";
  playerId?: string; data?: string; outboxId?: string; auditId?: string;
  requestedOpenCount?: string; effectiveOpenCount?: string; rewardTotal?: string; randomTrace?: number[]; duplicate?: boolean;
}

interface OwnerRow { identity_id: bigint; player_id: bigint; current_display_name: string; tier_code: string | null; }
interface StackRow { item_id: bigint; code: string; quantity: bigint | null; version: bigint | null; }

// exact 기본형 또는 숫자 하나만 legacy 실행 후보로 인정합니다.
export function isPetFoodBoxOpenCommand(message: string | undefined): boolean {
  return message === COMMAND || (message !== undefined && /^\/펫먹이박스오픈\s+\d+$/.test(message));
}

// raw 숫자를 보존해 legacy의 보유량 cap 전 계산을 맞춥니다.
function requestedOpenCount(message: string): bigint {
  if (message === COMMAND) return 1n;
  const raw = message.trim().split(/\s+/)[1];
  if (raw === undefined) throw new ApplicationError("INVALID_PET_FOOD_BOX_OPEN", "사용법: /펫먹이박스오픈 또는 /펫먹이박스오픈 숫자\n예) /펫먹이박스오픈 10", 422);
  return BigInt(raw);
}

// operations key 길이를 넘는 원본 event id는 SHA-256으로 고정합니다.
function eventKey(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function commas(value: bigint): string { return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function ranked(owner: OwnerRow): string { return `${owner.tier_code === "seedling" || owner.tier_code === "starter" ? "🌱" : ""}${owner.current_display_name}`; }
function stored(value: string | PetFoodBoxOpenResult): PetFoodBoxOpenResult { return typeof value === "string" ? JSON.parse(value) as PetFoodBoxOpenResult : value; }

// 펫먹이던전박스 소비·보상·원장·응답을 event 멱등 트랜잭션으로 처리합니다.
export class PetFoodBoxOpenService {
  constructor(private readonly database: DatabaseClient, private readonly random: () => number = Math.random) {}

  async handle(command: PetFoodBoxOpenCommand): Promise<PetFoodBoxOpenResult> {
    if (!isPetFoodBoxOpenCommand(command.message)) throw new ApplicationError("INVALID_PET_FOOD_BOX_OPEN", "정확한 /펫먹이박스오픈 [수량]을 입력해주세요.", 422);
    return this.database.withTransaction(async (tx) => {
      const siege = await tx.query<Array<{ active_count: bigint }>>("SELECT COUNT(*) AS active_count FROM castle_battle_seasons WHERE status = 'active' AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP(3)) AND (ends_at IS NULL OR ends_at >= UTC_TIMESTAMP(3))");
      if ((siege[0]?.active_count ?? 0n) > 0n) return { status: "blocked_by_castle_siege" };
      const owners = await tx.query<OwnerRow[]>(`SELECT identity.id AS identity_id, identity.player_id, profile.current_display_name, profile.tier_code
        FROM external_identities identity JOIN player_profiles profile ON profile.player_id = identity.player_id
        WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ? AND identity.status = 'linked' AND identity.player_id IS NOT NULL FOR UPDATE`, [command.externalUserId]);
      const owner = owners[0];
      if (owner === undefined) return { status: "ignored_unregistered" };
      const scope = `inventory.pet-food-box-open:${owner.identity_id}`;
      const key = eventKey(command.eventId);
      const previous = await tx.query<Array<{ result_json: string | PetFoodBoxOpenResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE", [scope, key]);
      if (previous[0]?.result_json !== undefined && previous[0].result_json !== null) return { ...stored(previous[0].result_json), duplicate: true };
      const rows = await tx.query<StackRow[]>(`SELECT item.id AS item_id, item.code, stack.quantity, stack.version FROM item_definitions item
        LEFT JOIN inventory_stacks stack ON stack.item_id = item.id AND stack.player_id = ?
        WHERE item.code IN (?, ?) AND item.active = TRUE AND item.stackable = TRUE ORDER BY item.code FOR UPDATE`, [owner.player_id, BOX_CODE, FOOD_CODE]);
      const box = rows.find((row) => row.code === BOX_CODE);
      const food = rows.find((row) => row.code === FOOD_CODE);
      if (box === undefined || food === undefined) throw new ApplicationError("PET_FOOD_BOX_CATALOG_REQUIRED", "펫먹이던전박스 아이템 설정을 찾을 수 없습니다.", 409);
      const have = box.quantity ?? 0n;
      const wanted = requestedOpenCount(command.message);
      if (have <= 0n) return this.persist(tx, owner, scope, key, command, { wanted, effective: 0n, reward: 0n, trace: [], box, food, empty: true });
      if (wanted <= 0n) throw new ApplicationError("INVALID_PET_FOOD_BOX_OPEN", "사용법: /펫먹이박스오픈 또는 /펫먹이박스오픈 숫자\n예) /펫먹이박스오픈 10", 422);
      const effective = wanted < have ? wanted : have;
      const trace: number[] = []; let reward = 0n;
      for (let index = 0n; index < effective; index++) {
        const raw = this.random();
        if (!Number.isFinite(raw) || raw < 0 || raw > 1) throw new ApplicationError("PET_FOOD_BOX_RANDOM_INVALID", "펫먹이 보상 계산을 다시 시도해주세요.", 409);
        const value = raw === 1 ? 1 - Number.EPSILON : raw; trace.push(value);
        reward += BigInt(Math.floor(value * 11) + 40);
      }
      return this.persist(tx, owner, scope, key, command, { wanted, effective, reward, trace, box, food, empty: false });
    });
  }

  private async persist(tx: DatabaseTransaction, owner: OwnerRow, scope: string, key: string, command: PetFoodBoxOpenCommand, plan: { wanted: bigint; effective: bigint; reward: bigint; trace: number[]; box: StackRow; food: StackRow; empty: boolean }): Promise<PetFoodBoxOpenResult> {
    const boxAfter = (plan.box.quantity ?? 0n) - plan.effective;
    const foodAfter = (plan.food.quantity ?? 0n) + plan.reward;
    const data = plan.empty
      ? `❌[${ranked(owner)}] 님 오픈할 상자가 없습니다.\n(${BOX_NAME})`
      : `🎁[${ranked(owner)}] 님 ${COMMAND}\n오픈: ${BOX_NAME} x${plan.effective}\n${ALLSEE}\n펫먹이🍼 x${commas(plan.reward)}`;
    const operation = await tx.execute("INSERT INTO operations (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, created_at) VALUES (?, ?, ?, 'external_identity', ?, 'iris', 'processing', UTC_TIMESTAMP(3))", [randomUUID(), scope, key, owner.identity_id]);
    if (!plan.empty) {
      const boxWrite = boxAfter === 0n
        ? await tx.execute("DELETE FROM inventory_stacks WHERE player_id = ? AND item_id = ? AND version = ?", [owner.player_id, plan.box.item_id, plan.box.version])
        : await tx.execute("UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?", [boxAfter, owner.player_id, plan.box.item_id, plan.box.version]);
      const foodWrite = plan.food.quantity === null
        ? await tx.execute("INSERT INTO inventory_stacks (player_id, item_id, quantity, version) VALUES (?, ?, ?, 1)", [owner.player_id, plan.food.item_id, foodAfter])
        : await tx.execute("UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?", [foodAfter, owner.player_id, plan.food.item_id, plan.food.version]);
      if (boxWrite.affectedRows !== 1n || foodWrite.affectedRows !== 1n) throw new ApplicationError("PET_FOOD_BOX_INVENTORY_CONFLICT", "가방 정보가 먼저 변경되었습니다.", 409);
      await tx.execute("INSERT INTO inventory_ledger (operation_id, sequence_no, player_id, item_id, quantity_delta, reason_code) VALUES (?, 1, ?, ?, ?, 'pet_food_dungeon_box_open'), (?, 2, ?, ?, ?, 'pet_food_dungeon_box_open')", [operation.insertId, owner.player_id, plan.box.item_id, (-plan.effective).toString(), operation.insertId, owner.player_id, plan.food.item_id, plan.reward.toString()]);
    }
    const outbox = await tx.execute("INSERT INTO outbox_messages (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at) VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))", [operation.insertId, command.channelId, JSON.stringify({ data, sequence: 1 })]);
    await tx.execute("INSERT INTO command_executions (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at) VALUES (?, 'pet_food_box_open', ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))", [command.eventId, operation.insertId]);
    const audit = await tx.execute("INSERT INTO command_audit (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at) VALUES (?, 'external_identity', ?, 'player', ?, 'inventory.pet_food_box_open', 'success', 'Iris /펫먹이박스오픈', ?, UTC_TIMESTAMP(3))", [operation.insertId, owner.identity_id, owner.player_id, JSON.stringify({ rawInput: command.message, requestedOpenCount: plan.wanted.toString(), effectiveOpenCount: plan.effective.toString(), rewardTotal: plan.reward.toString(), rngTrace: plan.trace, boxAfter: boxAfter.toString(), foodAfter: foodAfter.toString(), empty: plan.empty })]);
    const result: PetFoodBoxOpenResult = { status: "opened", playerId: owner.player_id.toString(), data, outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString(), requestedOpenCount: plan.wanted.toString(), effectiveOpenCount: plan.effective.toString(), rewardTotal: plan.reward.toString(), randomTrace: plan.trace };
    await tx.execute("UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?", [JSON.stringify(result), operation.insertId]);
    return result;
  }
}
