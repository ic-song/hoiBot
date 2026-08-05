import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import {
  SIGNUP_PENDING_MINUTES,
  SIGNUP_TERMS_VERSION,
  buildSignupTermsMessage,
  buildSignupWelcomeMessage,
  validateSignupDisplayName
} from "./signup-policy.js";
import { createInitialPlayer } from "./create-initial-player.js";

export interface SignupCommandInput {
  externalUserId: string;
  displayName: string;
  channelId: string;
  message: string;
  eventId: string;
}

export interface SignupCommandResult {
  status: "pending" | "accepted" | "rejected";
  data: string;
  outboxId: string;
  playerId?: string;
  auditId: string;
}

interface IdentityRow {
  id: bigint;
  player_id: bigint | null;
  status: string;
}

interface SignupRequestRow {
  id: bigint;
  display_name: string;
  gender_code: "male" | "female";
  expired: number;
}

// 외부 이벤트 ID를 operations 컬럼 길이에 맞는 안정적인 키로 정규화합니다.
function normalizeEventKey(eventId: string): string {
  if (eventId.length <= 191) return eventId;
  return `sha256:${createHash("sha256").update(eventId).digest("hex")}`;
}

// MariaDB 중복 키 오류인지 판별합니다.
function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null
    && (("errno" in error && error.errno === 1062) || ("code" in error && error.code === "ER_DUP_ENTRY"));
}

// 저장된 operation 결과를 객체 형태로 복원합니다.
function parseStoredResult(value: string | SignupCommandResult): SignupCommandResult {
  return typeof value === "string" ? JSON.parse(value) as SignupCommandResult : value;
}

// 가입 명령 처리용 operation 행을 생성합니다.
async function createOperation(
  transaction: DatabaseTransaction,
  identityId: bigint,
  scope: string,
  eventId: string
): Promise<bigint> {
  const operation = await transaction.execute(
    `INSERT INTO operations
      (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, created_at)
     VALUES (?, ?, ?, 'external_identity', ?, 'iris', 'processing', UTC_TIMESTAMP(3))`,
    [randomUUID(), scope, normalizeEventKey(eventId), identityId]
  );
  return operation.insertId;
}

// 가입 명령 실행 이력을 event inbox와 연결합니다.
async function recordCommandExecution(
  transaction: DatabaseTransaction,
  eventId: string,
  commandCode: string,
  operationId: bigint
): Promise<void> {
  await transaction.execute(
    `INSERT INTO command_executions
      (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at)
     VALUES (?, ?, ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [eventId, commandCode, operationId]
  );
}

// 가입 처리 결과를 Iris outbox에 저장합니다.
async function queueSignupReply(
  transaction: DatabaseTransaction,
  operationId: bigint,
  channelId: string,
  data: string
): Promise<string> {
  const outbox = await transaction.execute(
    `INSERT INTO outbox_messages
      (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at)
     VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [operationId, channelId, JSON.stringify({ data })]
  );
  return outbox.insertId.toString();
}

// 가입 변경 내역을 감사 로그로 기록합니다.
async function recordSignupAudit(
  transaction: DatabaseTransaction,
  operationId: bigint,
  identityId: bigint,
  targetType: "external_identity" | "player",
  targetId: bigint,
  actionCode: string,
  summary: Record<string, unknown>
): Promise<string> {
  const audit = await transaction.execute(
    `INSERT INTO command_audit
      (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at)
     VALUES (?, 'external_identity', ?, ?, ?, ?, 'success', 'Iris 회원가입', ?, UTC_TIMESTAMP(3))`,
    [operationId, identityId, targetType, targetId, actionCode, JSON.stringify(summary)]
  );
  return audit.insertId.toString();
}

// operation을 완료 상태로 전환하고 재시도용 결과를 저장합니다.
async function completeOperation(
  transaction: DatabaseTransaction,
  operationId: bigint,
  result: SignupCommandResult
): Promise<void> {
  await transaction.execute(
    "UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?",
    [JSON.stringify(result), operationId]
  );
}

