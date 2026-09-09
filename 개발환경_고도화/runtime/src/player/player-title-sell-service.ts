import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { compactPlayerTitleOwnedProjection, lockPlayerTitleOwnedProjection } from "./player-title-owned-projection.js";

type ParsedTitleSale =
  | { mode: "single"; start: bigint; end: bigint }
  | { mode: "range"; start: bigint; end: bigint };

interface ActorRow { identity_id: bigint; player_id: bigint; display_name: string; rank_emoji: string | null; }
interface TitleRow { instance_id: bigint | null; title_id: bigint; display_name: string; display_order: bigint; equipped: number; acquisition_price: string; }

export interface PlayerTitleSellResult {
  status: "sold" | "not_found" | "blocked_by_castle_siege" | "ignored_unregistered";
  mode?: "single" | "range";
  soldCount?: string;
  totalGain?: string;
  pointBalance?: string;
  data?: string;
  outboxId?: string;
  replayed?: boolean;
}

// 단일·범위 타이틀 판매의 완전한 숫자 형식만 실행 후보로 인정합니다.
export function isPlayerTitleSellCandidate(message: string | undefined): boolean {
  return message !== undefined && parsePlayerTitleSellCommand(message) !== null;
}

// 타이틀 판매 후보를 DB command alias로 정규화합니다.
export function normalizePlayerTitleSellDispatchMessage(message: string): string {
  const parsed = parsePlayerTitleSellCommand(message);
  if (parsed?.mode === "single") return "/타이틀판매";
  if (parsed?.mode === "range") return "/타이틀지정판매";
  return message;
}

// 안전한 양의 uint64 단일 번호 또는 범위를 파싱합니다.
export function parsePlayerTitleSellCommand(message: string): ParsedTitleSale | null {
  const single = /^\/타이틀판매\s+([1-9]\d*)\s*$/u.exec(message);
  if (single !== null) {
    const index = uint64(single[1]!);
    return index === null ? null : { mode: "single", start: index, end: index };
  }
  const range = /^\/타이틀지정판매\s+([1-9]\d*)~([1-9]\d*)\s*$/u.exec(message);
  if (range === null) return null;
  const start = uint64(range[1]!);
  const end = uint64(range[2]!);
  return start === null || end === null || start > end ? null : { mode: "range", start, end };
}

// 보유 타이틀 판매가를 레거시 규칙으로 계산합니다.
export function playerTitleSalePrice(acquisitionPrice: string): bigint {
  const price = integer(acquisitionPrice);
  if (price < 0n) throw new ApplicationError("INVALID_TITLE_ACQUISITION_PRICE", "타이틀 구매액을 확인할 수 없습니다.", 409);
  return price < 10000n ? 1000000n : price * 3n / 10n;
}

// 타이틀 제거·순서 압축·포인트 적립·원장 기록을 한 transaction으로 처리합니다.
export class PlayerTitleSellService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<PlayerTitleSellResult | null> {
    const parsed = parsePlayerTitleSellCommand(input.message);
    if (parsed === null) return null;
    return this.database.withTransaction(async (transaction) => {
      const siege = (await transaction.query<Array<{ active_count: bigint }>>(
        "SELECT COUNT(*) active_count FROM castle_battle_seasons WHERE status='active' AND (starts_at IS NULL OR starts_at<=UTC_TIMESTAMP(3)) AND (ends_at IS NULL OR ends_at>=UTC_TIMESTAMP(3))"
      ))[0]?.active_count ?? 0n;
      if (siege > 0n) return { status: "blocked_by_castle_siege" };

      const actor = (await transaction.query<ActorRow[]>(
        `SELECT identity.id identity_id,identity.player_id,profile.current_display_name display_name,rank.rank_emoji
           FROM external_identities identity
           JOIN players player ON player.id=identity.player_id AND player.status='active' AND player.deleted_at IS NULL
           JOIN player_profiles profile ON profile.player_id=player.id
      LEFT JOIN player_legacy_rank_profiles rank ON rank.player_id=player.id
          WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
          LIMIT 1 FOR UPDATE`,
        [input.externalUserId]
      ))[0];
      if (actor === undefined) return { status: "ignored_unregistered" };

      const scope = `player.title.sell:${actor.identity_id}`;
      const key = eventKey(input.eventId);
      await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)",
        [randomUUID(), scope, key, actor.identity_id]
      );
      const operation = (await transaction.query<Array<{ id: bigint; result_json: string | PlayerTitleSellResult | null }>>(
        "SELECT id,result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",
        [scope, key]
      ))[0];
      if (operation === undefined) throw new Error("Player title sell operation claim failed.");
      if (operation.result_json !== null) return { ...stored(operation.result_json), replayed: true };

