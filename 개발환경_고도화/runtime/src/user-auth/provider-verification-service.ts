import { randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { createInitialPlayer } from "../signup/create-initial-player.js";
import { USER_CODE_MAX_FAILURES, type KakaoVerificationPurpose } from "./policy.js";
import { DEFAULT_MAX_EXTERNAL_LINKS, hashVerificationCode } from "./user-auth-service.js";

interface ChallengeRow {
  id: bigint;
  user_account_id: bigint;
  code_hash: string;
  failed_attempt_count: number;
  challenge_expired: number;
  account_status: string;
  pending_expired: number;
  system_account_name: string;
  player_id: bigint | null;
}

interface IdentityRow {
  id: bigint;
  player_id: bigint | null;
}

export interface ProviderVerificationResult {
  status: "verified";
  playerId: string;
  purpose: KakaoVerificationPurpose;
  data: string;
}

// 외부 계정 연결 수의 현재 관리자 설정값을 읽습니다.
async function readMaxActiveLinks(transaction: DatabaseTransaction): Promise<number> {
  const rows = await transaction.query<Array<{ max_active_links: bigint | null }>>(
    `SELECT COALESCE((SELECT value_row.integer_value
      FROM configuration_sets config
      JOIN configuration_values value_row ON value_row.configuration_set_id = config.id
      WHERE config.set_code = 'site.external_platform' AND config.status = 'active'
        AND value_row.config_key = 'max_active_links'
        AND (config.effective_from IS NULL OR config.effective_from <= UTC_TIMESTAMP(3))
        AND (config.effective_to IS NULL OR config.effective_to > UTC_TIMESTAMP(3))
      ORDER BY config.version DESC LIMIT 1), ?) AS max_active_links`,
    [DEFAULT_MAX_EXTERNAL_LINKS]
  );
  return Number(rows[0]?.max_active_links ?? BigInt(DEFAULT_MAX_EXTERNAL_LINKS));
}

// 인증 실패 횟수를 누적하고 허용 횟수를 넘은 challenge를 닫습니다.
async function recordFailedCode(transaction: DatabaseTransaction, challengeId: bigint, failedAttemptCount: number): Promise<void> {
  const nextCount = failedAttemptCount + 1;
  await transaction.execute(
    `UPDATE user_verification_challenges SET failed_attempt_count = ?,
      status = IF(? >= ?, 'failed', status), updated_at = UTC_TIMESTAMP(3) WHERE id = ?`,
    [nextCount, nextCount, USER_CODE_MAX_FAILURES, challengeId]
  );
}

// KakaoTalk의 안정적인 사용자 ID와 용도별 인증 코드로 사이트 계정 연결을 완료합니다.
export class ProviderVerificationService {
  constructor(private readonly database: DatabaseClient, private readonly verificationPepper: string) {}

  async verifyKakao(input: {
    purpose: KakaoVerificationPurpose;
    code: string;
    externalUserId: string;
    displayName?: string;
    channelId: string;
  }): Promise<ProviderVerificationResult> {
    const outcome = await this.database.withTransaction(async (transaction) => {
      const candidates = await transaction.query<ChallengeRow[]>(
        `SELECT challenge.id, challenge.user_account_id, challenge.code_hash, challenge.failed_attempt_count,
          challenge.expires_at <= UTC_TIMESTAMP(3) AS challenge_expired,
          account_row.status AS account_status,
          account_row.pending_expires_at IS NULL OR account_row.pending_expires_at <= UTC_TIMESTAMP(3) AS pending_expired,
          account_row.system_account_name, account_row.player_id
         FROM user_verification_challenges challenge
         JOIN user_accounts account_row ON account_row.id = challenge.user_account_id
         WHERE challenge.code_hint = ? AND challenge.provider_code = 'kakao'
           AND challenge.purpose_code = ? AND challenge.status = 'pending'
         ORDER BY challenge.created_at DESC FOR UPDATE`,
        [input.code.slice(0, 4), input.purpose]
      );
      const codeHash = hashVerificationCode(input.code, this.verificationPepper);
      const challenge = candidates.find((row) => row.code_hash === codeHash);
      if (challenge === undefined) {
        if (candidates.length === 1 && candidates[0] !== undefined) {
          await recordFailedCode(transaction, candidates[0].id, candidates[0].failed_attempt_count);
        }
        return { error: new ApplicationError("VERIFICATION_CODE_INVALID", "인증 코드를 확인해 주세요.", 422) };
      }
      if (Boolean(challenge.challenge_expired)) {
        await transaction.execute(
          "UPDATE user_verification_challenges SET status = 'expired', updated_at = UTC_TIMESTAMP(3) WHERE id = ?",
          [challenge.id]
        );
        return { error: new ApplicationError("VERIFICATION_CODE_EXPIRED", "인증 코드가 만료됐습니다. 사이트에서 다시 발급해 주세요.", 409) };
      }
      if (input.purpose === "signup_link"
        && (challenge.account_status !== "pending_kakao_link" || Boolean(challenge.pending_expired))) {
        throw new ApplicationError("SIGNUP_NOT_PENDING", "인증 가능한 가입 계정이 아닙니다.", 409);
      }
      if (input.purpose === "account_link"
        && (challenge.account_status !== "active" || challenge.player_id === null)) {
        throw new ApplicationError("ACCOUNT_UNAVAILABLE", "외부 계정을 연결할 수 없는 사이트 계정입니다.", 409);
      }

      const accountLock = await transaction.query<Array<{ id: bigint }>>(
        "SELECT id FROM user_accounts WHERE id = ? FOR UPDATE", [challenge.user_account_id]
      );
      if (accountLock[0] === undefined) throw new ApplicationError("ACCOUNT_UNAVAILABLE", "사이트 계정을 찾을 수 없습니다.", 404);

      const identities = await transaction.query<IdentityRow[]>(
        `SELECT id, player_id FROM external_identities
         WHERE provider_code = 'kakao' AND external_user_id = ? FOR UPDATE`,
        [input.externalUserId]
      );
      let identityId = identities[0]?.id;
      if (identityId === undefined) {
        const identity = await transaction.execute(
          `INSERT INTO external_identities
             (provider_code, external_user_id, display_name, status, created_at, updated_at)
            VALUES ('kakao', ?, NULL, 'candidate', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          [input.externalUserId]
        );
        identityId = identity.insertId;
      }

      const existingLink = await transaction.query<Array<{ user_account_id: bigint; status: string }>>(
        "SELECT user_account_id, status FROM user_account_external_identities WHERE external_identity_id = ? FOR UPDATE",
        [identityId]
      );
      if (existingLink[0]?.status === "blocked") {
        throw new ApplicationError("PROVIDER_IDENTITY_BLOCKED", "관리자가 차단한 외부 플랫폼 계정입니다.", 403);
      }
      if (existingLink[0]?.status === "active" && existingLink[0].user_account_id !== challenge.user_account_id) {
        throw new ApplicationError("PROVIDER_IDENTITY_ALREADY_LINKED", "이미 다른 사이트 계정에 연결된 KakaoTalk 계정입니다.", 409);
      }

      const existingIdentityPlayerId = identities[0]?.player_id;
      if (input.purpose === "signup_link"
        && existingIdentityPlayerId !== null && existingIdentityPlayerId !== undefined) {
        throw new ApplicationError("PROVIDER_IDENTITY_ALREADY_LINKED", "이미 다른 사이트 계정에 연결된 KakaoTalk 계정입니다.", 409);
      }
      if (input.purpose === "account_link" && existingIdentityPlayerId !== null
        && existingIdentityPlayerId !== undefined && existingIdentityPlayerId !== challenge.player_id) {
        throw new ApplicationError("PROVIDER_IDENTITY_ALREADY_LINKED", "이미 다른 게임 계정에 연결된 KakaoTalk 계정입니다.", 409);
      }
      const playerId = input.purpose === "signup_link"
        ? await createInitialPlayer(transaction, challenge.system_account_name, input.channelId, identityId)
        : challenge.player_id!;

      const activeCountRows = await transaction.query<Array<{ active_links: bigint }>>(
        "SELECT COUNT(*) AS active_links FROM user_account_external_identities WHERE user_account_id = ? AND status = 'active'",
        [challenge.user_account_id]
      );
      const alreadyActive = existingLink[0]?.status === "active"
        && existingLink[0].user_account_id === challenge.user_account_id;
      const maxActiveLinks = await readMaxActiveLinks(transaction);
      if (!alreadyActive && Number(activeCountRows[0]?.active_links ?? 0n) >= maxActiveLinks) {
        throw new ApplicationError(
          "EXTERNAL_LINK_LIMIT_REACHED",
          `외부 플랫폼 계정은 최대 ${maxActiveLinks}개까지 연결할 수 있습니다.`, 409
        );
      }

      await transaction.execute(
        `UPDATE external_identities SET player_id = ?, display_name = COALESCE(?, display_name),
          status = 'linked', updated_at = UTC_TIMESTAMP(3) WHERE id = ?`,
        [playerId, input.displayName ?? null, identityId]
      );
      if (input.displayName !== undefined) {
        await transaction.execute(
          `INSERT INTO external_identity_names
            (external_identity_id, display_name, source_code, trust_status, provider_event_id, observed_at)
           VALUES (?, ?, 'provider_verification', 'observed', ?, UTC_TIMESTAMP(3))`,
          [identityId, input.displayName, `verification:${challenge.id.toString()}`]
        );
      }
      await transaction.execute(
        `INSERT INTO user_account_external_identities
          (user_account_id, external_identity_id, link_purpose_code, status, linked_via_challenge_id,
           linked_at, unlinked_at, blocked_at, created_at, updated_at)
         VALUES (?, ?, ?, 'active', ?, UTC_TIMESTAMP(3), NULL, NULL, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE user_account_id = VALUES(user_account_id), link_purpose_code = VALUES(link_purpose_code),
           status = 'active', linked_via_challenge_id = VALUES(linked_via_challenge_id), linked_at = UTC_TIMESTAMP(3),
           unlinked_at = NULL, blocked_at = NULL, updated_at = UTC_TIMESTAMP(3)`,
        [challenge.user_account_id, identityId, input.purpose, challenge.id]
      );
      const linkedRows = await transaction.query<Array<{ id: bigint }>>(
        "SELECT id FROM user_account_external_identities WHERE external_identity_id = ? FOR UPDATE",
        [identityId]
      );
      const linkId = linkedRows[0]!.id;
      await transaction.execute(
        `INSERT INTO user_account_external_identity_history
          (link_id, user_account_id, external_identity_id, action_code, actor_type, actor_id, reason, challenge_id, created_at)
         VALUES (?, ?, ?, 'linked', 'external_identity', ?, ?, ?, UTC_TIMESTAMP(3))`,
        [linkId, challenge.user_account_id, identityId, identityId,
          input.purpose === "signup_link" ? "사이트 회원가입 인증" : "사이트 계정 추가 연결", challenge.id]
      );
      if (input.purpose === "signup_link") {
        await transaction.execute(
          `UPDATE user_accounts SET player_id = ?, status = 'active', pending_expires_at = NULL,
            activated_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3)
           WHERE id = ? AND status = 'pending_kakao_link'`,
          [playerId, challenge.user_account_id]
        );
      }
      await transaction.execute(
        `UPDATE user_verification_challenges SET status = 'verified', verified_external_identity_id = ?,
          verified_at = UTC_TIMESTAMP(3), consumed_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3)
         WHERE id = ?`,
        [identityId, challenge.id]
      );
      const operation = await transaction.execute(
        `INSERT INTO operations
          (operation_key, actor_type, actor_id, source_code, status, result_json, created_at, completed_at)
         VALUES (?, 'external_identity', ?, 'iris', 'completed', ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [randomUUID(), identityId, JSON.stringify({ playerId: playerId.toString(), purpose: input.purpose, status: "verified" })]
      );
      await transaction.execute(
        `INSERT INTO command_audit
          (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason,
           change_summary_json, created_at)
         VALUES (?, 'external_identity', ?, 'user_account_external_identity', ?, ?, 'success', ?, ?, UTC_TIMESTAMP(3))`,
        [operation.insertId, identityId, linkId,
          input.purpose === "signup_link" ? "user.signup.kakao.verify" : "user.external_identity.kakao.link",
          input.purpose === "signup_link" ? "사이트 회원가입 Kakao 인증" : "사이트 계정 Kakao 추가 연결",
          JSON.stringify({ accountId: challenge.user_account_id.toString(), playerId: playerId.toString() })]
      );
      return {
        result: {
          status: "verified" as const, playerId: playerId.toString(), purpose: input.purpose,
          data: input.purpose === "signup_link"
            ? `✅ '${challenge.system_account_name}' 계정의 KakaoTalk 연동과 회원가입이 완료됐습니다.`
            : `✅ '${challenge.system_account_name}' 계정에 KakaoTalk 계정이 연결됐습니다.`
        }
      };
    });
    if ("error" in outcome) throw outcome.error;
    return outcome.result;
  }
}
