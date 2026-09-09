import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";

export interface PointRankRow {
  playerId: string;
  displayName: string;
  rankEmoji: string;
  balance: string;
}

export interface PrivilegedPointRankReadResult {
  data: string;
  outboxId: string;
  rowCount: number;
}

// 레거시와 동일하게 정확한 관리자 포인트 확인 명령만 허용합니다.
export function isPrivilegedPointRankReadCommand(message: string | undefined): boolean {
  return message === "/포인트확인";
}

// canonical 포인트 잔액 순서를 레거시 관리자 순위 UI로 변환합니다.
export function formatPrivilegedPointRanking(rows: readonly PointRankRow[]): string {
  const body = rows.map((row, index) => `${rankLabel(index + 1)}[${row.rankEmoji}${row.displayName}] 🅟${commas(row.balance)}`).join("\n");
  return `🏆 포인트 잔액 순위 🏆\n\n${body}${body.length === 0 ? "" : "\n"}`;
}

// super_admin 권한을 확인하고 전체 활성 회원의 포인트 잔액을 읽어 감사·outbox와 원자 기록합니다.
export class PrivilegedPointRankReadService {
  public constructor(private readonly database: DatabaseClient) {}

  public async read(input: { eventId: string; externalUserId: string; destinationId: string }): Promise<PrivilegedPointRankReadResult | null> {
    const operator = (await this.database.query<Array<{ id: bigint }>>(
      `SELECT operator.id
         FROM external_identities identity
         JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
         JOIN admin_operators operator ON operator.id=mapping.operator_id
         JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
         JOIN admin_roles role ON role.id=operator_role.role_id
         JOIN admin_role_permissions permission ON permission.role_id=role.id
        WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
          AND operator.status='active' AND role.active=TRUE AND role.code='super_admin'
          AND permission.permission_code='player.point.rank.read'
        LIMIT 1`,
      [input.externalUserId]
    ))[0];
    if (operator === undefined) return null;

    return this.database.withTransaction(async (transaction) => {
      const idempotencyKey = input.eventId.length <= 191
        ? input.eventId
        : `sha256:${createHash("sha256").update(input.eventId).digest("hex")}`;
      const prior = await readPriorResult(transaction, idempotencyKey);
      if (prior !== undefined) return prior;

      const sourceRows = await transaction.query<Array<{ player_id: bigint; current_display_name: string; rank_emoji: string; balance: string }>>(
        `SELECT player.id player_id,profile.current_display_name,legacy.rank_emoji,
                CAST(COALESCE(account.balance,0) AS CHAR) balance
           FROM players player
           JOIN player_profiles profile ON profile.player_id=player.id
           JOIN player_legacy_rank_profiles legacy ON legacy.player_id=player.id
      LEFT JOIN currency_accounts account ON account.player_id=player.id AND account.currency_code='point'
          WHERE player.status='active' AND player.deleted_at IS NULL
       ORDER BY COALESCE(account.balance,0) DESC,profile.current_display_name COLLATE utf8mb4_unicode_ci ASC,player.id ASC
            FOR UPDATE`
      );
      const rows: PointRankRow[] = sourceRows.map((row) => ({
        playerId: row.player_id.toString(), displayName: row.current_display_name, rankEmoji: row.rank_emoji, balance: row.balance
      }));
      const data = formatPrivilegedPointRanking(rows);
      const operationId = (await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'player.point_rank_read',?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), idempotencyKey, operator.id]
      )).insertId;
      const outboxId = (await transaction.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operationId, input.destinationId, JSON.stringify({ data })]
      )).insertId;
      await transaction.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'PRIVILEGED_POINT_RANK_READ',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [input.eventId, operationId]
      );
      await transaction.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'leaderboard',NULL,'player.point_rank_read','success','Iris /포인트확인',?,UTC_TIMESTAMP(3))",
        [operationId, operator.id, JSON.stringify({ rowCount: rows.length, stablePlayerIds: rows.map((row) => row.playerId), currencyCode: "point", readOnly: true })]
      );
      const result: PrivilegedPointRankReadResult = { data, outboxId: outboxId.toString(), rowCount: rows.length };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operationId]);
      return result;
    });
  }
}

// 같은 Iris event의 완료 결과를 추가 조회·기록 없이 replay합니다.
async function readPriorResult(transaction: DatabaseTransaction, idempotencyKey: string): Promise<PrivilegedPointRankReadResult | undefined> {
  const prior = (await transaction.query<Array<{ result_json: string | PrivilegedPointRankReadResult | null }>>(
    "SELECT result_json FROM operations WHERE idempotency_scope='player.point_rank_read' AND idempotency_key=? FOR UPDATE", [idempotencyKey]
  ))[0]?.result_json;
  if (prior === undefined || prior === null) return undefined;
  return typeof prior === "string" ? JSON.parse(prior) : prior;
}

function rankLabel(rank: number): string {
  if (rank === 1) return "🥇. ";
  if (rank === 2) return "🥈. ";
  if (rank === 3) return "🥉. ";
  return `${rank < 10 ? "  " : " "}${rank}. `;
}

function commas(value: string): string {
  return BigInt(value.split(".")[0] ?? "0").toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
