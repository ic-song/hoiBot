import { randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

export interface ExploreCountAdminCommand {
  targetDisplayName: string;
  count: bigint;
}

export interface ExploreCountAdminResult {
  data: string;
  outboxId: string;
  targetPlayerId: string;
  targetDisplayName: string;
  countBefore: string;
  countAfter: string;
  changed: boolean;
}

const maxUnsignedBigInt = 18_446_744_073_709_551_615n;

// 탐험횟수수정은 회원명과 0 이상 정수가 모두 있는 완전한 입력만 허용합니다.
export function isExploreCountAdminCommandCandidate(message: string | undefined): boolean {
  return message !== undefined && /^\/탐험횟수수정\s+[^\r\n]+\s+\d+$/.test(message);
}

// 마지막 공백 토큰을 횟수로, 앞부분 전체를 레거시 회원명으로 해석합니다.
export function parseExploreCountAdminCommand(message: string): ExploreCountAdminCommand {
  const match = /^\/탐험횟수수정\s+([^\r\n]+)\s+(\d+)$/.exec(message);
  if (match === null) throw new ApplicationError("INVALID_EXPLORE_COUNT_COMMAND", "사용법: /탐험횟수수정 유저명 숫자", 422);
  const targetDisplayName = match[1]!.trim();
  const count = BigInt(match[2]!);
  if (targetDisplayName.length === 0 || count > maxUnsignedBigInt) {
    throw new ApplicationError("INVALID_EXPLORE_COUNT", "❌ 탐험횟수는 0 이상만 설정할 수 있습니다.", 422);
  }
  return { targetDisplayName, count };
}

// 레거시 완료 문구와 줄바꿈을 유지합니다.
export function formatExploreCountAdminReply(input: { targetDisplayName: string; countBefore: bigint; countAfter: bigint }): string {
  return `✅ 탐험횟수 수정 완료\n대상: ${input.targetDisplayName}\n변경: ${input.countBefore.toString()} -> ${input.countAfter.toString()}`;
}

// KST 일일 탐험 횟수를 stable player lock 아래 수정하고 공용 원장을 원자 기록합니다.
export class ExploreCountAdminService {
  constructor(private readonly database: DatabaseClient) {}

  async update(input: {
    command: ExploreCountAdminCommand;
    idempotencyKey: string;
    sourceEventId: string;
    destinationId: string;
    operatorId: string;
  }): Promise<ExploreCountAdminResult> {
    const scope = "admin.explore_count.update";
    return this.database.withTransaction(async (transaction) => {
      const prior = await transaction.query<Array<{ result_json: string | ExploreCountAdminResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",
        [scope, input.idempotencyKey]
      );
      if (prior[0]?.result_json != null) {
        return typeof prior[0].result_json === "string" ? JSON.parse(prior[0].result_json) : prior[0].result_json;
      }

      const state = await prepareTarget(transaction, input.command.targetDisplayName);
      const operation = await transaction.execute(
        `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, input.idempotencyKey, input.operatorId]
      );
      const changed = state.explore_attempts !== input.command.count.toString();
      const versionAfter = state.version + (changed ? 1n : 0n);
      if (changed) {
        const update = await transaction.execute(
          `UPDATE player_pet_daily_records
           SET explore_attempts=?,version=version+1,updated_at=UTC_TIMESTAMP(3)
           WHERE player_id=? AND record_date=DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR)) AND version=?`,
          [input.command.count.toString(), state.player_id, state.version]
        );
        if (update.affectedRows !== 1n) {
          throw new ApplicationError("EXPLORE_COUNT_VERSION_CONFLICT", "탐험횟수가 먼저 변경되었습니다.", 409);
        }
      }

      const data = formatExploreCountAdminReply({
        targetDisplayName: input.command.targetDisplayName,
        countBefore: BigInt(state.explore_attempts),
        countAfter: input.command.count
      });
      await transaction.execute(
        `INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES (?,'admin_operator',?,'player',?,'admin.explore_count.update','success','Iris 총괄 운영자 /탐험횟수수정',?,UTC_TIMESTAMP(3))`,
        [operation.insertId, input.operatorId, state.player_id, JSON.stringify({
          changed,
          countBefore: state.explore_attempts,
          countAfter: input.command.count.toString(),
          versionBefore: state.version.toString(),
          versionAfter: versionAfter.toString()
        })]
      );
      await transaction.execute(
        `INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)
         VALUES (?,'ADMIN_EXPLORE_COUNT_UPDATE',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [input.sourceEventId, operation.insertId]
      );
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
         VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [operation.insertId, input.destinationId, JSON.stringify({ data })]
      );
      await transaction.execute(
        `INSERT INTO admin_explore_count_mutations(operation_id,target_player_id,count_before,count_after,changed,version_before,version_after)
         VALUES (?,?,?,?,?,?,?)`,
        [operation.insertId, state.player_id, state.explore_attempts, input.command.count.toString(), changed, state.version, versionAfter]
      );
      const result: ExploreCountAdminResult = {
        data,
        outboxId: outbox.insertId.toString(),
        targetPlayerId: state.player_id.toString(),
        targetDisplayName: input.command.targetDisplayName,
        countBefore: state.explore_attempts,
        countAfter: input.command.count.toString(),
        changed
      };
      await transaction.execute(
        "UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
        [JSON.stringify(result), operation.insertId]
      );
      return result;
    });
  }
}

interface ExploreCountRow {
  player_id: bigint;
  explore_attempts: string;
  version: bigint;
}

// 표시명 중복을 차단하고 오늘의 탐험횟수 row를 잠급니다.
async function prepareTarget(transaction: DatabaseTransaction, targetDisplayName: string): Promise<ExploreCountRow> {
  const targets = await transaction.query<Array<{ player_id: bigint }>>(
    `SELECT profile.player_id
     FROM player_profiles profile JOIN players player ON player.id=profile.player_id AND player.status='active'
     WHERE profile.current_display_name=? ORDER BY profile.player_id LIMIT 2`,
    [targetDisplayName]
  );
  if (targets.length === 0) throw new ApplicationError("PLAYER_NOT_FOUND", "❌ 존재하지 않는 유저입니다.", 404);
  if (targets.length > 1) throw new ApplicationError("PLAYER_NAME_AMBIGUOUS", "동일 표시명의 회원이 여러 명이므로 player ID 기준 수정이 필요합니다.", 409);
  const playerId = targets[0]!.player_id;
  await transaction.execute(
    `INSERT INTO player_pet_daily_records(player_id,record_date)
     VALUES (?,DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR)))
     ON DUPLICATE KEY UPDATE player_id=VALUES(player_id)`,
    [playerId]
  );
  const rows = await transaction.query<ExploreCountRow[]>(
    `SELECT player_id,CAST(explore_attempts AS CHAR) explore_attempts,version
     FROM player_pet_daily_records
     WHERE player_id=? AND record_date=DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR)) FOR UPDATE`,
    [playerId]
  );
  if (rows[0] === undefined) throw new Error("Explore count row was not created.");
  return rows[0];
}
