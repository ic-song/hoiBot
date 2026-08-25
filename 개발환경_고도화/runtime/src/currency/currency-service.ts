import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { formatDecimal3, parseDecimal3 } from "../shared/numeric-policy.js";
import { TransactionalOperationRunner, type OperationActor } from "../shared/transactional-operation.js";

export interface AdjustCurrencyCommand {
  playerId: string;
  currencyCode: string;
  delta: string;
  expectedVersion: string;
  allowNegative?: boolean;
  reasonCode: string;
  reason: string;
  idempotencyKey: string;
  actor: OperationActor;
  sourceCode: "admin_api" | "iris" | "discord" | "external_api" | "system";
}

export interface SetCurrencyAbsoluteCommand {
  playerId: string;
  targetDisplayName: string;
  currencyCode: string;
  balance: string;
  reasonCode: string;
  reason: string;
  idempotencyKey: string;
  actor: OperationActor;
  sourceCode: "admin_api" | "iris";
  sourceEventId?: string;
  irisReplyDestinationId?: string;
}

export interface SetCurrencyAbsoluteResult {
  previousBalance: string;
  balance: string;
  delta: string;
  version: string;
  auditId: string;
  data: string;
  outboxId: string;
}

export interface AdminAdjustCurrencyCommand {
  playerId: string;
  targetDisplayName: string;
  currencyCode: string;
  mode: "add" | "subtract";
  amount: string;
  reasonCode: string;
  reason: string;
  idempotencyKey: string;
  actor: OperationActor;
  sourceCode: "iris";
  sourceEventId: string;
  irisReplyDestinationId: string;
}

export interface AdminAdjustCurrencyResult {
  previousBalance: string;
  balance: string;
  requestedAmount: string;
  actualAmount: string;
  version: string;
  auditId: string;
  data: string;
  outboxId: string;
}

// 재화 잔액·원장·감사·outbox를 원자적으로 변경합니다.
export class CurrencyService {
  private readonly operations: TransactionalOperationRunner;
  constructor(private readonly database: DatabaseClient) { this.operations = new TransactionalOperationRunner(database); }

  async adjust(command: AdjustCurrencyCommand): Promise<{ balance: string; version: string; auditId: string }> {
    const delta = parseDecimal3(command.delta, "delta");
    if (delta === 0n) throw new ApplicationError("ZERO_CURRENCY_DELTA", "재화 변경량은 0일 수 없습니다.", 422);
    return this.operations.run({
      scope: `currency.adjust:${command.playerId}:${command.currencyCode}`, idempotencyKey: command.idempotencyKey,
      actor: command.actor, sourceCode: command.sourceCode, actionCode: "currency.adjust", targetType: "player",
      targetId: command.playerId, reason: command.reason, outboxType: "currency.changed"
    }, async (transaction, operationId) => {
      const definitions = await transaction.query<Array<{ code: string }>>(
        "SELECT code FROM currency_definitions WHERE code = ? AND active = TRUE", [command.currencyCode]
      );
      if (definitions[0] === undefined) throw new ApplicationError("CURRENCY_NOT_FOUND", "사용 가능한 재화를 찾을 수 없습니다.", 404);
      await transaction.execute(
        "INSERT IGNORE INTO currency_accounts (player_id, currency_code, balance, version) VALUES (?, ?, 0, 0)",
        [command.playerId, command.currencyCode]
      );
      const accounts = await transaction.query<Array<{ balance: string; version: bigint }>>(
        "SELECT balance, version FROM currency_accounts WHERE player_id = ? AND currency_code = ? FOR UPDATE",
        [command.playerId, command.currencyCode]
      );
      const account = accounts[0];
      if (account === undefined) throw new ApplicationError("PLAYER_NOT_FOUND", "회원 재화 계정을 만들 수 없습니다.", 404);
      if (account.version.toString() !== command.expectedVersion) throw new ApplicationError("CURRENCY_VERSION_CONFLICT", "재화 잔액이 먼저 변경되었습니다.", 409);
      const balance = parseDecimal3(account.balance, "balance") + delta;
      if (!command.allowNegative && balance < 0n) throw new ApplicationError("INSUFFICIENT_CURRENCY", "재화 잔액이 부족합니다.", 409);
      const nextVersion = account.version + 1n;
      await transaction.execute(
        "UPDATE currency_accounts SET balance = ?, version = ? WHERE player_id = ? AND currency_code = ? AND version = ?",
        [formatDecimal3(balance), nextVersion, command.playerId, command.currencyCode, account.version]
      );
      await transaction.execute(
        `INSERT INTO currency_ledger
          (operation_id, sequence_no, player_id, currency_code, delta, balance_after, reason_code)
         VALUES (?, 1, ?, ?, ?, ?, ?)`,
        [operationId, command.playerId, command.currencyCode, formatDecimal3(delta), formatDecimal3(balance), command.reasonCode]
      );
      return { result: { balance: formatDecimal3(balance), version: nextVersion.toString() }, changeSummary: { currencyCode: command.currencyCode, delta: formatDecimal3(delta), balance: formatDecimal3(balance) } };
    });
  }