// 가입용 Kakao identity를 잠그고 현재 연결 상태를 반환합니다.
async function lockIdentity(transaction: DatabaseTransaction, externalUserId: string): Promise<IdentityRow> {
  const identities = await transaction.query<IdentityRow[]>(
    `SELECT id, player_id, status FROM external_identities
     WHERE provider_code = 'kakao' AND external_user_id = ? FOR UPDATE`,
    [externalUserId]
  );
  if (identities[0] === undefined) {
    throw new ApplicationError("SIGNUP_IDENTITY_REQUIRED", "가입할 Kakao 사용자 정보를 확인할 수 없습니다.", 409);
  }
  return identities[0];
}

// 이미 완료된 동일 이벤트의 가입 처리 결과를 조회합니다.
async function readPriorResult(
  transaction: DatabaseTransaction,
  scope: string,
  eventId: string
): Promise<SignupCommandResult | null> {
  const rows = await transaction.query<Array<{ result_json: string | SignupCommandResult | null }>>(
    "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE",
    [scope, normalizeEventKey(eventId)]
  );
  return rows[0]?.result_json === undefined || rows[0].result_json === null
    ? null
    : parseStoredResult(rows[0].result_json);
}

// 가입 닉네임 정책 오류를 사용자용 ApplicationError로 변환합니다.
function readValidSignupName(displayName: string) {
  try {
    return validateSignupDisplayName(displayName);
  } catch (error) {
    if (error instanceof Error && error.message === "BLOCKED_SIGNUP_NAME") {
      throw new ApplicationError(
        "BLOCKED_SIGNUP_NAME",
        "❌ 가입할 수 없는 닉네임입니다.\n\n욕설이나 정치 관련 표현이 포함된 닉네임은 사용할 수 없습니다.",
        422
      );
    }
    throw new ApplicationError(
      "INVALID_SIGNUP_NAME_FORMAT",
      "❌ 가입할 수 없는 닉네임입니다.\n\n닉네임은 두 글자 이상 이름 뒤에 남 또는 여를 띄어 입력해주세요.\n예시: 호이 남",
      422
    );
  }
}

// Iris 회원가입 대기·동의·거절을 MariaDB 트랜잭션으로 처리합니다.
export class SignupService {
  constructor(private readonly database: DatabaseClient) {}

  // 정확한 가입 명령을 해당 유스케이스로 전달합니다.
  async handle(command: SignupCommandInput): Promise<SignupCommandResult> {
    if (command.message === "/가입") return this.requestSignup(command);
    if (command.message === "시작한다" || command.message === "/시작한다") return this.acceptSignup(command);
    if (command.message === "거절한다" || command.message === "/거절한다") return this.rejectSignup(command);
    throw new ApplicationError("INVALID_SIGNUP_COMMAND", "회원가입 명령 형식이 올바르지 않습니다.", 422);
  }