      const titles: TitleRow[] = (await lockPlayerTitleOwnedProjection(transaction,actor.player_id)).map((row)=>({instance_id:row.instanceId,title_id:row.titleId,display_name:row.displayName,display_order:row.displayOrder,equipped:row.equipped?1:0,acquisition_price:row.acquisitionPrice}));
      const startIndex = parsed.start - 1n;
      const selected = startIndex >= BigInt(titles.length)
        ? []
        : titles.slice(Number(startIndex), Number(parsed.end > BigInt(titles.length) ? BigInt(titles.length) : parsed.end));
      const commandCode = parsed.mode === "single" ? "PLAYER_TITLE_SELL_SINGLE" : "PLAYER_TITLE_SELL_RANGE";
      if (selected.length === 0) {
        return complete(transaction, {
          operationId: operation.id, input, actor, commandCode, status: "not_found", parsed,
          data: "해당 번호의 타이틀이 존재하지 않습니다.", selected: [], totalGain: 0n, pointBalance: null
        });
      }

      const prices = selected.map((title) => playerTitleSalePrice(title.acquisition_price));
      const totalGain = prices.reduce((sum, price) => sum + price, 0n);
      await transaction.execute("INSERT IGNORE INTO currency_accounts(player_id,currency_code,balance,version) VALUES (?,'point',0,0)", [actor.player_id]);
      const account = (await transaction.query<Array<{ balance: string; version: bigint }>>(
        "SELECT CAST(balance AS CHAR) balance,version FROM currency_accounts WHERE player_id=? AND currency_code='point' FOR UPDATE",
        [actor.player_id]
      ))[0];
      if (account === undefined) throw new ApplicationError("POINT_ACCOUNT_REQUIRED", "포인트 계정을 찾을 수 없습니다.", 409);
      const pointBefore = integer(account.balance);
      const pointAfter = pointBefore + totalGain;

