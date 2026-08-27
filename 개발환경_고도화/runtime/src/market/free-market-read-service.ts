import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";

interface ActorRow {
  identity_id: bigint;
  player_id: bigint;
}

interface ListingRow {
  listing_id: bigint;
  seller_name: string | null;
  rank_emoji: string | null;
  asset_type_code: string;
  quantity: bigint;
  price_currency_code: string;
  price_amount: string;
  item_name: string | null;
  instance_name: string | null;
  instance_icon: string | null;
  instance_grade: string | null;
  created_at_text: string;
}

export interface FreeMarketReadResult {
  status: "shown" | "empty";
  data: string;
  count: number;
  listingIds: string[];
  outboxId: string;
}

// 자유시장 대표 명령과 레거시 단축 별칭만 exact로 허용합니다.
export function isFreeMarketReadCommand(message: string | undefined): boolean {
  return message === "/자유시장" || message === "ㅈㅈ";
}

function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function commaDecimal(value: string): string {
  const normalized = value.replace(/\.0+$/, "");
  const parts = normalized.split(".");
  parts[0] = parts[0]!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts.join(".");
}

function currencyLabel(code: string): string {
  if (code === "point") return "🅟";
  if (code === "diamond") return "💎";
  return code;
}

function assetLabel(row: ListingRow): string {
  const name = row.instance_name ?? row.item_name ?? row.asset_type_code;
  const icon = row.instance_icon !== null && !name.endsWith(row.instance_icon) ? row.instance_icon : "";
  const grade = row.instance_grade === null ? "" : `[${row.instance_grade}]`;
  return `${name}${icon}${grade}`;
}

// 공개 매물을 고정 순서와 비식별 탈퇴회원 정책으로 투영합니다.
export function formatFreeMarketList(rows: ListingRow[]): string {
  const header = "🏪 자유시장\n━━━━━━━━━━━━";
  if (rows.length === 0) return `${header}\n현재 등록된 상품이 없습니다.`;
  const entries = rows.map((row, index) => {
    const seller = row.seller_name ?? "탈퇴회원";
    const rank = row.seller_name === null ? "" : row.rank_emoji ?? "";
    return `[${index + 1}] ${rank}${seller}\n${assetLabel(row)} ×${row.quantity.toString()}\n가격: ${currencyLabel(row.price_currency_code)}${commaDecimal(row.price_amount)}\n등록: ${row.created_at_text}`;
  });
  return `${header}\n등록 매물: ${rows.length}건\n\n${entries.join("\n\n")}`;
}

async function finishRead(
  transaction: DatabaseTransaction,
  input: {
    operationId: bigint;
    eventId: string;
    destinationId: string;
    actor: ActorRow;
    rows: ListingRow[];
  }
): Promise<FreeMarketReadResult> {
  const data = formatFreeMarketList(input.rows);
  const listingIds = input.rows.map((row) => row.listing_id.toString());
  const status = input.rows.length === 0 ? "empty" : "shown";
  const outbox = await transaction.execute(
    "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [input.operationId, input.destinationId, JSON.stringify({ data })]
  );
  await transaction.execute(
    "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'MARKET_FREE_MARKET_READ',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [input.eventId, input.operationId, status]
  );
  await transaction.execute(
    "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'market_listing',NULL,'market.free_market.read',?,'Iris free market read',?,UTC_TIMESTAMP(3))",
    [input.operationId, input.actor.identity_id, status, JSON.stringify({ count: input.rows.length, listingIds, mutation: false })]
  );
  const result: FreeMarketReadResult = { status, data, count: input.rows.length, listingIds, outboxId: outbox.insertId.toString() };
  await transaction.execute(
    "UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
    [JSON.stringify(result), input.operationId]
  );
  return result;
}

// 교착 상태는 동일 event idempotency key로 제한 재시도합니다.
async function withDeadlockRetry<T>(work: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      lastError = error;
      const code = (error as { code?: string }).code;
      if (code !== "ER_LOCK_DEADLOCK" && code !== "ER_LOCK_WAIT_TIMEOUT") throw error;
    }
  }
  throw lastError;
}

// 자유시장 공개 목록을 operation replay 가능한 단일 snapshot으로 읽습니다.
export class FreeMarketReadService {
  constructor(private readonly database: DatabaseClient) {}

  async read(input: { eventId: string; externalUserId: string; destinationId: string }): Promise<FreeMarketReadResult | null> {
    return withDeadlockRetry(() => this.database.withTransaction(async (transaction) => {
      const actors = await transaction.query<ActorRow[]>(
        "SELECT identity.id identity_id,identity.player_id FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active' WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1 FOR UPDATE",
        [input.externalUserId]
      );
      const actor = actors[0];
      if (actor === undefined) return null;
      const key = eventKey(input.eventId);
      const prior = await transaction.query<Array<{ result_json: string | FreeMarketReadResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope='market.free_market.read' AND idempotency_key=? FOR UPDATE",
        [key]
      );
      if (prior[0]?.result_json !== null && prior[0]?.result_json !== undefined) {
        return typeof prior[0].result_json === "string" ? JSON.parse(prior[0].result_json) : prior[0].result_json;
      }
      const operation = await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'market.free_market.read',?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), key, actor.identity_id]
      );
      const rows = await transaction.query<ListingRow[]>(`SELECT
          listing.id listing_id,
          CASE WHEN seller.status='active' THEN profile.current_display_name ELSE NULL END seller_name,
          CASE WHEN seller.status='active' THEN rank.rank_emoji ELSE NULL END rank_emoji,
          listing.asset_type_code,
          listing.quantity,
          listing.price_currency_code,
          CAST(listing.price_amount AS CHAR) price_amount,
          item.display_name item_name,
          JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.name')) instance_name,
          JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.icon')) instance_icon,
          JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.grade')) instance_grade,
          DATE_FORMAT(listing.created_at,'%Y-%m-%d %H:%i') created_at_text
        FROM market_listings listing
        LEFT JOIN players seller ON seller.id=listing.seller_player_id
        LEFT JOIN player_profiles profile ON profile.player_id=seller.id
        LEFT JOIN player_legacy_rank_profiles rank ON rank.player_id=seller.id
        LEFT JOIN item_definitions item ON item.id=listing.item_id
        LEFT JOIN inventory_instances instance ON instance.id=listing.inventory_instance_id
        WHERE listing.status='open' AND (listing.expires_at IS NULL OR listing.expires_at>UTC_TIMESTAMP(3))
        ORDER BY listing.created_at DESC,listing.id DESC`);
      return finishRead(transaction, { operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, actor, rows });
    }));
  }
}