  // 닉네임을 검증하고 재시작에도 유지되는 가입 대기 상태를 생성합니다.
  private async requestSignup(command: SignupCommandInput): Promise<SignupCommandResult> {
    const validName = readValidSignupName(command.displayName);
    try {
      return await this.database.withTransaction(async (transaction) => {
        const identity = await lockIdentity(transaction, command.externalUserId);
        const scope = `player.signup.request:${identity.id}`;
        const prior = await readPriorResult(transaction, scope, command.eventId);
        if (prior !== null) return prior;
        if (identity.player_id !== null || identity.status === "linked") {
          throw new ApplicationError("ALREADY_REGISTERED", "✅ 이미 가입된 회원입니다.\n/내정보에서 회원 정보를 확인해주세요.", 409);
        }

        await transaction.execute(
          `UPDATE player_signup_requests
           SET status = 'expired', normalized_display_name = NULL, updated_at = UTC_TIMESTAMP(3)
           WHERE status = 'pending' AND expires_at <= UTC_TIMESTAMP(3)
             AND (external_identity_id = ? OR normalized_display_name = ?)`,
          [identity.id, validName.normalizedDisplayName]
        );
        const existingProfiles = await transaction.query<Array<{ player_id: bigint }>>(
          "SELECT player_id FROM player_profiles WHERE current_display_name = ? LIMIT 1",
          [validName.displayName]
        );
        if (existingProfiles[0] !== undefined) {
          throw new ApplicationError(
            "SIGNUP_NAME_TAKEN",
            "❌ 이미 가입되었거나 기존 회원 연결을 기다리는 닉네임입니다.\n관리자에게 기존 계정 연결을 요청해주세요.",
            409
          );
        }
        const pendingNames = await transaction.query<Array<{ external_identity_id: bigint }>>(
          `SELECT external_identity_id FROM player_signup_requests
           WHERE normalized_display_name = ? AND status = 'pending' AND expires_at > UTC_TIMESTAMP(3) FOR UPDATE`,
          [validName.normalizedDisplayName]
        );
        if (pendingNames[0] !== undefined && pendingNames[0].external_identity_id !== identity.id) {
          throw new ApplicationError("SIGNUP_NAME_TAKEN", "❌ 다른 사용자가 가입 절차를 진행 중인 닉네임입니다.", 409);
        }

        const operationId = await createOperation(transaction, identity.id, scope, command.eventId);
        await transaction.execute(
          `INSERT INTO player_signup_requests
            (external_identity_id, display_name, normalized_display_name, gender_code, status, terms_version,
             source_channel_id, expires_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'pending', ?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 30 MINUTE), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
           ON DUPLICATE KEY UPDATE
             display_name = VALUES(display_name), normalized_display_name = VALUES(normalized_display_name),
             gender_code = VALUES(gender_code), status = 'pending', terms_version = VALUES(terms_version),
             source_channel_id = VALUES(source_channel_id), expires_at = VALUES(expires_at),
             player_id = NULL, accepted_at = NULL, rejected_at = NULL, updated_at = VALUES(updated_at)`,
          [identity.id, validName.displayName, validName.normalizedDisplayName, validName.genderCode,
            SIGNUP_TERMS_VERSION, command.channelId]
        );
        await recordCommandExecution(transaction, command.eventId, "signup_request", operationId);
        const data = buildSignupTermsMessage();
        const outboxId = await queueSignupReply(transaction, operationId, command.channelId, data);
        const auditId = await recordSignupAudit(
          transaction,
          operationId,
          identity.id,
          "external_identity",
          identity.id,
          "player.signup.request",
          { displayName: validName.displayName, termsVersion: SIGNUP_TERMS_VERSION, expiresInMinutes: SIGNUP_PENDING_MINUTES }
        );
        const result: SignupCommandResult = { status: "pending", data, outboxId, auditId };
        await completeOperation(transaction, operationId, result);
        return result;
      });
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      throw new ApplicationError("SIGNUP_NAME_TAKEN", "❌ 다른 사용자가 가입 절차를 진행 중인 닉네임입니다.", 409);
    }
  }

