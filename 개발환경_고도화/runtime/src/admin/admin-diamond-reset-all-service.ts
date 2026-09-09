import { randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { formatDecimal3, parseDecimal3 } from "../shared/numeric-policy.js";

interface ResetResult {
  status: "confirmation_required" | "reset";
  data: string;
  outboxId: string;
  memberCount?: string;
  changedAccountCount?: number;
  resetAmount?: string;
}

// 총괄 운영자 확인 코드를 거쳐 전체 다이아 잔액·원장·감사·응답을 한 transaction으로 초기화합니다.
export class AdminDiamondResetAllService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<ResetResult> {
    const parsed = parseAdminDiamondResetAllCommand(input.message);
    if (parsed === undefined) throw new ApplicationError("INVALID_DIAMOND_RESET_COMMAND", "다이아 전체 초기화 명령 형식이 올바르지 않습니다.", 422);
    const operatorId = await this.requireOperator(input.externalUserId);
    return parsed.confirmationCode === undefined
      ? this.issueConfirmation(operatorId, input)
      : this.executeReset(operatorId, parsed.confirmationCode, input);
  }

  // super_admin의 전용 전체 재화 초기화 권한을 확인합니다.
  private async requireOperator(externalUserId: string): Promise<string> {
    const operators = await this.database.query<Array<{ operator_id: bigint }>>(
      `SELECT mapping.operator_id
       FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator ON operator.id=mapping.operator_id
       JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
       JOIN admin_roles role ON role.id=operator_role.role_id AND role.code='super_admin' AND role.active=TRUE
       JOIN admin_role_permissions permission ON permission.role_id=role.id
       WHERE identity.provider_code='kakao' AND identity.external_user_id=?
         AND identity.status='linked' AND operator.status='active'
         AND permission.permission_code='game.currency.reset_all' LIMIT 1`,
      [externalUserId]
    );
    if (operators[0] === undefined) throw new ApplicationError("FORBIDDEN", "다이아 전체 초기화 권한이 없습니다.", 403);
    return operators[0].operator_id.toString();
  }

  // 5분 유효 확인 코드를 operation·감사·outbox와 함께 발급합니다.
  private async issueConfirmation(operatorId: string, input: { channelId: string; eventId: string }): Promise<ResetResult> {
    return this.database.withTransaction(async (transaction) => {
      const prior = await readPriorResult(transaction, "currency.reset_all.confirm", input.eventId);
      if (prior !== undefined) return prior;
      await transaction.execute(
        "UPDATE admin_currency_reset_confirmations SET consumed_at=UTC_TIMESTAMP(3) WHERE operator_id=? AND consumed_at IS NULL",
        [operatorId]
      );
      const operation = await insertOperation(transaction, "currency.reset_all.confirm", input.eventId, operatorId);
      const confirmationCode = randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
      await transaction.execute(
        `INSERT INTO admin_currency_reset_confirmations
          (operator_id,confirmation_code,request_event_id,operation_id,expires_at)
         VALUES (?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 5 MINUTE))`,
        [operatorId, confirmationCode, input.eventId, operation.insertId]
      );
      const data = `⚠️ 전체 다이아 초기화 확인이 필요합니다.\n5분 안에 /다이아전체초기화 확인 ${confirmationCode}`;
      const outbox = await insertOutbox(transaction, operation.insertId, input.channelId, data);
      await transaction.execute(
        `INSERT INTO command_audit
          (operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES (?,'admin_operator',?,'currency_definition',NULL,'currency.reset_all.confirm','success','전체 다이아 초기화 확인 코드 발급',?,UTC_TIMESTAMP(3))`,
        [operation.insertId, operatorId, JSON.stringify({ currencyCode: "diamond", expiresInMinutes: 5 })]
      );
      await insertExecution(transaction, input.eventId, "admin_diamond_reset_confirm", operation.insertId);
      const result: ResetResult = { status: "confirmation_required", data, outboxId: outbox.insertId.toString() };
      await completeOperation(transaction, operation.insertId, result);
      return result;
    });
  }

  // 확인 코드를 잠근 뒤 모든 양수 다이아 계정을 0으로 만들고 기존 원장은 보존합니다.
  private async executeReset(operatorId: string, confirmationCode: string,
    input: { channelId: string; eventId: string }): Promise<ResetResult> {
    return this.database.withTransaction(async (transaction) => {
      const prior = await readPriorResult(transaction, "currency.reset_all", input.eventId);
      if (prior !== undefined) return prior;
      const confirmations = await transaction.query<Array<{ id: bigint }>>(
        `SELECT id FROM admin_currency_reset_confirmations
         WHERE operator_id=? AND confirmation_code=? AND consumed_at IS NULL AND expires_at>=UTC_TIMESTAMP(3)
         FOR UPDATE`, [operatorId, confirmationCode]
      );
      if (confirmations[0] === undefined) throw new ApplicationError("INVALID_OR_EXPIRED_CONFIRMATION", "확인 코드가 없거나 만료되었습니다.", 409);
      const members = await transaction.query<Array<{ member_count: bigint }>>(
        "SELECT COUNT(*) AS member_count FROM players WHERE status='active'"
      );
      const accounts = await transaction.query<Array<{ player_id: bigint; balance: string; version: bigint }>>(
        `SELECT player_id,CAST(balance AS CHAR) AS balance,version
         FROM currency_accounts WHERE currency_code='diamond' AND balance>0 ORDER BY player_id FOR UPDATE`
      );
      const operation = await insertOperation(transaction, "currency.reset_all", input.eventId, operatorId);
      let resetAmount = 0n;
      for (let index = 0; index < accounts.length; index++) {
        const account = accounts[index]!;
        const balance = parseDecimal3(account.balance, "balance");
        resetAmount += balance;
        const update = await transaction.execute(
          "UPDATE currency_accounts SET balance=0,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND currency_code='diamond' AND version=?",
          [account.player_id, account.version]
        );
        if (update.affectedRows !== 1n) throw new ApplicationError("CURRENCY_VERSION_CONFLICT", "다이아 잔액이 먼저 변경되었습니다.", 409);
        await transaction.execute(
          `INSERT INTO currency_ledger
            (operation_id,sequence_no,player_id,currency_code,delta,balance_after,reason_code)
           VALUES (?,?,?,'diamond',?,0,'admin_diamond_reset_all')`,
          [operation.insertId, index + 1, account.player_id, formatDecimal3(-balance)]
        );
      }
      await transaction.execute(
        "UPDATE admin_currency_reset_confirmations SET consumed_at=UTC_TIMESTAMP(3),consumed_event_id=? WHERE id=?",
        [input.eventId, confirmations[0].id]
      );
      const memberCount = (members[0]?.member_count ?? 0n).toString();
      const data = `✅ 모든 회원의 다이아가 초기화되었습니다.\n대상 ${memberCount}명 · 잔액 변경 ${accounts.length}명`;
      const outbox = await insertOutbox(transaction, operation.insertId, input.channelId, data);
      await transaction.execute(
        `INSERT INTO command_audit
          (operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES (?,'admin_operator',?,'currency_definition',NULL,'currency.reset_all','success','전체 다이아 잔액 초기화',?,UTC_TIMESTAMP(3))`,
        [operation.insertId, operatorId, JSON.stringify({ currencyCode: "diamond", memberCount, changedAccountCount: accounts.length, resetAmount: formatDecimal3(resetAmount), ledgerPolicy: "append_only" })]
      );
      await insertExecution(transaction, input.eventId, "admin_diamond_reset_all", operation.insertId);
      const result: ResetResult = { status: "reset", data, outboxId: outbox.insertId.toString(), memberCount,
        changedAccountCount: accounts.length, resetAmount: formatDecimal3(resetAmount) };
      await completeOperation(transaction, operation.insertId, result);
      return result;
    });
  }
}

