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

// 재화 잔액·원장·감사·outbox를 원자적으로 변경합니다.
export class CurrencyService {
  private readonly operations: TransactionalOperationRunner;
  constructor(database: DatabaseClient) { this.operations = new TransactionalOperationRunner(database); }

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
}