  // 약관 동의 후 회원·프로필·초기 데이터를 한 트랜잭션으로 생성합니다.
  private async acceptSignup(command: SignupCommandInput): Promise<SignupCommandResult> {
    return this.database.withTransaction(async (transaction) => {
      const identity = await lockIdentity(transaction, command.externalUserId);
      const scope = `player.signup.accept:${identity.id}`;
      const prior = await readPriorResult(transaction, scope, command.eventId);
      if (prior !== null) return prior;
      if (identity.player_id !== null || identity.status === "linked") {
        throw new ApplicationError("ALREADY_REGISTERED", "✅ 이미 가입이 완료된 회원입니다.\n/내정보에서 회원 정보를 확인해주세요.", 409);
      }

      const requests = await transaction.query<SignupRequestRow[]>(
        `SELECT id, display_name, gender_code, expires_at <= UTC_TIMESTAMP(3) AS expired FROM player_signup_requests
         WHERE external_identity_id = ? AND status = 'pending' FOR UPDATE`,
        [identity.id]
      );
      const signup = requests[0];
      if (signup === undefined) {
        throw new ApplicationError("SIGNUP_NOT_PENDING", "❌ 진행 중인 가입이 없습니다.\n먼저 /가입을 입력해주세요.", 409);
      }
      if (Boolean(signup.expired)) {
        throw new ApplicationError("SIGNUP_EXPIRED", "❌ 가입 대기 시간이 만료됐습니다.\n/가입을 다시 입력해주세요.", 409);
      }

      const existingProfiles = await transaction.query<Array<{ player_id: bigint }>>(
        "SELECT player_id FROM player_profiles WHERE current_display_name = ? LIMIT 1",
        [signup.display_name]
      );
      if (existingProfiles[0] !== undefined) {
        throw new ApplicationError("SIGNUP_NAME_TAKEN", "❌ 기존 회원과 같은 닉네임이라 가입할 수 없습니다.\n관리자에게 계정 연결을 요청해주세요.", 409);
      }

      const operationId = await createOperation(transaction, identity.id, scope, command.eventId);
      const playerId = await createInitialPlayer(transaction, signup.display_name, command.channelId);
      const identityLink = await transaction.execute(
        "UPDATE external_identities SET player_id = ?, status = 'linked', updated_at = UTC_TIMESTAMP(3) WHERE id = ? AND player_id IS NULL",
        [playerId, identity.id]
      );
      if (identityLink.affectedRows !== 1n) {
        throw new ApplicationError("SIGNUP_IDENTITY_CONFLICT", "Kakao 계정 연결 상태가 먼저 변경됐습니다.", 409);
      }
      await transaction.execute(
        `UPDATE player_signup_requests
         SET player_id = ?, status = 'accepted', accepted_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3)
         WHERE id = ?`,
        [playerId, signup.id]
      );
      await recordCommandExecution(transaction, command.eventId, "signup_accept", operationId);
      const data = buildSignupWelcomeMessage();
      const outboxId = await queueSignupReply(transaction, operationId, command.channelId, data);
      const auditId = await recordSignupAudit(
        transaction,
        operationId,
        identity.id,
        "player",
        playerId,
        "player.signup.accept",
        { displayName: signup.display_name, genderCode: signup.gender_code, termsVersion: SIGNUP_TERMS_VERSION }
      );
      await transaction.execute(
        `INSERT INTO outbox_messages
          (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at)
         VALUES (?, 'internal', ?, 'player.signup.completed', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [operationId, playerId.toString(), JSON.stringify({ playerId: playerId.toString(), displayName: signup.display_name })]
      );
      const result: SignupCommandResult = {
        status: "accepted",
        data,
        outboxId,
        playerId: playerId.toString(),
        auditId
      };
      await completeOperation(transaction, operationId, result);
      return result;
    });
  }

  // 가입 거절을 영속화하고 예약된 닉네임을 다시 사용할 수 있게 해제합니다.
  private async rejectSignup(command: SignupCommandInput): Promise<SignupCommandResult> {
    return this.database.withTransaction(async (transaction) => {
      const identity = await lockIdentity(transaction, command.externalUserId);
      const scope = `player.signup.reject:${identity.id}`;
      const prior = await readPriorResult(transaction, scope, command.eventId);
      if (prior !== null) return prior;
      if (identity.player_id !== null || identity.status === "linked") {
        throw new ApplicationError("ALREADY_REGISTERED", "✅ 이미 가입이 완료된 회원입니다.", 409);
      }
      const requests = await transaction.query<SignupRequestRow[]>(
        `SELECT id, display_name, gender_code, expires_at <= UTC_TIMESTAMP(3) AS expired FROM player_signup_requests
         WHERE external_identity_id = ? AND status = 'pending' FOR UPDATE`,
        [identity.id]
      );
      const signup = requests[0];
      if (signup === undefined) {
        throw new ApplicationError("SIGNUP_NOT_PENDING", "❌ 진행 중인 가입이 없습니다.\n먼저 /가입을 입력해주세요.", 409);
      }

      const operationId = await createOperation(transaction, identity.id, scope, command.eventId);
      await transaction.execute(
        `UPDATE player_signup_requests
         SET status = 'rejected', normalized_display_name = NULL, rejected_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3)
         WHERE id = ?`,
        [signup.id]
      );
      await recordCommandExecution(transaction, command.eventId, "signup_reject", operationId);
      const data = "호월 봇: 다음에 다시 만나요..!";
      const outboxId = await queueSignupReply(transaction, operationId, command.channelId, data);
      const auditId = await recordSignupAudit(
        transaction,
        operationId,
        identity.id,
        "external_identity",
        identity.id,
        "player.signup.reject",
        { displayName: signup.display_name }
      );
      const result: SignupCommandResult = { status: "rejected", data, outboxId, auditId };
      await completeOperation(transaction, operationId, result);
      return result;
    });
  }
}
