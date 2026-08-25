import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

export interface AdminDailyPayoutCommand { externalUserId: string; channelId: string; message: string; eventId: string; }
export interface AdminDailyPayoutResult {
  status: "paid" | "ignored_unauthorized";
  operatorId?: string; recipientCount?: string; payoutAmount?: string; outboxId?: string; auditId?: string;
  data?: string; duplicate?: boolean;
}
interface OperatorRow { operator_id: bigint; identity_id: bigint; }
interface PolicyRow { policy_code: string; payout_amount: string; display_amount: string; version: bigint; }
interface RecipientRow { operator_id: bigint; player_id: bigint; current_display_name: string; }
interface AccountRow { player_id: bigint; balance: string; version: bigint; }

// 관리자 일당은 인자나 별칭 없는 정확 명령만 허용합니다.
export function isAdminDailyPayoutCommand(message: string | undefined): boolean { return message === "/관리자일당"; }

// event ID를 operations key 길이에 맞게 정규화합니다.
function eventKey(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }

// MariaDB JSON 결과를 재실행 응답으로 복원합니다.
function stored(value: string | AdminDailyPayoutResult): AdminDailyPayoutResult { return typeof value === "string" ? JSON.parse(value) as AdminDailyPayoutResult : value; }

// 정수 DECIMAL 문자열을 손실 없는 bigint로 변환합니다.
function integer(value: string): bigint {
  const match = /^(-?\d+)(?:\.0+)?$/.exec(value);
  if (match === null) throw new ApplicationError("ADMIN_DAILY_PAYOUT_NON_INTEGER", "관리자 일당 금액을 정수로 확인할 수 없습니다.", 409);
  return BigInt(match[1]!);
}

