import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND_CODE = "HOME_VISIT_RESET";

export interface HomeVisitResetResult {
  status: "reset";
  message: string;
  outboxId: string;
  replayed: boolean;
  resetHomeCount: string;
  resetVisitTotal: string;
  preservedVisitRows: string;
}

type OperatorRow = { operator_id: bigint };
type StoredOperation = { result_json: string | HomeVisitResetResult | null };

function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function parseStored(value: string | HomeVisitResetResult): HomeVisitResetResult {
  return typeof value === "string" ? JSON.parse(value) as HomeVisitResetResult : value;
}

export function buildHomeVisitResetMessage(resetHomeCount: bigint): string {
  return `🫂 펫스윗홈 방문자수 초기화 완료!\n초기화된 유저 수: ${resetHomeCount}명`;
}

async function complete(transaction: DatabaseTransaction, input: {
  operationId: bigint;
  eventId: string;
  operatorId: bigint;
  destinationId: string;
  resetHomeCount: bigint;
  resetVisitTotal: bigint;
  preservedVisitRows: bigint;
}): Promise<HomeVisitResetResult> {
  const message = buildHomeVisitResetMessage(input.resetHomeCount);
  const outbox = await transaction.execute(
    "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [input.operationId, input.destinationId, JSON.stringify({ data: message })],
  );
  const result: HomeVisitResetResult = {
    status: "reset",
    message,
    outboxId: outbox.insertId.toString(),
    replayed: false,
    resetHomeCount: input.resetHomeCount.toString(),
    resetVisitTotal: input.resetVisitTotal.toString(),
    preservedVisitRows: input.preservedVisitRows.toString(),
  };
  await transaction.execute(
    "INSERT INTO home_visit_reset_runs(operation_id,actor_operator_id,reset_home_count,reset_visit_total,preserved_visit_rows,created_at) VALUES (?,?,?,?,?,UTC_TIMESTAMP(3))",
    [input.operationId, input.operatorId, input.resetHomeCount, input.resetVisitTotal, input.preservedVisitRows],
  );
  await transaction.execute(
    "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed','reset',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [input.eventId, COMMAND_CODE, input.operationId],
  );
  await transaction.execute(
    "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'home_visit_counter',NULL,'home.visit.reset','reset','Iris /펫홈방문초기화',?,UTC_TIMESTAMP(3))",
    [input.operationId, input.operatorId, JSON.stringify({ resetHomeCount: result.resetHomeCount, resetVisitTotal: result.resetVisitTotal, preservedVisitRows: result.preservedVisitRows })],
  );
  await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), input.operationId]);
  return result;
}

// 모든 홈의 방문 집계만 0으로 바꾸고 원본 방문 이력은 보존합니다.
export class HomeVisitResetService {
  public constructor(private readonly database: DatabaseClient) {}

  public async execute(input: { eventId: string; externalUserId: string; destinationId: string }): Promise<HomeVisitResetResult> {
    return this.database.withTransaction(async (transaction) => {
      const operator = (await transaction.query<OperatorRow[]>(
        `SELECT mapping.operator_id
         FROM external_identities identity
         JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
         JOIN admin_operators operator ON operator.id=mapping.operator_id
         JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
         JOIN admin_role_permissions permission ON permission.role_id=operator_role.role_id
         WHERE identity.provider_code='kakao' AND identity.external_user_id=?
           AND identity.status='linked' AND operator.status='active'
           AND permission.permission_code='game.home.moderate'
         ORDER BY mapping.operator_id LIMIT 1 FOR UPDATE`,
        [input.externalUserId],
      ))[0];
      if (operator === undefined) throw new ApplicationError("HOME_VISIT_RESET_FORBIDDEN", "펫홈 방문 초기화 권한이 없습니다.", 403);

      const key = eventKey(input.eventId);
      const prior = (await transaction.query<StoredOperation[]>(
        "SELECT result_json FROM operations WHERE idempotency_scope='home.visit.reset' AND idempotency_key=? FOR UPDATE",
        [key],
      ))[0];
      if (prior?.result_json != null) return { ...parseStored(prior.result_json), replayed: true };
      if (prior !== undefined) throw new ApplicationError("HOME_VISIT_RESET_IN_PROGRESS", "펫홈 방문 초기화가 처리 중입니다.", 409);

      const operation = await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'home.visit.reset',?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), key, operator.operator_id],
      );
      const homes = await transaction.query<Array<{ player_id: bigint; visit_count: bigint }>>(
        "SELECT player_id,visit_count FROM player_homes ORDER BY player_id FOR UPDATE",
      );
      const resetHomeCount = BigInt(homes.length);
      const resetVisitTotal = homes.reduce((total, home) => total + home.visit_count, 0n);
      const visitRows = (await transaction.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM home_visits"))[0]!.count_value;
      await transaction.execute("UPDATE player_homes SET visit_count=0,version=version+1");
      return complete(transaction, {
        operationId: operation.insertId,
        eventId: input.eventId,
        operatorId: operator.operator_id,
        destinationId: input.destinationId,
        resetHomeCount,
        resetVisitTotal,
        preservedVisitRows: visitRows,
      });
    });
  }
}
