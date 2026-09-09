import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

export interface AuthCheckCountResetResult {
  data: string;
  outboxId: string;
  affectedPlayerCount: number;
  totalBefore: string;
  auditId: string;
}

// 인증 초기화 명령은 정확 일치 형식만 허용합니다.
export function isAuthCheckCountResetCommand(message: string | undefined): boolean {
  return message === "/인증초기화";
}

// 기존 인증 초기화 완료 응답을 천 단위 표기와 함께 생성합니다.
export function formatAuthCheckCountResetReply(affectedPlayerCount: number): string {
  return `📋 인증 데이터 초기화 완료\n\n초기화된 유저 수: ${affectedPlayerCount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}명`;
}

// 전역 lock과 stable player row lock 아래 인증 횟수·감사·응답을 원자 초기화합니다.
export class AuthCheckCountResetService {
  constructor(private readonly database: DatabaseClient) {}

  async reset(input: { idempotencyKey: string; sourceEventId: string; destinationId: string; operatorId: string }): Promise<AuthCheckCountResetResult> {
    const scope = "admin.auth_check_count.reset";
    return this.database.withTransaction(async (transaction) => {
      const globalLock = await transaction.query<Array<{ lock_code: string }>>(
        "SELECT lock_code FROM admin_global_locks WHERE lock_code='auth_check_count_reset' FOR UPDATE"
      );
      if (globalLock[0] === undefined) throw new ApplicationError("AUTH_RESET_LOCK_MISSING", "인증 초기화 잠금 설정이 없습니다.", 409);
      const prior = await transaction.query<Array<{ result_json: string | AuthCheckCountResetResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, input.idempotencyKey]
      );
      if (prior[0]?.result_json != null) {
        return typeof prior[0].result_json === "string" ? JSON.parse(prior[0].result_json) : prior[0].result_json;
      }
      const rows = await transaction.query<Array<{ player_id: bigint; check_count: string; version: bigint }>>(
        "SELECT player_id,CAST(check_count AS CHAR) AS check_count,version FROM player_check_counts ORDER BY player_id FOR UPDATE"
      );
      const operation = await transaction.execute(
        `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, input.idempotencyKey, input.operatorId]
      );
      let affectedPlayerCount = 0;
      let totalBefore = 0n;
      for (const entry of rows) {
        const count = BigInt(entry.check_count);
        totalBefore += count;
        if (count === 0n) continue;
        const update = await transaction.execute(
          "UPDATE player_check_counts SET check_count=0,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND version=?",
          [entry.player_id, entry.version]
        );
        if (update.affectedRows !== 1n) throw new ApplicationError("AUTH_CHECK_COUNT_VERSION_CONFLICT", "인증 횟수가 먼저 변경되었습니다.", 409);
        affectedPlayerCount += 1;
      }
      const data = formatAuthCheckCountResetReply(affectedPlayerCount);
      const audit = await transaction.execute(
        `INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES (?,'admin_operator',?,'player_check_count',NULL,'admin.auth_check_count.reset','success','Iris 총괄 운영자 /인증초기화',?,UTC_TIMESTAMP(3))`,
        [operation.insertId, input.operatorId, JSON.stringify({ affectedPlayerCount, totalBefore: totalBefore.toString() })]
      );
      await transaction.execute(
        `INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)
         VALUES (?,'ADMIN_AUTH_CHECK_COUNT_RESET',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [input.sourceEventId, operation.insertId]
      );
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
         VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [operation.insertId, input.destinationId, JSON.stringify({ data })]
      );
      const result: AuthCheckCountResetResult = { data, outboxId: outbox.insertId.toString(), affectedPlayerCount,
        totalBefore: totalBefore.toString(), auditId: audit.insertId.toString() };
      await transaction.execute(
        "INSERT INTO admin_check_count_reset_mutations(operation_id,affected_player_count,total_before,result_json) VALUES (?,?,?,?)",
        [operation.insertId, affectedPlayerCount, totalBefore.toString(), JSON.stringify(result)]
      );
      await transaction.execute(
        "UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
        [JSON.stringify(result), operation.insertId]
      );
      return result;
    });
  }
}