// bigint를 legacy 한국어 억 단위 지급 문구로 표시합니다.
function displayAmount(value: bigint): string { return value === 1_000_000_000n ? "10억" : value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

// stale snapshot 충돌만 한 번 재시도합니다.
function retryable(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && error.code === "ER_CHECKREAD"; }

// 활성 관리자 wallet 일괄 지급을 원장·감사·outbox와 함께 원자적으로 저장합니다.
export class AdminDailyPayoutService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(command: AdminDailyPayoutCommand): Promise<AdminDailyPayoutResult> {
    if (!isAdminDailyPayoutCommand(command.message)) throw new ApplicationError("INVALID_ADMIN_DAILY_PAYOUT_COMMAND", "정확한 /관리자일당을 입력해주세요.", 422);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await this.database.withTransaction(async (transaction) => {
          const operators = await transaction.query<OperatorRow[]>(
            `SELECT operator.id AS operator_id, identity.id AS identity_id
             FROM external_identities identity
             JOIN admin_operator_external_identities mapping ON mapping.external_identity_id = identity.id
             JOIN admin_operators operator ON operator.id = mapping.operator_id AND operator.status = 'active'
             JOIN admin_daily_payout_operators allowed ON allowed.operator_id = operator.id AND allowed.active = TRUE
             WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ? AND identity.status = 'linked'
             FOR UPDATE`, [command.externalUserId]
          );
          const operator = operators[0];
          if (operator === undefined) return { status: "ignored_unauthorized" };
          const policies = await transaction.query<PolicyRow[]>(
            "SELECT policy_code, CAST(payout_amount AS CHAR) AS payout_amount, CAST(display_amount AS CHAR) AS display_amount, version FROM admin_daily_payout_policies WHERE active = TRUE ORDER BY version DESC LIMIT 1 FOR UPDATE"
          );
          const policy = policies[0];
          if (policy === undefined) throw new ApplicationError("ADMIN_DAILY_PAYOUT_POLICY_REQUIRED", "관리자 일당 정책을 찾을 수 없습니다.", 409);
          const payoutAmount = integer(policy.payout_amount);
          const displayPayout = integer(policy.display_amount);
          if (payoutAmount <= 0n || displayPayout <= 0n) throw new ApplicationError("ADMIN_DAILY_PAYOUT_POLICY_INVALID", "관리자 일당 정책 금액이 올바르지 않습니다.", 409);
          const scope = `admin.daily-payout:${operator.operator_id.toString()}`;
          const key = eventKey(command.eventId);
          const prior = await transaction.query<Array<{ result_json: string | AdminDailyPayoutResult | null }>>(
            "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE", [scope, key]
          );
          if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) return { ...stored(prior[0].result_json), duplicate: true };
          const recipientRows = await transaction.query<RecipientRow[]>(
            `SELECT operator.id AS operator_id, identity.player_id, profile.current_display_name
             FROM admin_operators operator
             JOIN admin_operator_external_identities mapping ON mapping.operator_id = operator.id
             JOIN external_identities identity ON identity.id = mapping.external_identity_id
             JOIN player_profiles profile ON profile.player_id = identity.player_id
             WHERE operator.status = 'active' AND identity.status = 'linked' AND identity.player_id IS NOT NULL
             ORDER BY identity.player_id, operator.id FOR UPDATE`
          );
          const recipients = [...new Map(recipientRows.map((row) => [row.player_id.toString(), row])).values()];
          for (const recipient of recipients) await transaction.execute(
            "INSERT IGNORE INTO currency_accounts (player_id, currency_code, balance, version) VALUES (?, 'point', 0, 1)", [recipient.player_id]
          );
          const accounts = recipients.length === 0 ? [] : await transaction.query<AccountRow[]>(
            `SELECT player_id, CAST(balance AS CHAR) AS balance, version FROM currency_accounts
             WHERE currency_code = 'point' AND player_id IN (${recipients.map(() => "?").join(", ")}) ORDER BY player_id FOR UPDATE`,
            recipients.map((row) => row.player_id)
          );
          const accountByPlayer = new Map(accounts.map((row) => [row.player_id.toString(), row]));
          if (accountByPlayer.size !== recipients.length) throw new ApplicationError("ADMIN_DAILY_PAYOUT_ACCOUNT_REQUIRED", "관리자 포인트 계정을 준비하지 못했습니다.", 409);
          const operation = await transaction.execute(
            "INSERT INTO operations (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, created_at) VALUES (?, ?, ?, 'admin_operator', ?, 'iris', 'processing', UTC_TIMESTAMP(3))",
            [randomUUID(), scope, key, operator.operator_id]
          );
          const execution = await transaction.execute(
            "INSERT INTO admin_daily_payout_executions (operation_id, operator_id, policy_code, policy_version, payout_amount, display_amount, recipient_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))",
            [operation.insertId, operator.operator_id, policy.policy_code, policy.version, payoutAmount, displayPayout, recipients.length]
          );
          let sequence = 0;
          for (const recipient of recipients) {
            sequence++;
            const account = accountByPlayer.get(recipient.player_id.toString())!;
            const before = integer(account.balance);
            const after = before + payoutAmount;
            const write = await transaction.execute(
              "UPDATE currency_accounts SET balance = ?, version = version + 1 WHERE player_id = ? AND currency_code = 'point' AND version = ?",
              [after, recipient.player_id, account.version]
            );
            if (write.affectedRows !== 1n) throw new ApplicationError("ADMIN_DAILY_PAYOUT_CONFLICT", "관리자 포인트가 먼저 변경되었습니다.", 409);
            await transaction.execute(
              "INSERT INTO currency_ledger (operation_id, sequence_no, player_id, currency_code, delta, balance_after, reason_code) VALUES (?, ?, ?, 'point', ?, ?, 'admin_daily_payout')",
              [operation.insertId, sequence, recipient.player_id, payoutAmount, after]
            );
            await transaction.execute(
              "INSERT INTO admin_daily_payout_grants (execution_id, recipient_operator_id, player_id, balance_before, amount, balance_after, created_at) VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))",
              [execution.insertId, recipient.operator_id, recipient.player_id, before, payoutAmount, after]
            );
          }
          const data = `관리자 ${recipients.length.toString()}명에게 ${displayAmount(displayPayout)} 포인트 지급을 완료했습니다.`;
          const outbox = await transaction.execute(
            "INSERT INTO outbox_messages (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at) VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
            [operation.insertId, command.channelId, JSON.stringify({ data })]
          );
          await transaction.execute(
            "INSERT INTO command_executions (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at) VALUES (?, 'admin_daily_payout', ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
            [command.eventId, operation.insertId]
          );
          const audit = await transaction.execute(
            "INSERT INTO command_audit (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at) VALUES (?, 'admin_operator', ?, 'admin_roster', NULL, 'admin.daily_payout', 'success', 'Iris /관리자일당', ?, UTC_TIMESTAMP(3))",
            [operation.insertId, operator.operator_id, JSON.stringify({ policyCode: policy.policy_code, policyVersion: policy.version.toString(), payoutAmount: payoutAmount.toString(), displayAmount: displayPayout.toString(), recipientPlayerIds: recipients.map((row) => row.player_id.toString()) })]
          );
          const result: AdminDailyPayoutResult = { status: "paid", operatorId: operator.operator_id.toString(), recipientCount: recipients.length.toString(), payoutAmount: payoutAmount.toString(), outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString(), data };
          await transaction.execute("UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?", [JSON.stringify(result), operation.insertId]);
          return result;
        });
      } catch (error) {
        if (attempt === 0 && retryable(error)) continue;
        throw error;
      }
    }
    throw new ApplicationError("ADMIN_DAILY_PAYOUT_CONFLICT", "관리자 일당 처리가 충돌했습니다.", 409);
  }
}
