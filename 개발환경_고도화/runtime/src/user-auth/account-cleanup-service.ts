import { createHash, randomUUID } from "node:crypto";
import { argon2id, hash } from "argon2";
import type { DatabaseClient } from "../database.js";

function anonymized(prefix: string, value: string): string {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 32)}`;
}

export class AccountCleanupService {
  constructor(private readonly database: DatabaseClient) {}

  // 24시간이 지난 미인증 계정과 종속 임시 데이터를 일괄 삭제합니다.
  async runExpiredPending(limit = 100): Promise<{ processed: number; failed: number }> {
    const expired = await this.database.query<Array<{ id: bigint }>>(
      `SELECT id FROM user_accounts
       WHERE status = 'pending_kakao_link' AND pending_expires_at <= UTC_TIMESTAMP(3)
       ORDER BY pending_expires_at LIMIT ?`,
      [limit]
    );
    let processed = 0;
    let failed = 0;
    for (const account of expired) {
      try {
        const removed = await this.database.withTransaction(async (transaction) => {
          const rows = await transaction.query<Array<{ id: bigint }>>(
            `SELECT id FROM user_accounts
             WHERE id = ? AND status = 'pending_kakao_link' AND pending_expires_at <= UTC_TIMESTAMP(3)
             FOR UPDATE`,
            [account.id]
          );
          if (rows[0] === undefined) return false;
          await transaction.execute("DELETE FROM user_verification_challenges WHERE user_account_id = ?", [account.id]);
          await transaction.execute("DELETE FROM user_terms_acceptances WHERE user_account_id = ?", [account.id]);
          await transaction.execute("DELETE FROM user_sessions WHERE user_account_id = ?", [account.id]);
          await transaction.execute("DELETE FROM user_accounts WHERE id = ?", [account.id]);
          return true;
        });
        if (removed) processed += 1;
      } catch {
        failed += 1;
      }
    }
    return { processed, failed };
  }

  // 30일 유예가 끝난 계정의 인증정보와 외부 식별자를 익명화합니다.
  async runDue(limit = 50): Promise<{ processed: number; failed: number }> {
    const due = await this.database.query<Array<{ id: bigint }>>(
      `SELECT id FROM account_deletion_requests
       WHERE status IN ('grace_period', 'failed') AND scheduled_delete_at <= UTC_TIMESTAMP(3)
       ORDER BY scheduled_delete_at LIMIT ?`, [limit]
    );
    let processed = 0;
    let failed = 0;
    for (const request of due) {
      try {
        const deletedPasswordHash = await hash(randomUUID(), { type: argon2id });
        await this.database.withTransaction(async (transaction) => {
          await transaction.query("SELECT lock_key FROM canonical_account_authority_global_locks WHERE lock_key='ACCOUNT_AUTHORITY' FOR UPDATE");
          const rows = await transaction.query<Array<{ user_account_id: bigint; player_id: bigint; login_id: string; system_account_name: string }>>(
            `SELECT deletion.user_account_id, deletion.player_id, account_row.login_id, account_row.system_account_name
             FROM account_deletion_requests deletion JOIN user_accounts account_row ON account_row.id = deletion.user_account_id
             WHERE deletion.id = ? AND deletion.status IN ('grace_period', 'failed') FOR UPDATE`, [request.id]
          );
          const row = rows[0];
          if (row === undefined) return;
          const attempts = await transaction.query<Array<{ next_attempt: bigint }>>("SELECT COUNT(*) + 1 AS next_attempt FROM account_cleanup_runs WHERE deletion_request_id = ?", [request.id]);
          const run = await transaction.execute("INSERT INTO account_cleanup_runs (deletion_request_id, status, attempt_no) VALUES (?, 'processing', ?)", [request.id, attempts[0]?.next_attempt ?? 1n]);
          await transaction.execute("UPDATE account_deletion_requests SET status = 'processing', updated_at = UTC_TIMESTAMP(3) WHERE id = ?", [request.id]);
          await transaction.execute("DELETE FROM user_sessions WHERE user_account_id = ?", [row.user_account_id]);
          await transaction.execute("DELETE FROM user_verification_challenges WHERE user_account_id = ?", [row.user_account_id]);
          await transaction.execute("DELETE identity_name FROM external_identity_names identity_name JOIN external_identities identity ON identity.id = identity_name.external_identity_id WHERE identity.player_id = ?", [row.player_id]);
          const identities = await transaction.query<Array<{ id: bigint; provider_code: string; external_user_id: string }>>("SELECT id, provider_code, external_user_id FROM external_identities WHERE player_id = ? FOR UPDATE", [row.player_id]);
          for (const identity of identities) {
            await transaction.execute(
              `UPDATE external_identities SET player_id = NULL, external_user_id = ?, display_name = NULL,
                status = 'deleted', updated_at = UTC_TIMESTAMP(3) WHERE id = ?`,
              [anonymized(`deleted_${identity.provider_code}`, identity.external_user_id), identity.id]
            );
          }
          const suffix = randomUUID().replaceAll("-", "");
          await transaction.execute(
            `UPDATE user_accounts SET login_id = ?, system_account_name = ?, password_hash = ?, status = 'deleted',
              player_id = NULL, pending_expires_at = NULL, deleted_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3) WHERE id = ?`,
            [`deleted_${suffix.slice(0, 12)}`, `삭제 ${suffix.slice(0, 12)}`, deletedPasswordHash, row.user_account_id]
          );
          await transaction.execute("UPDATE player_profiles SET current_display_name = ?, updated_at = UTC_TIMESTAMP(3) WHERE player_id = ?", [`삭제 ${suffix.slice(12, 24)}`, row.player_id]);
          await transaction.execute("UPDATE players SET status = 'deleted', updated_at = UTC_TIMESTAMP(3) WHERE id = ?", [row.player_id]);
          await transaction.execute("UPDATE account_deletion_requests SET status = 'completed', completed_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3) WHERE id = ?", [request.id]);
          await transaction.execute("UPDATE account_cleanup_runs SET status = 'completed', completed_at = UTC_TIMESTAMP(3) WHERE id = ?", [run.insertId]);
        });
        processed += 1;
      } catch {
        failed += 1;
        await this.database.withTransaction(async (transaction) => {
          const attempts = await transaction.query<Array<{ next_attempt: bigint }>>("SELECT COUNT(*) + 1 AS next_attempt FROM account_cleanup_runs WHERE deletion_request_id = ?", [request.id]);
          await transaction.execute("INSERT INTO account_cleanup_runs (deletion_request_id, status, attempt_no, error_code, completed_at) VALUES (?, 'failed', ?, 'CLEANUP_FAILED', UTC_TIMESTAMP(3))", [request.id, attempts[0]?.next_attempt ?? 1n]);
          await transaction.execute("UPDATE account_deletion_requests SET status = 'failed', updated_at = UTC_TIMESTAMP(3) WHERE id = ?", [request.id]);
        });
      }
    }
    return { processed, failed };
  }

  // 미인증 계정과 30일 탈퇴 유예 계정을 한 번의 유지보수 주기로 정리합니다.
  async runMaintenance(): Promise<{
    pending: { processed: number; failed: number };
    deleted: { processed: number; failed: number };
  }> {
    const pending = await this.runExpiredPending();
    const deleted = await this.runDue();
    return { pending, deleted };
  }
}
