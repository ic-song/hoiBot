import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND_CODE = "HOME_COMMENT_FILE_BOOTSTRAP";
const RESOURCE_CODE = "PET_HOME_COMMENTS";
const RESOURCE_LABEL = "MariaDB: home_comments";

export interface HomeCommentFileBootstrapResult {
  status: "created" | "already_exists";
  message: string;
  outboxId: string;
  replayed: boolean;
  commentCount: string;
  pinCount: string;
}

type OperatorRow = { operator_id: bigint };
type StoredOperation = { result_json: string | HomeCommentFileBootstrapResult | null };

function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function parseStored(value: string | HomeCommentFileBootstrapResult): HomeCommentFileBootstrapResult {
  return typeof value === "string" ? JSON.parse(value) as HomeCommentFileBootstrapResult : value;
}

export function buildHomeCommentFileBootstrapMessage(status: "created" | "already_exists"): string {
  return status === "created"
    ? `✅ 펫홈 댓글 파일 생성 완료\n${RESOURCE_LABEL}`
    : `✅ 펫홈 댓글 파일이 이미 있습니다.\n${RESOURCE_LABEL}`;
}

async function complete(
  transaction: DatabaseTransaction,
  input: {
    operationId: bigint;
    eventId: string;
    operatorId: bigint;
    destinationId: string;
    status: "created" | "already_exists";
    commentCount: bigint;
    pinCount: bigint;
  },
): Promise<HomeCommentFileBootstrapResult> {
  const message = buildHomeCommentFileBootstrapMessage(input.status);
  const outbox = await transaction.execute(
    "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [input.operationId, input.destinationId, JSON.stringify({ data: message })],
  );
  const result: HomeCommentFileBootstrapResult = {
    status: input.status,
    message,
    outboxId: outbox.insertId.toString(),
    replayed: false,
    commentCount: input.commentCount.toString(),
    pinCount: input.pinCount.toString(),
  };
  await transaction.execute(
    "INSERT INTO home_comment_bootstrap_runs(operation_id,actor_operator_id,result_code,comment_count,pin_count,created_at) VALUES (?,?,?,?,?,UTC_TIMESTAMP(3))",
    [input.operationId, input.operatorId, input.status, input.commentCount, input.pinCount],
  );
  await transaction.execute(
    "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [input.eventId, COMMAND_CODE, input.operationId, input.status],
  );
  await transaction.execute(
    "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'home_comment_store',NULL,'home.comment.bootstrap',?,'Iris /펫홈댓글파일생성',?,UTC_TIMESTAMP(3))",
    [input.operationId, input.operatorId, input.status, JSON.stringify({ resourceCode: RESOURCE_CODE, status: input.status, commentCount: result.commentCount, pinCount: result.pinCount })],
  );
  await transaction.execute(
    "UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
    [JSON.stringify(result), input.operationId],
  );
  return result;
}

// 기존 댓글·핀을 보존하고 DB 저장소의 최초 준비 상태만 멱등 기록합니다.
export class HomeCommentFileBootstrapService {
  public constructor(private readonly database: DatabaseClient) {}

  public async execute(input: { eventId: string; externalUserId: string; destinationId: string }): Promise<HomeCommentFileBootstrapResult> {
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
      if (operator === undefined) {
        throw new ApplicationError("HOME_COMMENT_BOOTSTRAP_FORBIDDEN", "펫홈 댓글 파일 생성 권한이 없습니다.", 403);
      }

      const key = eventKey(input.eventId);
      const prior = (await transaction.query<StoredOperation[]>(
        "SELECT result_json FROM operations WHERE idempotency_scope='home.comment.bootstrap' AND idempotency_key=? FOR UPDATE",
        [key],
      ))[0];
      if (prior?.result_json != null) return { ...parseStored(prior.result_json), replayed: true };
      if (prior !== undefined) throw new ApplicationError("HOME_COMMENT_BOOTSTRAP_IN_PROGRESS", "댓글 저장소 준비 작업이 처리 중입니다.", 409);

      const operation = await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'home.comment.bootstrap',?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), key, operator.operator_id],
      );
      const operationId = operation.insertId;
      const counts = (await transaction.query<Array<{ comment_count: bigint; pin_count: bigint }>>(
        `SELECT
           (SELECT COUNT(*) FROM home_comments) AS comment_count,
           (SELECT COUNT(*) FROM home_comment_pins WHERE deleted_at IS NULL) AS pin_count`,
      ))[0]!;
      const inserted = await transaction.execute(
        "INSERT IGNORE INTO home_comment_bootstrap_state(resource_code,schema_version,initialized_operation_id,initialized_by_operator_id,metadata_json,version,initialized_at) VALUES (?,1,?,?,?,1,UTC_TIMESTAMP(3))",
        [RESOURCE_CODE, operationId, operator.operator_id, JSON.stringify({ storage: "mariadb", commentsTable: "home_comments", pinsTable: "home_comment_pins" })],
      );
      return complete(transaction, {
        operationId,
        eventId: input.eventId,
        operatorId: operator.operator_id,
        destinationId: input.destinationId,
        status: inserted.affectedRows === 1n ? "created" : "already_exists",
        commentCount: counts.comment_count,
        pinCount: counts.pin_count,
      });
    });
  }
}