  // 잠근 현재 잔액에서 delta를 계산해 절대 잔액 설정·원장·감사·응답을 원자 처리합니다.
  async setAbsolute(command: SetCurrencyAbsoluteCommand): Promise<SetCurrencyAbsoluteResult> {
    const targetBalance = parseDecimal3(command.balance, "balance");
    if (targetBalance < 0n) throw new ApplicationError("NEGATIVE_CURRENCY_BALANCE", "재화 잔액은 0 이상이어야 합니다.", 422);
    const scope = `currency.set_absolute:${command.playerId}:${command.currencyCode}`;
    try {
      return await this.database.withTransaction(async (transaction) => {
        const prior = await transaction.query<Array<{ result_json: string | SetCurrencyAbsoluteResult | null }>>(
          "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE",
          [scope, command.idempotencyKey]
        );
        if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) {
          return typeof prior[0].result_json === "string" ? JSON.parse(prior[0].result_json) : prior[0].result_json;
        }
        const definitions = await transaction.query<Array<{ code: string }>>(
          "SELECT code FROM currency_definitions WHERE code = ? AND active = TRUE", [command.currencyCode]
        );
        if (definitions[0] === undefined) throw new ApplicationError("CURRENCY_NOT_FOUND", "사용 가능한 재화를 찾을 수 없습니다.", 404);
        await transaction.execute(
          "INSERT IGNORE INTO currency_accounts (player_id, currency_code, balance, version) VALUES (?, ?, 0, 0)",
          [command.playerId, command.currencyCode]
        );
        const accounts = await transaction.query<Array<{ balance: string; version: bigint }>>(
          "SELECT CAST(balance AS CHAR) AS balance, version FROM currency_accounts WHERE player_id = ? AND currency_code = ? FOR UPDATE",
          [command.playerId, command.currencyCode]
        );
        const account = accounts[0];
        if (account === undefined) throw new ApplicationError("PLAYER_NOT_FOUND", "회원 재화 계정을 만들 수 없습니다.", 404);
        const previousBalance = parseDecimal3(account.balance, "balance");
        const delta = targetBalance - previousBalance;
        const operation = await transaction.execute(
          `INSERT INTO operations
            (operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
           VALUES (?,?,?,?,?,?,'processing',UTC_TIMESTAMP(3))`,
          [randomUUID(), scope, command.idempotencyKey, command.actor.type, command.actor.id ?? null, command.sourceCode]
        );
        const update = await transaction.execute(
          "UPDATE currency_accounts SET balance = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE player_id = ? AND currency_code = ? AND version = ?",
          [formatDecimal3(targetBalance), command.playerId, command.currencyCode, account.version]
        );
        if (update.affectedRows !== 1n) throw new ApplicationError("CURRENCY_VERSION_CONFLICT", "재화 잔액이 먼저 변경되었습니다.", 409);
        const version = (account.version + 1n).toString();
        await transaction.execute(
          `INSERT INTO currency_ledger
            (operation_id,sequence_no,player_id,currency_code,delta,balance_after,reason_code)
           VALUES (?,1,?,?,?,?,?)`,
          [operation.insertId, command.playerId, command.currencyCode, formatDecimal3(delta), formatDecimal3(targetBalance), command.reasonCode]
        );
        const audit = await transaction.execute(
          `INSERT INTO command_audit
            (operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
           VALUES (?,?,?,?,?,'currency.set_absolute','success',?,?,UTC_TIMESTAMP(3))`,
          [operation.insertId, command.actor.type, command.actor.id ?? null, "player", command.playerId, command.reason,
            JSON.stringify({ currencyCode: command.currencyCode, previousBalance: formatDecimal3(previousBalance), balance: formatDecimal3(targetBalance), delta: formatDecimal3(delta), version })]
        );
        if (command.sourceEventId !== undefined) {
          await transaction.execute(
            `INSERT INTO command_executions
              (event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)
             VALUES (?,'admin_point_edit',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
            [command.sourceEventId, operation.insertId]
          );
        }
        const data = `✅ 포인트 수정 완료\n[${command.targetDisplayName}] ${formatPoint(previousBalance)} → ${formatPoint(targetBalance)}`;
        const outbox = await transaction.execute(
          `INSERT INTO outbox_messages
            (operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
           VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
          [operation.insertId, command.irisReplyDestinationId ?? command.playerId, JSON.stringify({ data })]
        );
        const result: SetCurrencyAbsoluteResult = {
          previousBalance: formatDecimal3(previousBalance), balance: formatDecimal3(targetBalance), delta: formatDecimal3(delta),
          version, auditId: audit.insertId.toString(), data, outboxId: outbox.insertId.toString()
        };
        await transaction.execute(
          "UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?",
          [JSON.stringify(result), operation.insertId]
        );
        return result;
      });
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const prior = await this.database.query<Array<{ result_json: string | SetCurrencyAbsoluteResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ?", [scope, command.idempotencyKey]
      );
      if (prior[0]?.result_json === undefined || prior[0].result_json === null) throw error;
      return typeof prior[0].result_json === "string" ? JSON.parse(prior[0].result_json) : prior[0].result_json;
    }
  }

  // 관리자 증감 요청을 잠근 잔액 기준 실제 변경량으로 계산해 원장·감사·응답과 함께 원자 처리합니다.
  async adjustByAdmin(command: AdminAdjustCurrencyCommand): Promise<AdminAdjustCurrencyResult> {
    const requestedAmount = parseDecimal3(command.amount, "amount");
    if (requestedAmount <= 0n) throw new ApplicationError("INVALID_CURRENCY_AMOUNT", "다이아 수량은 1 이상이어야 합니다.", 422);
    const scope = `currency.admin_adjust:${command.playerId}:${command.currencyCode}`;
    try {
      return await this.database.withTransaction(async (transaction) => {
        const prior = await transaction.query<Array<{ result_json: string | AdminAdjustCurrencyResult | null }>>(
          "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE",
          [scope, command.idempotencyKey]
        );
        if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) {
          return typeof prior[0].result_json === "string" ? JSON.parse(prior[0].result_json) : prior[0].result_json;
        }
        const definitions = await transaction.query<Array<{ code: string }>>(
          "SELECT code FROM currency_definitions WHERE code = ? AND active = TRUE", [command.currencyCode]
        );
        if (definitions[0] === undefined) throw new ApplicationError("CURRENCY_NOT_FOUND", "사용 가능한 재화를 찾을 수 없습니다.", 404);
        await transaction.execute(
          "INSERT IGNORE INTO currency_accounts (player_id, currency_code, balance, version) VALUES (?, ?, 0, 0)",
          [command.playerId, command.currencyCode]
        );
        const accounts = await transaction.query<Array<{ balance: string; version: bigint }>>(
          "SELECT CAST(balance AS CHAR) AS balance, version FROM currency_accounts WHERE player_id = ? AND currency_code = ? FOR UPDATE",
          [command.playerId, command.currencyCode]
        );
        const account = accounts[0];
        if (account === undefined) throw new ApplicationError("PLAYER_NOT_FOUND", "회원 재화 계정을 만들 수 없습니다.", 404);
        const previousBalance = parseDecimal3(account.balance, "balance");
        const actualAmount = command.mode === "add"
          ? requestedAmount
          : (requestedAmount > previousBalance ? previousBalance : requestedAmount);
        const delta = command.mode === "add" ? actualAmount : -actualAmount;
        const targetBalance = previousBalance + delta;
        if (targetBalance > 999999999999999999999999999000n) {
          throw new ApplicationError("CURRENCY_BALANCE_OVERFLOW", "다이아 보유 한도를 초과합니다.", 422);
        }
        const operation = await transaction.execute(
          `INSERT INTO operations
            (operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
           VALUES (?,?,?,?,?,?,'processing',UTC_TIMESTAMP(3))`,
          [randomUUID(), scope, command.idempotencyKey, command.actor.type, command.actor.id ?? null, command.sourceCode]
        );
        const update = await transaction.execute(
          "UPDATE currency_accounts SET balance = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE player_id = ? AND currency_code = ? AND version = ?",
          [formatDecimal3(targetBalance), command.playerId, command.currencyCode, account.version]
        );
        if (update.affectedRows !== 1n) throw new ApplicationError("CURRENCY_VERSION_CONFLICT", "재화 잔액이 먼저 변경되었습니다.", 409);
        const version = (account.version + 1n).toString();
        await transaction.execute(
          `INSERT INTO currency_ledger
            (operation_id,sequence_no,player_id,currency_code,delta,balance_after,reason_code)
           VALUES (?,1,?,?,?,?,?)`,
          [operation.insertId, command.playerId, command.currencyCode, formatDecimal3(delta), formatDecimal3(targetBalance), command.reasonCode]
        );
        const audit = await transaction.execute(
          `INSERT INTO command_audit
            (operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
           VALUES (?,?,?,?,?,'currency.admin_adjust','success',?,?,UTC_TIMESTAMP(3))`,
          [operation.insertId, command.actor.type, command.actor.id ?? null, "player", command.playerId, command.reason,
            JSON.stringify({ currencyCode: command.currencyCode, mode: command.mode, requestedAmount: formatDecimal3(requestedAmount),
              actualAmount: formatDecimal3(actualAmount), previousBalance: formatDecimal3(previousBalance), balance: formatDecimal3(targetBalance), version })]
        );
        await transaction.execute(
          `INSERT INTO command_executions
            (event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)
           VALUES (?,?,?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
          [command.sourceEventId, command.mode === "add" ? "admin_diamond_add" : "admin_diamond_subtract", operation.insertId]
        );
        const label = command.mode === "add" ? "추가" : "차감";
        const sign = command.mode === "add" ? "+" : "-";
        const data = `✅ 다이아 ${label} 완료\n[${command.targetDisplayName}] ${sign}${formatPoint(actualAmount)} (보유 ${formatPoint(targetBalance)})`;
        const outbox = await transaction.execute(
          `INSERT INTO outbox_messages
            (operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
           VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
          [operation.insertId, command.irisReplyDestinationId, JSON.stringify({ data })]
        );
        const result: AdminAdjustCurrencyResult = {
          previousBalance: formatDecimal3(previousBalance), balance: formatDecimal3(targetBalance),
          requestedAmount: formatDecimal3(requestedAmount), actualAmount: formatDecimal3(actualAmount), version,
          auditId: audit.insertId.toString(), data, outboxId: outbox.insertId.toString()
        };
        await transaction.execute(
          "UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?",
          [JSON.stringify(result), operation.insertId]
        );
        return result;
      });
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const prior = await this.database.query<Array<{ result_json: string | AdminAdjustCurrencyResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ?", [scope, command.idempotencyKey]
      );
      if (prior[0]?.result_json === undefined || prior[0].result_json === null) throw error;
      return typeof prior[0].result_json === "string" ? JSON.parse(prior[0].result_json) : prior[0].result_json;
    }
  }
}

// 정수 포인트를 사용자 응답용 천 단위 구분 형식으로 변환합니다.
function formatPoint(value: bigint): string {
  const decimal = formatDecimal3(value);
  const negative = decimal.startsWith("-");
  const unsigned = negative ? decimal.slice(1) : decimal;
  const parts = unsigned.split(".");
  const grouped = parts[0]!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${parts[1] === undefined ? "" : `.${parts[1]}`}`;
}

// 동시 idempotency operation 생성 경합만 완료 결과 재조회 대상으로 판별합니다.
function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null
    && (("errno" in error && error.errno === 1062) || ("code" in error && error.code === "ER_DUP_ENTRY"));
}
