import type { DatabaseClient } from "../database.js";

const ALL_SEE = "​".repeat(500);

export interface FreeMarketHistoryEntry {
  id: string;
  itemName: string;
  quantity: string;
  price: string;
  sellerRank: string;
  buyerRank: string;
  completedAt: string;
  memberFeeApplied: boolean;
}

export interface FreeMarketHistoryRepository {
  listCompleted(limit: number): Promise<FreeMarketHistoryEntry[]>;
}

interface FreeMarketHistoryRow {
  id: bigint;
  item_name: string;
  quantity: bigint;
  price_amount: string;
  seller_rank: string;
  buyer_rank: string;
  completed_at_text: string;
  member_fee_applied: number;
}

// 자유시장 완료 거래를 최신순 read model로 조회합니다.
export class MariaFreeMarketHistoryRepository implements FreeMarketHistoryRepository {
  constructor(private readonly database: DatabaseClient) {}

  async listCompleted(limit: number): Promise<FreeMarketHistoryEntry[]> {
    const rows = await this.database.query<FreeMarketHistoryRow[]>(
      `SELECT ml.id, item.display_name AS item_name, ml.quantity,
        CAST(settlement.gross_amount AS CHAR) AS price_amount,
        COALESCE((SELECT badge.display_value FROM player_badge_assignments badge
          WHERE badge.player_id = ml.seller_player_id
            AND (badge.starts_at IS NULL OR badge.starts_at <= UTC_TIMESTAMP(3))
            AND (badge.ends_at IS NULL OR badge.ends_at > UTC_TIMESTAMP(3))
          ORDER BY badge.priority DESC, badge.badge_code LIMIT 1), seller.current_display_name) AS seller_rank,
        COALESCE((SELECT badge.display_value FROM player_badge_assignments badge
          WHERE badge.player_id = settlement.buyer_player_id
            AND (badge.starts_at IS NULL OR badge.starts_at <= UTC_TIMESTAMP(3))
            AND (badge.ends_at IS NULL OR badge.ends_at > UTC_TIMESTAMP(3))
          ORDER BY badge.priority DESC, badge.badge_code LIMIT 1), buyer.current_display_name) AS buyer_rank,
        DATE_FORMAT(DATE_ADD(settlement.settled_at, INTERVAL 9 HOUR), '%m/%d %H:%i') AS completed_at_text,
        EXISTS(SELECT 1 FROM market_events event
          WHERE event.listing_id = ml.id AND event.event_code = 'sold'
            AND CAST(JSON_UNQUOTE(JSON_EXTRACT(event.detail_json, '$.feeBasisPoints')) AS UNSIGNED) < 1000) AS member_fee_applied
      FROM market_settlements settlement
      JOIN market_listings ml ON ml.id = settlement.listing_id AND ml.status = 'sold'
      JOIN item_definitions item ON item.id = ml.item_id
      JOIN player_profiles seller ON seller.player_id = ml.seller_player_id
      JOIN player_profiles buyer ON buyer.player_id = settlement.buyer_player_id
      ORDER BY settlement.settled_at DESC, ml.id DESC
      LIMIT ?`,
      [limit]
    );
    return rows.map((row) => ({
      id: row.id.toString(),
      itemName: row.item_name,
      quantity: row.quantity.toString(),
      price: integerDecimal(row.price_amount),
      sellerRank: row.seller_rank,
      buyerRank: row.buyer_rank,
      completedAt: row.completed_at_text,
      memberFeeApplied: Boolean(row.member_fee_applied)
    }));
  }
}

// 자유시장 거래현황 명령과 단축 별칭만 정확히 판별합니다.
export function isFreeMarketHistoryCommand(message: string | undefined): boolean {
  return message === "/자유시장거래현황" || message === "ㅅㅅ";
}

// 정확한 자유시장 거래현황 명령을 조회·렌더링합니다.
export async function handleFreeMarketHistoryCommand(
  message: string | undefined,
  repository: FreeMarketHistoryRepository
): Promise<string | undefined> {
  if (!isFreeMarketHistoryCommand(message)) return undefined;
  return formatFreeMarketHistory(await repository.listCompleted(100));
}

// DB DECIMAL 문자열을 legacy 정수 포인트로 정규화합니다.
function integerDecimal(value: string): string {
  const integer = value.split(".")[0] ?? "0";
  return BigInt(integer).toString();
}

// 정수 문자열에 천 단위 구분자를 추가합니다.
function withCommas(value: string | bigint): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// legacy 만·억 단축 표기를 정수 정밀도로 생성합니다.
function formatKoreanShort(value: bigint): string {
  if (value >= 100_000_000n) {
    const tenths = (value * 10n + 50_000_000n) / 100_000_000n;
    return tenths % 10n === 0n
      ? `${withCommas(tenths / 10n)}억`
      : `${withCommas(tenths / 10n)}.${tenths % 10n}억`;
  }
  if (value >= 10_000n) return `${withCommas(value / 10_000n)}만`;
  return withCommas(value);
}

// 자유시장 총 가격을 legacy 포인트 형식으로 표시합니다.
function formatPoint(value: bigint): string {
  return `🅟${withCommas(value)}${value >= 100_000_000n ? `(${formatKoreanShort(value)})` : ""}`;
}

// 수량이 둘 이상일 때만 legacy 개당 가격을 표시합니다.
function formatUnitPrice(price: bigint, quantity: bigint): string {
  return quantity < 2n || price <= 0n ? "" : `[개당 ${formatKoreanShort(price / quantity)}]`;
}

// 완료 거래 read model을 legacy KakaoTalk 메시지로 렌더링합니다.
export function formatFreeMarketHistory(entries: FreeMarketHistoryEntry[]): string {
  let out = "🤝 호월 자유시장 거래현황 🤝\n";
  out += "━━━━━━━━━━━━\n";
  out += "📖 최근 판매 완료된 거래금액이 표시됩니다\n";
  out += "📋[아이템x갯수][금액][판매]🤝[구매]\n";
  out += "💰수수료는 판매금액의 10%\n";
  out += "🏪 자유시장회원권 소지시 수수료 5%\n";
  out += "━━━━━━━━━━━━\n";
  out += `자유시장 거래현황 보기가기👈${ALL_SEE}\n`;
  out += "최근 판매 완료된 거래가 표시됩니다.\n\n";
  if (entries.length === 0) return out + "판매 완료된 거래가 없습니다.";
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const price = BigInt(entry.price);
    const quantity = BigInt(entry.quantity);
    const memberTag = entry.memberFeeApplied ? " 자회원🏪(수수료 7%)" : "";
    out += `${index + 1}. [${entry.itemName}x${withCommas(quantity)}개${formatUnitPrice(price, quantity)}]\n`;
    out += `└[${formatPoint(price)}][${entry.sellerRank}]🤝[${entry.buyerRank}]${memberTag}\n`;
    out += `  └(${entry.completedAt})\n\n`;
  }
  return out.trim();
}
