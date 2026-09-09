import { randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

export type WeeklyQuestCountCommand =
  | { kind: "update"; targetDisplayName: string; count: bigint }
  | { kind: "reset" };

export interface WeeklyQuestCountResult {
  data: string;
  outboxId: string;
  kind: "update" | "reset";
  targetPlayerId: string | null;
  targetDisplayName: string | null;
  count: string;
  affectedPlayerCount: number;
  totalBefore: string;
  changed: boolean;
}

const maxUnsignedBigInt = 18_446_744_073_709_551_615n;

// 주간 횟수 명령은 exact 초기화 또는 쉼표와 완전한 정수 인자의 수정만 허용합니다.
export function isWeeklyQuestCountCommandCandidate(message: string | undefined): boolean {
  return message === "/주간횟수초기화"
    || (message !== undefined && /^\/주간횟수수정\s+[^,\r\n]+,\s*\d+$/.test(message));
}

// 주간 횟수 수정 대상과 unsigned count를 안정 식별자로 변환합니다.
export function parseWeeklyQuestCountCommand(message: string): WeeklyQuestCountCommand {
  if (message === "/주간횟수초기화") return { kind: "reset" };
  const match = /^\/주간횟수수정\s+([^,\r\n]+),\s*(\d+)$/.exec(message);
  if (match === null) throw new ApplicationError("INVALID_WEEKLY_QUEST_COUNT_COMMAND", "사용법: /주간횟수수정 유저명, 숫자", 422);
  const targetDisplayName = match[1]!.trim();
  const count = BigInt(match[2]!);
  if (targetDisplayName.length === 0 || count > maxUnsignedBigInt) {
    throw new ApplicationError("INVALID_WEEKLY_QUEST_COUNT", "주간횟수는 0 이상의 숫자로 입력해주세요.", 422);
  }
  return { kind: "update", targetDisplayName, count };
}

// 주간 횟수 수정·전체 초기화 응답을 legacy 줄바꿈과 단위로 생성합니다.
export function formatWeeklyQuestCountReply(input: { command: WeeklyQuestCountCommand; affectedPlayerCount: number }): string {
  if (input.command.kind === "reset") {
    return `전체 유저 주간횟수 초기화 완료\n초기화된 유저 수: ${input.affectedPlayerCount}명`;
  }
  return `[${input.command.targetDisplayName}] 님의 주간횟수가 ${input.command.count}회로 수정되었습니다.`;
}

// KST 현재 기록을 stable player lock 아래 수정·초기화하고 공용 원장을 원자 기록합니다.
export class WeeklyQuestCountService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(input: { command: WeeklyQuestCountCommand; idempotencyKey: string; sourceEventId: string; destinationId: string; operatorId: string }): Promise<WeeklyQuestCountResult> {
    const scope = input.command.kind === "update" ? "admin.weekly_quest_count.update" : "admin.weekly_quest_count.reset";
    return this.database.withTransaction(async (transaction) => {
      if (input.command.kind === "reset") {
        const locks = await transaction.query<Array<{ lock_code: string }>>(
          "SELECT lock_code FROM admin_global_locks WHERE lock_code='weekly_quest_count_reset' FOR UPDATE"
        );
        if (locks[0] === undefined) throw new ApplicationError("WEEKLY_QUEST_RESET_LOCK_MISSING", "주간 횟수 초기화 잠금 설정이 없습니다.", 409);
      }
      const prior = await transaction.query<Array<{ result_json: string | WeeklyQuestCountResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, input.idempotencyKey]
      );
      if (prior[0]?.result_json != null) {
        return typeof prior[0].result_json === "string" ? JSON.parse(prior[0].result_json) : prior[0].result_json;
      }

      const state = input.command.kind === "update"
        ? await prepareUpdate(transaction, input.command.targetDisplayName)
        : await prepareReset(transaction);
      const operation = await transaction.execute(
        `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, input.idempotencyKey, input.operatorId]
      );
      let changed = false;
      let count = "0";
      if (input.command.kind === "update") {
        count = input.command.count.toString();
        changed = state.rows[0]!.weekly_quest_count !== count;
        if (changed) await updateRow(transaction, state.rows[0]!, input.command.count);
      } else {
        for (const entry of state.rows) {
          if (entry.weekly_quest_count === "0") continue;
          await updateRow(transaction, entry, 0n);
          changed = true;
        }
      }

      const affectedPlayerCount = input.command.kind === "update" ? 1 : state.rows.length;
      const totalBefore = state.rows.reduce((total, entry) => total + BigInt(entry.weekly_quest_count), 0n);
      const data = formatWeeklyQuestCountReply({ command: input.command, affectedPlayerCount });
      const before = state.rows.map((entry) => ({ playerId: entry.player_id.toString(), count: entry.weekly_quest_count, version: entry.version.toString() }));
      const after = input.command.kind === "update"
        ? [{ playerId: state.rows[0]!.player_id.toString(), count, version: (state.rows[0]!.version + (changed ? 1n : 0n)).toString() }]
        : state.rows.map((entry) => ({ playerId: entry.player_id.toString(), count: "0", version: (entry.version + (entry.weekly_quest_count === "0" ? 0n : 1n)).toString() }));
      const audit = await transaction.execute(
        `INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES (?,'admin_operator',?,'weekly_quest_count',?,?, 'success',?,?,UTC_TIMESTAMP(3))`,
        [operation.insertId, input.operatorId, state.targetPlayerId, scope,
          input.command.kind === "update" ? "Iris 총괄 운영자 /주간횟수수정" : "Iris 총괄 운영자 /주간횟수초기화",
          JSON.stringify({ changed, affectedPlayerCount, totalBefore: totalBefore.toString(), before, after })]
      );
      await transaction.execute(
        `INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)
         VALUES (?,'ADMIN_WEEKLY_QUEST_COUNT_MUTATE',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [input.sourceEventId, operation.insertId]
      );
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
         VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [operation.insertId, input.destinationId, JSON.stringify({ data })]
      );
      const result: WeeklyQuestCountResult = { data, outboxId: outbox.insertId.toString(), kind: input.command.kind,
        targetPlayerId: state.targetPlayerId?.toString() ?? null,
        targetDisplayName: input.command.kind === "update" ? input.command.targetDisplayName : null,
        count, affectedPlayerCount, totalBefore: totalBefore.toString(), changed };
      await transaction.execute(
        `INSERT INTO admin_weekly_quest_count_mutations(operation_id,mutation_kind,target_player_id,affected_player_count,total_before,before_json,after_json)
         VALUES (?,?,?,?,?,?,?)`,
        [operation.insertId, input.command.kind, state.targetPlayerId, affectedPlayerCount, totalBefore.toString(), JSON.stringify(before), JSON.stringify({ rows: after, auditId: audit.insertId.toString() })]
      );
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}

interface WeeklyCountRow { player_id: bigint; weekly_quest_count: string; version: bigint; }

async function prepareUpdate(transaction: DatabaseTransaction, targetDisplayName: string): Promise<{ rows: WeeklyCountRow[]; targetPlayerId: bigint }> {
  const targets = await transaction.query<Array<{ player_id: bigint }>>(
    "SELECT player_id FROM player_profiles WHERE current_display_name=? ORDER BY player_id LIMIT 2", [targetDisplayName]
  );
  if (targets.length === 0) throw new ApplicationError("PLAYER_NOT_FOUND", `${targetDisplayName}은(는) 등록되어 있지 않습니다.`, 404);
  if (targets.length > 1) throw new ApplicationError("PLAYER_NAME_AMBIGUOUS", "동일 표시명의 회원이 여러 명이므로 player ID 기준 수정이 필요합니다.", 409);
  const playerId = targets[0]!.player_id;
  await transaction.execute(
    "INSERT INTO player_pet_daily_records(player_id,record_date) VALUES (?,DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR))) ON DUPLICATE KEY UPDATE player_id=VALUES(player_id)",
    [playerId]
  );
  const rows = await transaction.query<WeeklyCountRow[]>(
    "SELECT player_id,CAST(weekly_quest_count AS CHAR) weekly_quest_count,version FROM player_pet_daily_records WHERE player_id=? AND record_date=DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR)) FOR UPDATE",
    [playerId]
  );
  return { rows, targetPlayerId: playerId };
}

async function prepareReset(transaction: DatabaseTransaction): Promise<{ rows: WeeklyCountRow[]; targetPlayerId: null }> {
  await transaction.execute(
    `INSERT INTO player_pet_daily_records(player_id,record_date)
     SELECT id,DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR)) FROM players WHERE status='active'
     ON DUPLICATE KEY UPDATE player_id=VALUES(player_id)`
  );
  const rows = await transaction.query<WeeklyCountRow[]>(
    `SELECT daily.player_id,CAST(daily.weekly_quest_count AS CHAR) weekly_quest_count,daily.version
     FROM player_pet_daily_records daily JOIN players player ON player.id=daily.player_id AND player.status='active'
     WHERE daily.record_date=DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR)) ORDER BY daily.player_id FOR UPDATE`
  );
  return { rows, targetPlayerId: null };
}

async function updateRow(transaction: DatabaseTransaction, row: WeeklyCountRow, count: bigint): Promise<void> {
  const update = await transaction.execute(
    `UPDATE player_pet_daily_records SET weekly_quest_count=?,version=version+1,updated_at=UTC_TIMESTAMP(3)
     WHERE player_id=? AND record_date=DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR)) AND version=?`,
    [count.toString(), row.player_id, row.version]
  );
  if (update.affectedRows !== 1n) throw new ApplicationError("WEEKLY_QUEST_COUNT_VERSION_CONFLICT", "주간 횟수가 먼저 변경되었습니다.", 409);
}