// 전체 초기화의 요청 단계와 확인 코드 단계를 엄격히 구분합니다.
function parseAdminDiamondResetAllCommand(message: string): { confirmationCode?: string } | undefined {
  if (message === "/다이아전체초기화") return {};
  const match = /^\/다이아전체초기화 확인 ([A-F0-9]{8})$/.exec(message);
  return match === null ? undefined : { confirmationCode: match[1]! };
}

// 전체 초기화 후보를 exact 또는 8자리 확인 코드 전체 패턴으로 제한합니다.
export function isAdminDiamondResetAllCommand(message: string | undefined): boolean {
  return message !== undefined && parseAdminDiamondResetAllCommand(message) !== undefined;
}

// 확인 단계도 DB 기본 alias로 dispatch하도록 정규화합니다.
export function normalizeAdminDiamondResetAllDispatchMessage(message: string): string {
  return isAdminDiamondResetAllCommand(message) ? "/다이아전체초기화" : message;
}

// operation의 기존 완료 결과를 멱등 replay합니다.
async function readPriorResult(transaction: DatabaseTransaction, scope: string, eventId: string): Promise<ResetResult | undefined> {
  const rows = await transaction.query<Array<{ result_json: string | ResetResult | null }>>(
    "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, eventId]
  );
  const result = rows[0]?.result_json;
  if (result === undefined || result === null) return undefined;
  return typeof result === "string" ? JSON.parse(result) : result;
}

// 관리자 operation 시작 행을 생성합니다.
async function insertOperation(transaction: DatabaseTransaction, scope: string, eventId: string, operatorId: string) {
  return transaction.execute(
    `INSERT INTO operations
      (operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
     VALUES (?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))`,
    [randomUUID(), scope, eventId, operatorId]
  );
}

// Iris 응답을 operation과 같은 transaction의 outbox에 적재합니다.
async function insertOutbox(transaction: DatabaseTransaction, operationId: bigint, destinationId: string, data: string) {
  return transaction.execute(
    `INSERT INTO outbox_messages
      (operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
     VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
    [operationId, destinationId, JSON.stringify({ data })]
  );
}

// 명령 실행 완료를 operation에 연결합니다.
async function insertExecution(transaction: DatabaseTransaction, eventId: string, commandCode: string, operationId: bigint): Promise<void> {
  await transaction.execute(
    `INSERT INTO command_executions
      (event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)
     VALUES (?,?,?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
    [eventId, commandCode, operationId]
  );
}

// operation 완료 결과를 replay 가능한 JSON으로 저장합니다.
async function completeOperation(transaction: DatabaseTransaction, operationId: bigint, result: ResetResult): Promise<void> {
  await transaction.execute(
    "UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
    [JSON.stringify(result), operationId]
  );
}
