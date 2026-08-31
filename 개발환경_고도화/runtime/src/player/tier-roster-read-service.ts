import { createHash, randomUUID } from "node:crypto";
import { createScopedDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { TierAuthorityProvider, type TierDefinition } from "./tier-authority-provider.js";

const ALLSEE = "\u200b".repeat(500);
const REGULAR_TICKET_CODE = "ITEM-RWD-022";
const ADVANCED_TICKET_CODE = "tier_advanced_ticket";

type TierReadCommand = "roster" | "rank";

interface PlayerTierRow {
  player_id: bigint;
  current_display_name: string | null;
  tier_code: string | null;
  rank_emoji: string | null;
  regular_tickets: bigint | string;
  advanced_tickets: bigint | string;
}

export interface TierRosterMember {
  playerId: bigint;
  displayName: string;
  tierCode: string;
  rankEmoji: string;
  regularTickets: bigint;
  advancedTickets: bigint;
}

export interface TierRankRow extends TierRosterMember {
  points: bigint;
}

export interface TierRosterReadResult {
  status: "completed";
  data: string;
  outboxId: string;
  rowCount: number;
  tierVersionCode: string;
  command: TierReadCommand;
}

// 티어 조회 명령 두 개를 정확히 구분합니다.
export function parseTierRosterReadCommand(message: string | undefined): TierReadCommand | undefined {
  if (message === "/티어확인") return "roster";
  if (message === "/티어순위") return "rank";
  return undefined;
}

// exact 명령만 partial dispatch 후보로 인정합니다.
export function isTierRosterReadCommand(message: string | undefined): boolean {
  return parseTierRosterReadCommand(message) !== undefined;
}

// exact 명령과 DB handler key가 같은 티어 조회 쌍인지 한 번에 판정합니다.
export function isTierRosterReadDispatch(message: string | undefined, handlerKey: string | undefined): boolean {
  const command = parseTierRosterReadCommand(message);
  return (command === "roster" && handlerKey === "tier_roster_read") || (command === "rank" && handlerKey === "tier_rank_read");
}

// 두 command registry handler가 같은 읽기 서비스를 공유하는지 판정합니다.
export function isTierRosterReadHandler(handlerKey: string | undefined): boolean {
  return handlerKey === "tier_roster_read" || handlerKey === "tier_rank_read";
}

// published authority 역순으로 모든 티어와 소속 회원을 출력합니다.
export function formatTierRoster(definitions: readonly TierDefinition[], members: readonly TierRosterMember[]): string {
  const byTier = new Map<string, TierRosterMember[]>();
  for (const member of members) {
    const bucket = byTier.get(member.tierCode) ?? [];
    bucket.push(member);
    byTier.set(member.tierCode, bucket);
  }
  const lines = ["[티어]", "현재 티어 정보:"];
  const reversed = [...definitions].sort((left, right) => right.tierOrder - left.tierOrder);
  reversed.forEach((definition, index) => {
    const names = (byTier.get(definition.tierCode) ?? [])
      .sort((left, right) => compareBigInt(left.playerId, right.playerId))
      .map((member) => member.displayName);
    lines.push(`${index + 1}. ${definition.rankEmoji}${definition.displayName}: ${names.length > 0 ? names.join(", ") : "-"}`);
    if (index === 9) lines.push(ALLSEE);
  });
  return lines.join("\n").trim();
}

// 일반 티켓 1점·고급 티켓 300점과 stable player identity로 순위를 계산합니다.
export function buildTierRanking(members: readonly TierRosterMember[]): TierRankRow[] {
  return members.map((member) => ({ ...member, points: member.regularTickets + member.advancedTickets * 300n }))
    .sort((left, right) => compareBigInt(right.points, left.points) || compareBigInt(left.playerId, right.playerId));
}

// 레거시 티어 순위 UI와 10명 접힘 경계를 보존합니다.
export function formatTierRanking(rows: readonly TierRankRow[]): string {
  const lines = rows.map((row, index) => `${rankLabel(index + 1)}${row.rankEmoji}${row.displayName} - pt: ${commas(row.points)}`);
  return `🌟티어 순위🌟\n\n[🎟일반 1pt 🎫고급 300pt 적용]\n${lines.slice(0, 10).join("\n")}${ALLSEE}\n${lines.slice(10).join("\n")}`.trimEnd();
}

// active 회원의 canonical tier와 티켓 잔액을 읽고 조회 증거를 원자 기록합니다.
export class TierRosterReadService {
  public constructor(private readonly database: DatabaseClient) {}

  public async handle(input: { eventId: string; externalUserId: string; channelId: string; message: string }): Promise<TierRosterReadResult | null> {
    const command = parseTierRosterReadCommand(input.message);
    if (command === undefined) throw new ApplicationError("INVALID_TIER_READ_COMMAND", "티어 조회 명령 형식이 올바르지 않습니다.", 422);
    return this.database.withTransaction(async (transaction) => {
      const actor = (await transaction.query<Array<{ identity_id: bigint }>>(
        "SELECT id identity_id FROM external_identities WHERE provider_code='kakao' AND external_user_id=? AND status='linked' LIMIT 1 FOR UPDATE",
        [input.externalUserId]
      ))[0];
      if (actor === undefined) return null;
      const scope = command === "roster" ? "player.tier_roster_read" : "player.tier_rank_read";
      const commandCode = command === "roster" ? "TIER_ROSTER_READ" : "TIER_RANK_READ";
      const idempotencyKey = input.eventId.length <= 191 ? input.eventId : `sha256:${createHash("sha256").update(input.eventId).digest("hex")}`;
      const prior = await readPriorResult(transaction, scope, idempotencyKey);
      if (prior !== undefined) return prior;

      const authority = await new TierAuthorityProvider(createScopedDatabaseClient(transaction)).loadPublished();
      const itemDefinitions = await transaction.query<Array<{ code: string }>>(
        "SELECT code FROM item_definitions WHERE code IN (?,?) AND active=TRUE ORDER BY code FOR UPDATE",
        [REGULAR_TICKET_CODE, ADVANCED_TICKET_CODE]
      );
      if (itemDefinitions.length !== 2) throw new ApplicationError("TIER_TICKET_DEFINITION_REQUIRED", "티어 승급티켓 정의가 완전하지 않습니다.", 409);
      const rows = await transaction.query<PlayerTierRow[]>(
        `SELECT player.id player_id,profile.current_display_name,profile.tier_code,legacy.rank_emoji,
                COALESCE(SUM(CASE WHEN item.code=? THEN stack.quantity ELSE 0 END),0) regular_tickets,
                COALESCE(SUM(CASE WHEN item.code=? THEN stack.quantity ELSE 0 END),0) advanced_tickets
           FROM players player
      LEFT JOIN player_profiles profile ON profile.player_id=player.id
      LEFT JOIN player_legacy_rank_profiles legacy ON legacy.player_id=player.id
      LEFT JOIN inventory_stacks stack ON stack.player_id=player.id
      LEFT JOIN item_definitions item ON item.id=stack.item_id AND item.code IN (?,?)
          WHERE player.status='active' AND player.deleted_at IS NULL
       GROUP BY player.id,profile.current_display_name,profile.tier_code,legacy.rank_emoji
       ORDER BY player.id FOR UPDATE`,
        [REGULAR_TICKET_CODE, ADVANCED_TICKET_CODE, REGULAR_TICKET_CODE, ADVANCED_TICKET_CODE]
      );
      const knownTierCodes = new Set(authority.definitions.map((definition) => definition.tierCode));
      const members = rows.map((row) => {
        if (row.current_display_name === null || row.current_display_name.trim() === "" || row.tier_code === null || row.rank_emoji === null) {
          throw new ApplicationError("TIER_MEMBER_STATE_INCOMPLETE", `회원 ${row.player_id}님의 이름·티어·랭크 데이터가 완전하지 않습니다.`, 409);
        }
        if (!knownTierCodes.has(row.tier_code)) {
          throw new ApplicationError("TIER_MEMBER_CODE_INVALID", `${row.current_display_name}님의 티어가 published 카탈로그에 없습니다.`, 409);
        }
        return { playerId: BigInt(row.player_id), displayName: row.current_display_name, tierCode: row.tier_code, rankEmoji: row.rank_emoji,
          regularTickets: BigInt(row.regular_tickets), advancedTickets: BigInt(row.advanced_tickets) } satisfies TierRosterMember;
      });
      const data = command === "roster" ? formatTierRoster(authority.definitions, members) : formatTierRanking(buildTierRanking(members));
      const operationId = (await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), scope, idempotencyKey, actor.identity_id]
      )).insertId;
      const outboxId = (await transaction.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operationId, input.channelId, JSON.stringify({ data })]
      )).insertId;
      await transaction.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [input.eventId, commandCode, operationId]
      );
      await transaction.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'tier_catalog',NULL,?,'success',?, ?,UTC_TIMESTAMP(3))",
        [operationId, actor.identity_id, scope, `Iris ${input.message}`, JSON.stringify({ command, tierVersionCode: authority.versionCode, rowCount: members.length,
          stablePlayerIds: members.map((member) => member.playerId.toString()), readOnly: true })]
      );
      const result: TierRosterReadResult = { status: "completed", data, outboxId: outboxId.toString(), rowCount: members.length,
        tierVersionCode: authority.versionCode, command };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operationId]);
      return result;
    });
  }
}

// 같은 event의 완료 결과를 추가 조회·기록 없이 replay합니다.
async function readPriorResult(transaction: DatabaseTransaction, scope: string, idempotencyKey: string): Promise<TierRosterReadResult | undefined> {
  const rows = await transaction.query<Array<{ result_json: string | TierRosterReadResult | null }>>(
    "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, idempotencyKey]
  );
  const prior = rows[0]?.result_json;
  if (prior === undefined || prior === null) return undefined;
  return typeof prior === "string" ? JSON.parse(prior) : prior;
}

function rankLabel(rank: number): string {
  return rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `${rank}위 `;
}

function commas(value: bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function compareBigInt(left: bigint, right: bigint): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
