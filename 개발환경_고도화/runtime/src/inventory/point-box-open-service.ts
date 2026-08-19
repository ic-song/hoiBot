import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND = "/포인트상자오픈";
const BOX_CODE = "point_box_100m";
const BOX_NAME = "1억포인트상자🪙(/포인트상자오픈)";
const REWARD = 100000000n;
const MAX_POINT = 999999999999999999999999999n; // DECIMAL(30,3)의 정수 포인트 상한

export interface PointBoxOpenCommand { externalUserId: string; channelId: string; message: string; eventId: string; }
export interface PointBoxOpenResult { status: "opened" | "blocked_by_castle_siege" | "ignored_unregistered"; data?: string; outboxId?: string; duplicate?: boolean; requestedOpenCount?: string; effectiveOpenCount?: string; rewardTotal?: string; pointAfter?: string; }
interface OwnerRow { identity_id: bigint; player_id: bigint; current_display_name: string; tier_code: string | null; }
interface StackRow { item_id: bigint; quantity: bigint | null; version: bigint | null; }
interface AccountRow { balance: string; version: bigint; }

// legacy의 exact 기본형 또는 숫자 단일 인자 guard를 유지합니다.
export function isPointBoxOpenCommand(message: string | undefined): boolean { return message === COMMAND || (message !== undefined && /^\/포인트상자오픈\s+\d+$/.test(message)); }
function eventKey(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function commas(value: bigint): string { return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function rank(owner: OwnerRow): string { return `${owner.tier_code === "seedling" || owner.tier_code === "starter" ? "🌱" : ""}${owner.current_display_name}`; }
function parse(message: string): bigint { return message === COMMAND ? 1n : BigInt(message.trim().split(/\s+/)[1]!); }
function stored(value: string | PointBoxOpenResult): PointBoxOpenResult { return typeof value === "string" ? JSON.parse(value) as PointBoxOpenResult : value; }

// 포인트상자 소비·포인트 원장·응답을 하나의 event 멱등 트랜잭션으로 처리합니다.
export class PointBoxOpenService {
  constructor(private readonly database: DatabaseClient) {}
  async handle(command: PointBoxOpenCommand): Promise<PointBoxOpenResult> {
    if (!isPointBoxOpenCommand(command.message)) throw new ApplicationError("INVALID_POINT_BOX_OPEN", "정확한 /포인트상자오픈 [수량]을 입력해주세요.", 422);
    return this.database.withTransaction(async (tx) => {
      const siege = await tx.query<Array<{ active_count: bigint }>>("SELECT COUNT(*) AS active_count FROM castle_battle_seasons WHERE status = 'active' AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP(3)) AND (ends_at IS NULL OR ends_at >= UTC_TIMESTAMP(3))");
      if ((siege[0]?.active_count ?? 0n) > 0n) return { status: "blocked_by_castle_siege" };
      const owners = await tx.query<OwnerRow[]>("SELECT identity.id AS identity_id, identity.player_id, profile.current_display_name, profile.tier_code FROM external_identities identity JOIN player_profiles profile ON profile.player_id = identity.player_id WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ? AND identity.status = 'linked' AND identity.player_id IS NOT NULL FOR UPDATE", [command.externalUserId]);
      const owner = owners[0]; if (owner === undefined) return { status: "ignored_unregistered" };
      const scope = `inventory.point-box-open:${owner.identity_id}`; const key = eventKey(command.eventId);
      const previous = await tx.query<Array<{ result_json: string | PointBoxOpenResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE", [scope, key]);
      if (previous[0]?.result_json !== undefined && previous[0].result_json !== null) return { ...stored(previous[0].result_json), duplicate: true };
      const boxes = await tx.query<StackRow[]>("SELECT item.id AS item_id, stack.quantity, stack.version FROM item_definitions item LEFT JOIN inventory_stacks stack ON stack.item_id = item.id AND stack.player_id = ? WHERE item.code = ? AND item.active = TRUE AND item.stackable = TRUE FOR UPDATE", [owner.player_id, BOX_CODE]);
      const box = boxes[0]; if (box === undefined) throw new ApplicationError("POINT_BOX_CATALOG_REQUIRED", "포인트상자 아이템 설정을 찾을 수 없습니다.", 409);
      const wanted = parse(command.message); const have = box.quantity ?? 0n;
      if (have <= 0n) return this.persist(tx, owner, scope, key, command, box, wanted, 0n, 0n, 0n, true);
      if (wanted <= 0n) throw new ApplicationError("INVALID_POINT_BOX_OPEN", "사용법: /포인트상자오픈 또는 /포인트상자오픈 숫자\n예) /포인트상자오픈 10", 422);
      const effective = wanted < have ? wanted : have; const reward = REWARD * effective;
      const accounts = await tx.query<AccountRow[]>("SELECT CAST(balance AS CHAR) AS balance, version FROM currency_accounts WHERE player_id = ? AND currency_code = 'point' FOR UPDATE", [owner.player_id]);
      const account = accounts[0]; if (account === undefined || !/^\d+(?:\.000)?$/.test(account.balance)) throw new ApplicationError("POINT_ACCOUNT_REQUIRED", "포인트 계정을 찾을 수 없습니다.", 409);
      const pointAfter = BigInt(account.balance.split(".")[0]!) + reward;
      if (pointAfter > MAX_POINT) throw new ApplicationError("POINT_BOX_OVERFLOW", "포인트 보유 한도를 초과합니다.", 409);
      return this.persist(tx, owner, scope, key, command, box, wanted, effective, reward, pointAfter, false, account);
    });
  }
  private async persist(tx: DatabaseTransaction, owner: OwnerRow, scope: string, key: string, command: PointBoxOpenCommand, box: StackRow, wanted: bigint, effective: bigint, reward: bigint, pointAfter: bigint, empty: boolean, account?: AccountRow): Promise<PointBoxOpenResult> {
    const boxAfter = (box.quantity ?? 0n) - effective;
    const data = empty ? `❌[${rank(owner)}] 님 오픈할 상자가 없습니다.\n(${BOX_NAME})` : `🪙 포인트상자 오픈 🪙\n[${rank(owner)}] 님\n━━━━━━━━━━━━\n🎁 사용: 1억포인트상자🪙 ${commas(effective)}개\n✨ 획득: 🅟${commas(reward)}\n━━━━━━━━━━━━\n💰 보유 포인트: 🅟${commas(pointAfter)}\n📦 남은 상자: ${commas(boxAfter)}개`;
    const op = await tx.execute("INSERT INTO operations (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, created_at) VALUES (?, ?, ?, 'external_identity', ?, 'iris', 'processing', UTC_TIMESTAMP(3))", [randomUUID(), scope, key, owner.identity_id]);
    if (!empty) {
      const boxWrite = boxAfter === 0n ? await tx.execute("DELETE FROM inventory_stacks WHERE player_id = ? AND item_id = ? AND version = ?", [owner.player_id, box.item_id, box.version]) : await tx.execute("UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?", [boxAfter, owner.player_id, box.item_id, box.version]);
      const pointWrite = await tx.execute("UPDATE currency_accounts SET balance = ?, version = version + 1 WHERE player_id = ? AND currency_code = 'point' AND version = ?", [pointAfter.toString(), owner.player_id, account!.version]);
      if (boxWrite.affectedRows !== 1n || pointWrite.affectedRows !== 1n) throw new ApplicationError("POINT_BOX_CONFLICT", "가방 또는 포인트 정보가 먼저 변경되었습니다.", 409);
      await tx.execute("INSERT INTO inventory_ledger (operation_id, sequence_no, player_id, item_id, quantity_delta, reason_code) VALUES (?, 1, ?, ?, ?, 'point_box_open_consume')", [op.insertId, owner.player_id, box.item_id, (-effective).toString()]);
      await tx.execute("INSERT INTO currency_ledger (operation_id, sequence_no, player_id, currency_code, delta, balance_after, reason_code) VALUES (?, 1, ?, 'point', ?, ?, 'point_box_open_reward')", [op.insertId, owner.player_id, reward.toString(), pointAfter.toString()]);
    }
    const outbox = await tx.execute("INSERT INTO outbox_messages (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at) VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))", [op.insertId, command.channelId, JSON.stringify({ data, sequence: 1 })]);
    await tx.execute("INSERT INTO command_executions (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at) VALUES (?, 'point_box_open', ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))", [command.eventId, op.insertId]);
    const result: PointBoxOpenResult = { status: "opened", data, outboxId: outbox.insertId.toString(), requestedOpenCount: wanted.toString(), effectiveOpenCount: effective.toString(), rewardTotal: reward.toString(), pointAfter: pointAfter.toString() };
    await tx.execute("INSERT INTO command_audit (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at) VALUES (?, 'external_identity', ?, 'player', ?, 'inventory.point_box_open', 'success', 'Iris /포인트상자오픈', ?, UTC_TIMESTAMP(3))", [op.insertId, owner.identity_id, owner.player_id, JSON.stringify({ rawInput: command.message, requestedOpenCount: wanted.toString(), effectiveOpenCount: effective.toString(), rewardTotal: reward.toString(), pointAfter: pointAfter.toString(), boxAfter: boxAfter.toString(), empty })]);
    await tx.execute("UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?", [JSON.stringify(result), op.insertId]);
    return result;
  }
}
