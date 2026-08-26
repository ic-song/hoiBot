import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

export interface LordIncomeRow { playerId: string; displayName: string; amount: string; }
export interface LordIncomeResult { data: string; outboxId: string; rowCount: number; }
export interface LordIncomeResetResult { data: string; outboxId: string; affectedPlayerCount: number; totalBefore: string; auditId: string; }

// 영주 수익 행을 10명 경계에서 안전하게 기존 순위 UI로 변환합니다.
export function formatLordIncomeRanking(rows: LordIncomeRow[]): string {
  const ranking = rows.map((entry, index) => `${rankLabel(index + 1)}${entry.displayName} - 👑: ${formatInteger(entry.amount)}\n`);
  return `🏰 영주 수익 순위 🏰\n\n${ranking.slice(0, 10).join("")}${"\u200b".repeat(500)}${ranking.slice(10).join("")}`;
}

// 영주 수익 조회와 전역 초기화를 멱등 operation·감사·outbox로 처리합니다.
export class LordIncomeService {
  constructor(private readonly database: DatabaseClient) {}

  async readRanking(input: { idempotencyKey: string; sourceEventId: string; destinationId: string; externalUserId: string }): Promise<LordIncomeResult> {
    const scope = "lord_income.rank_read";
    return this.database.withTransaction(async (transaction) => {
      const prior = await transaction.query<Array<{ result_json: string | LordIncomeResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, input.idempotencyKey]
      );
      if (prior[0]?.result_json != null) return typeof prior[0].result_json === "string" ? JSON.parse(prior[0].result_json) : prior[0].result_json;
      const rows = await transaction.query<Array<{ player_id: bigint; current_display_name: string; amount: string }>>(
        `SELECT earning.player_id,profile.current_display_name,CAST(earning.amount AS CHAR) AS amount
         FROM player_lord_earnings earning JOIN player_profiles profile ON profile.player_id=earning.player_id
         WHERE earning.amount>0 ORDER BY earning.amount DESC,earning.player_id ASC`
      );
      const operation = await transaction.execute(
        `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?,?,?,'external_identity',NULL,'iris','processing',UTC_TIMESTAMP(3))`, [randomUUID(), scope, input.idempotencyKey]
      );
      const data = formatLordIncomeRanking(rows.map((entry) => ({ playerId: entry.player_id.toString(), displayName: entry.current_display_name, amount: entry.amount })));
      await transaction.execute(
        `INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES (?,'external_identity',NULL,'leaderboard',NULL,'lord_income.rank_read','success','Iris /영주수익순위',?,UTC_TIMESTAMP(3))`,
        [operation.insertId, JSON.stringify({ externalUserId: input.externalUserId, rowCount: rows.length })]
      );
      await transaction.execute(
        `INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)
         VALUES (?,'LORD_INCOME_RANK_READ',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, [input.sourceEventId, operation.insertId]
      );
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
         VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, [operation.insertId, input.destinationId, JSON.stringify({ data })]
      );
      const result = { data, outboxId: outbox.insertId.toString(), rowCount: rows.length };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }

  async reset(input: { idempotencyKey: string; sourceEventId: string; destinationId: string; operatorId: string }): Promise<LordIncomeResetResult> {
    const scope = "lord_income.reset_all";
    return this.database.withTransaction(async (transaction) => {
      const prior = await transaction.query<Array<{ result_json: string | LordIncomeResetResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, input.idempotencyKey]
      );
      if (prior[0]?.result_json != null) return typeof prior[0].result_json === "string" ? JSON.parse(prior[0].result_json) : prior[0].result_json;
      const rows = await transaction.query<Array<{ player_id: bigint; amount: string; version: bigint }>>(
        "SELECT player_id,CAST(amount AS CHAR) AS amount,version FROM player_lord_earnings ORDER BY player_id FOR UPDATE"
      );
      const operation = await transaction.execute(
        `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))`, [randomUUID(), scope, input.idempotencyKey, input.operatorId]
      );
      let affectedPlayerCount = 0;
      let totalBefore = 0n;
      for (const entry of rows) {
        const amount = BigInt(entry.amount);
        totalBefore += amount;
        if (amount === 0n) continue;
        const update = await transaction.execute(
          "UPDATE player_lord_earnings SET amount=0,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND version=?",
          [entry.player_id, entry.version]
        );
        if (update.affectedRows !== 1n) throw new ApplicationError("LORD_INCOME_VERSION_CONFLICT", "영주 수익이 먼저 변경되었습니다.", 409);
        affectedPlayerCount += 1;
      }
      const data = "영주수익순위가 초기화되었습니다.";
      const audit = await transaction.execute(
        `INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES (?,'admin_operator',?,'leaderboard',NULL,'lord_income.reset_all','success','Iris 총괄 운영자 /영주수익순위초기화',?,UTC_TIMESTAMP(3))`,
        [operation.insertId, input.operatorId, JSON.stringify({ affectedPlayerCount, totalBefore: totalBefore.toString() })]
      );
      await transaction.execute(
        `INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)
         VALUES (?,'ADMIN_LORD_INCOME_RESET',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, [input.sourceEventId, operation.insertId]
      );
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
         VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, [operation.insertId, input.destinationId, JSON.stringify({ data })]
      );
      const result = { data, outboxId: outbox.insertId.toString(), affectedPlayerCount, totalBefore: totalBefore.toString(), auditId: audit.insertId.toString() };
      await transaction.execute(
        "INSERT INTO lord_income_reset_mutations(operation_id,affected_player_count,total_before,result_json) VALUES (?,?,?,?)",
        [operation.insertId, affectedPlayerCount, totalBefore.toString(), JSON.stringify(result)]
      );
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}

function rankLabel(rank: number): string { return rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `${rank}위 `; }
function formatInteger(value: string): string { return BigInt(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