      await transaction.execute(
        "INSERT INTO player_title_sale_operations(operation_id,player_id,sale_mode,source_start,source_end,sold_count,total_gain,point_before,point_after) VALUES (?,?,?,?,?,?,?,?,?)",
        [operation.id, actor.player_id, parsed.mode, parsed.start, parsed.end, selected.length, totalGain.toString(), pointBefore.toString(), pointAfter.toString()]
      );
      for (let index = 0; index < selected.length; index += 1) {
        const title = selected[index]!;
        await transaction.execute(
          "INSERT INTO player_title_sale_lines(operation_id,sequence_no,title_id,source_display_order,was_equipped,acquisition_price,sale_price) VALUES (?,?,?,?,?,?,?)",
          [operation.id, index + 1, title.title_id, title.display_order, Boolean(title.equipped), title.acquisition_price, prices[index]!.toString()]
        );
        if(title.instance_id!==null){
          const removed=await transaction.execute("UPDATE player_title_instances SET status='sold',equipped=FALSE,version=version+1 WHERE id=? AND status='owned'",[title.instance_id]);
          if(removed.affectedRows!==1n)throw new ApplicationError("PLAYER_TITLE_SELL_CONFLICT","타이틀 정보가 먼저 변경되었습니다.",409);
          const same=(await transaction.query<Array<{count_value:bigint}>>("SELECT COUNT(*) count_value FROM player_title_instances WHERE player_id=? AND title_id=? AND status='owned'",[actor.player_id,title.title_id]))[0]?.count_value??0n;
          if(same===0n)await transaction.execute("DELETE FROM player_titles WHERE player_id=? AND title_id=?",[actor.player_id,title.title_id]);
        }else{
          const removed=await transaction.execute("DELETE FROM player_titles WHERE player_id=? AND title_id=?",[actor.player_id,title.title_id]);
          if(removed.affectedRows!==1n)throw new ApplicationError("PLAYER_TITLE_SELL_CONFLICT","타이틀 정보가 먼저 변경되었습니다.",409);
        }
      }
      await compactPlayerTitleOwnedProjection(transaction,actor.player_id);
      const pointWrite = await transaction.execute(
        "UPDATE currency_accounts SET balance=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND currency_code='point' AND version=?",
        [pointAfter.toString(), actor.player_id, account.version]
      );
      if (pointWrite.affectedRows !== 1n) throw new ApplicationError("PLAYER_TITLE_SELL_CONFLICT", "포인트 정보가 먼저 변경되었습니다.", 409);
      await transaction.execute(
        "INSERT INTO currency_ledger(operation_id,sequence_no,player_id,currency_code,delta,balance_after,reason_code) VALUES (?,1,?,'point',?,?,'PLAYER_TITLE_SELL')",
        [operation.id, actor.player_id, totalGain.toString(), pointAfter.toString()]
      );
      const owner = `${actor.rank_emoji ?? ""}${actor.display_name}`;
      const data = parsed.mode === "single"
        ? `[${owner}] 님\n[${selected[0]!.display_name}] 타이틀을 판매했습니다.\n━━━━━━━━━━━━━\n획득 포인트💸: 🅟${commas(totalGain)}\n현재 포인트💸: 🅟${commas(pointAfter)}`
        : `[${owner}] 님\n타이틀 ${selected.length}개를 판매했습니다.\n━━━━━━━━━━━━━\n획득 포인트💸: 🅟${commas(totalGain)}\n현재 포인트💸: 🅟${commas(pointAfter)}`;
      return complete(transaction, { operationId: operation.id, input, actor, commandCode, status: "sold", parsed, data, selected, totalGain, pointBalance: pointAfter });
    });
  }
}

async function complete(transaction: DatabaseTransaction, value: {
  operationId: bigint;
  input: { eventId: string; destinationId: string };
  actor: ActorRow;
  commandCode: string;
  status: "sold" | "not_found";
  parsed: ParsedTitleSale;
  data: string;
  selected: TitleRow[];
  totalGain: bigint;
  pointBalance: bigint | null;
}): Promise<PlayerTitleSellResult> {
  const outbox = await transaction.execute(
    "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [value.operationId, value.input.destinationId, JSON.stringify({ data: value.data })]
  );
  await transaction.execute(
    "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [value.input.eventId, value.commandCode, value.operationId, value.status]
  );
  await transaction.execute(
    "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,'player.title.sell',?,'Iris title sale',?,UTC_TIMESTAMP(3))",
    [value.operationId, value.actor.identity_id, value.actor.player_id, value.status, JSON.stringify({ mode: value.parsed.mode, sourceStart: value.parsed.start.toString(), sourceEnd: value.parsed.end.toString(), soldTitleIds: value.selected.map((title) => title.title_id.toString()), soldCount: value.selected.length, totalGain: value.totalGain.toString(), pointBalance: value.pointBalance?.toString() ?? null })]
  );
  const result: PlayerTitleSellResult = { status: value.status, mode: value.parsed.mode, soldCount: String(value.selected.length), totalGain: value.totalGain.toString(), pointBalance: value.pointBalance?.toString(), data: value.data, outboxId: outbox.insertId.toString() };
  await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), value.operationId]);
  return { ...result, replayed: false };
}

function uint64(value: string): bigint | null {
  try { const parsed = BigInt(value); return parsed > 0n && parsed <= 18446744073709551615n ? parsed : null; } catch { return null; }
}

function integer(value: string): bigint {
  const match = /^(-?\d+)(?:\.0+)?$/u.exec(value);
  if (match === null) throw new ApplicationError("NON_INTEGER_TITLE_VALUE", "타이틀 금액을 정수로 확인할 수 없습니다.", 409);
  return BigInt(match[1]!);
}

function eventKey(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function stored(value: string | PlayerTitleSellResult): PlayerTitleSellResult { return typeof value === "string" ? JSON.parse(value) as PlayerTitleSellResult : value; }
function commas(value: bigint): string { return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
