import { randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

export const DAILY_RESET_COUNTER_CODES = [
  "petraid", "raidItemCount", "noticeItemCount", "noticeYahoCount", "noticePremiumCount",
  "carrotBuyCount", "diamondBoxBuyCount", "battle.ticket", "battle.count", "homeLikeCnt",
  "cntlike", "petHomeCommentCnt", "feedPostCnt", "homeAlertOpenCnt", "towerCnt", "exploreCnt",
  "gMedalBuyCnt", "gContribCnt", "gBoosterContribCnt", "dailyQuestCnt", "passDailyQuestCnt",
  "premiumDailyQuestCnt", "coincount", "guild.ticketBuyCount", "guild.distributeCount",
  "guild.medalShopBuyCount", "guild.markPurchaseCount"
] as const;

export type DailyResetStepCode = "carrot_board" | "attendance" | "player_counters" | "pet_daily" | "explore_scheduler";
export interface DailyResetStepResult { stepCode: DailyResetStepCode; affectedCount: number; }
export interface DailyResetResult {
  status: "completed";
  periodKey: string;
  operationId: string;
  runId: string;
  replayed: boolean;
  steps: DailyResetStepResult[];
  totalAffected: number;
}
export interface DailyResetPreview { periodKey: string; steps: DailyResetStepResult[]; totalAffected: number; }

// UTC 시각을 레거시 운영 기준인 KST 일자 키로 변환합니다.
export function dailyResetKstPeriodKey(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function countValue(row: { count: bigint | number | string } | undefined): number {
  return Number(row?.count ?? 0);
}

function parsedResult(value: string | DailyResetResult): DailyResetResult {
  return typeof value === "string" ? JSON.parse(value) as DailyResetResult : value;
}

// 레거시 일일 초기화 상태를 canonical DB projection에서 원자적으로 초기화합니다.
export class CommonDailyResetProvider {
  constructor(private readonly database: DatabaseClient) {}

  async preview(periodKey = dailyResetKstPeriodKey()): Promise<DailyResetPreview> {
    const placeholders = DAILY_RESET_COUNTER_CODES.map(() => "?").join(",");
    const values = [...DAILY_RESET_COUNTER_CODES, periodKey, periodKey];
    const [carrot, attendance, counters, petDaily, scheduler] = await Promise.all([
      this.database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM carrot_board_posts WHERE status='published'"),
      this.database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM player_attendance WHERE period_key=? AND (attendance_count<>0 OR last_attended_at IS NOT NULL OR light_enabled<>FALSE)", [periodKey]),
      this.database.query<Array<{ count: bigint }>>(`SELECT COUNT(*) count FROM player_counters WHERE counter_code IN (${placeholders}) AND period_key IN (?,'current','lifetime') AND value<>0`, values),
      this.database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM player_pet_daily_records WHERE record_date=? AND (tower_attempts<>0 OR castle_battle_attempts<>0 OR castle_battle_score<>0 OR mini_battle_attempts<>0 OR mini_battle_wins<>0 OR mini_battle_losses<>0 OR explore_attempts<>0 OR explore_wins<>0 OR explore_losses<>0 OR daily_quest_rewarded<>FALSE OR pet_home_comment_count<>0 OR feed_post_count<>0 OR home_alert_open_count<>0)", [periodKey]),
      this.database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM pet_explore_scheduler_state WHERE schedule_code='pet_explore' AND (active<>FALSE OR immediate_run_pending<>FALSE OR next_run_at IS NOT NULL OR lease_owner IS NOT NULL OR lease_until IS NOT NULL OR started_operation_id IS NOT NULL)")
    ]);
    const steps: DailyResetStepResult[] = [
      { stepCode: "carrot_board", affectedCount: countValue(carrot[0]) },
      { stepCode: "attendance", affectedCount: countValue(attendance[0]) },
      { stepCode: "player_counters", affectedCount: countValue(counters[0]) },
      { stepCode: "pet_daily", affectedCount: countValue(petDaily[0]) },
      { stepCode: "explore_scheduler", affectedCount: countValue(scheduler[0]) }
    ];
    return { periodKey, steps, totalAffected: steps.reduce((sum, step) => sum + step.affectedCount, 0) };
  }

  async reset(input: { eventId: string; operatorId: string; periodKey?: string }): Promise<DailyResetResult> {
    const periodKey = input.periodKey ?? dailyResetKstPeriodKey();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(periodKey)) throw new ApplicationError("DAILY_RESET_PERIOD_INVALID", "일일 초기화 일자 형식이 올바르지 않습니다.", 400);
    return this.database.withTransaction(async (transaction) => {
      const lock = await transaction.query<Array<{ lock_code: string }>>("SELECT lock_code FROM daily_reset_global_locks WHERE lock_code='legacy_daily_reset' FOR UPDATE");
      if (lock[0] === undefined) throw new ApplicationError("DAILY_RESET_LOCK_MISSING", "일일 초기화 전역 잠금이 없습니다.", 409);
      const prior = await transaction.query<Array<{ result_json: string | DailyResetResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope='common.daily_reset' AND idempotency_key=? FOR UPDATE", [input.eventId]);
      if (prior[0]?.result_json != null) return { ...parsedResult(prior[0].result_json), replayed: true };
      const samePeriod = await transaction.query<Array<{ result_json: string | DailyResetResult | null }>>("SELECT result_json FROM daily_reset_runs WHERE period_key=? AND status='completed' FOR UPDATE", [periodKey]);
      if (samePeriod[0]?.result_json != null) return { ...parsedResult(samePeriod[0].result_json), replayed: true };
      const operation = await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'common.daily_reset',?,'admin_operator',?,'provider','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), input.eventId, input.operatorId]
      );
      const run = await transaction.execute("INSERT INTO daily_reset_runs(operation_id,period_key,status) VALUES (?,?,'processing')", [operation.insertId, periodKey]);
      const steps = await this.mutate(transaction, run.insertId, periodKey);
      const result: DailyResetResult = { status: "completed", periodKey, operationId: operation.insertId.toString(), runId: run.insertId.toString(), replayed: false, steps, totalAffected: steps.reduce((sum, step) => sum + step.affectedCount, 0) };
      await transaction.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'daily_reset_run',?,'common.daily_reset','success','공용 일일 초기화 provider',?,UTC_TIMESTAMP(3))",
        [operation.insertId, input.operatorId, run.insertId, JSON.stringify({ periodKey, steps, totalAffected: result.totalAffected })]
      );
      await transaction.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'internal','daily-reset','domain_event',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operation.insertId, JSON.stringify({ type: "common.daily_reset.completed", periodKey, runId: result.runId, steps })]
      );
      await transaction.execute("UPDATE daily_reset_runs SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), run.insertId]);
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }

  private async mutate(transaction: DatabaseTransaction, runId: bigint, periodKey: string): Promise<DailyResetStepResult[]> {
    const placeholders = DAILY_RESET_COUNTER_CODES.map(() => "?").join(",");
    const statements: Array<{ code: DailyResetStepCode; sql: string; values: readonly unknown[] }> = [
      { code: "carrot_board", sql: "UPDATE carrot_board_posts SET status='deleted',deleted_at=UTC_TIMESTAMP(3) WHERE status='published'", values: [] },
      { code: "attendance", sql: "UPDATE player_attendance SET attendance_count=0,last_attended_at=NULL,light_enabled=FALSE,version=version+1 WHERE period_key=? AND (attendance_count<>0 OR last_attended_at IS NOT NULL OR light_enabled<>FALSE)", values: [periodKey] },
      { code: "player_counters", sql: `UPDATE player_counters SET value=0,updated_at=UTC_TIMESTAMP(3) WHERE counter_code IN (${placeholders}) AND period_key IN (?,'current','lifetime') AND value<>0`, values: [...DAILY_RESET_COUNTER_CODES, periodKey] },
      { code: "pet_daily", sql: "UPDATE player_pet_daily_records SET tower_attempts=0,castle_battle_attempts=0,castle_battle_score=0,castle_rank_label=NULL,mini_battle_attempts=0,mini_battle_wins=0,mini_battle_losses=0,explore_attempts=0,explore_wins=0,explore_losses=0,daily_quest_rewarded=FALSE,pet_home_comment_count=0,feed_post_count=0,home_alert_open_count=0,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE record_date=? AND (tower_attempts<>0 OR castle_battle_attempts<>0 OR castle_battle_score<>0 OR castle_rank_label IS NOT NULL OR mini_battle_attempts<>0 OR mini_battle_wins<>0 OR mini_battle_losses<>0 OR explore_attempts<>0 OR explore_wins<>0 OR explore_losses<>0 OR daily_quest_rewarded<>FALSE OR pet_home_comment_count<>0 OR feed_post_count<>0 OR home_alert_open_count<>0)", values: [periodKey] },
      { code: "explore_scheduler", sql: "UPDATE pet_explore_scheduler_state SET active=FALSE,immediate_run_pending=FALSE,next_run_at=NULL,generation=generation+1,lease_owner=NULL,lease_until=NULL,started_operation_id=NULL WHERE schedule_code='pet_explore' AND (active<>FALSE OR immediate_run_pending<>FALSE OR next_run_at IS NOT NULL OR lease_owner IS NOT NULL OR lease_until IS NOT NULL OR started_operation_id IS NOT NULL)", values: [] }
    ];
    const results: DailyResetStepResult[] = [];
    for (let index = 0; index < statements.length; index += 1) {
      const statement = statements[index]!;
      const mutation = await transaction.execute(statement.sql, statement.values);
      const affectedCount = Number(mutation.affectedRows);
      await transaction.execute("INSERT INTO daily_reset_steps(run_id,step_code,step_order,affected_count,summary_json) VALUES (?,?,?,?,?)", [runId, statement.code, index + 1, mutation.affectedRows, JSON.stringify({ periodKey, affectedCount })]);
      results.push({ stepCode: statement.code, affectedCount });
    }
    return results;
  }
}
