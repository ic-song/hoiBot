import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { AccountPlatformChallengeService } from "../account-platform/account-platform-challenge-service.js";
import { ApplicationError } from "../shared/application-error.js";
import { createInitialPlayer } from "../signup/create-initial-player.js";
import { USER_CODE_MAX_FAILURES } from "./policy.js";
import { hashVerificationCode } from "./user-auth-service.js";

interface ChallengeRow {
  id: bigint;
  user_account_id: bigint;
  code_hash: string;
  failed_attempt_count: number;
  challenge_expired: number;
  account_status: string;
  pending_expired: number;
  system_account_name: string;
}

export interface ProviderVerificationResult {
  status: "verified";
  playerId: string;
  data: string;
}

// KakaoTalk 계정 key·닉네임·인증 코드를 확인하고 사이트 계정을 활성화합니다.
export class ProviderVerificationService {
  constructor(private readonly database: DatabaseClient, private readonly verificationPepper: string) {}

  async verifyInitialKakao(input: {
    code: string;
    externalUserId: string;
    displayName: string;
    channelId: string;
    requestKey?: string;
  }): Promise<ProviderVerificationResult> {
    const codeHash = hashVerificationCode(input.code, this.verificationPepper);
    const purposes = await this.database.query<Array<{ code_hash: string; purpose_code: string }>>(
      `SELECT code_hash,purpose_code FROM user_verification_challenges
       WHERE code_hint=? AND provider_code='kakao' AND status IN ('pending','verified')
       ORDER BY created_at DESC`, [input.code.slice(0, 4).toUpperCase()]
    );
    const exactPurpose = purposes.find((candidate) => candidate.code_hash === codeHash)?.purpose_code;
    const hasModernHint = purposes.some((candidate) => candidate.purpose_code === "NEW_GAME_ACCOUNT" || candidate.purpose_code === "LEGACY_GAME_ACCOUNT_LINK");
    if (exactPurpose === "initial_link" || (exactPurpose === undefined && !hasModernHint && purposes.some((candidate) => candidate.purpose_code === "initial_link"))) {
      return this.verifyLegacyInitialKakao(input);
    }
    const requestKey = input.requestKey ?? `kakao-verification:${hashVerificationCode(`${input.code}|${input.channelId}|${input.externalUserId}`, this.verificationPepper).slice(0, 48)}`;
    let result;
    try {
      result = await new AccountPlatformChallengeService(this.database, this.verificationPepper).verify({
        requestKey, code: input.code, platformCode: "KAKAO", contextType: "ROOM",
        externalContextKey: input.channelId, externalUserKey: input.externalUserId,
        observedDisplayName: input.displayName, actor: "사용자"
      });
    } catch (error) {
      if (error instanceof ApplicationError && error.code === "ACCOUNT_NAME_MISMATCH") {
        throw new ApplicationError("ACCOUNT_NAME_MISMATCH", error.message.replace("플랫폼 닉네임", "카카오톡 닉네임"), 409);
      }
      throw error;
    }
    return {
      status: "verified",
      playerId: result.playerId,
      data: result.createdPlayer
        ? `✅ '${input.displayName}' 새 게임계정의 KakaoTalk 연동과 회원가입이 완료됐습니다.`
        : `✅ 기존 게임계정 '${input.displayName}'의 KakaoTalk 연동과 회원가입이 완료됐습니다.`
    };
  }

  // 이관 전에 발급된 initial_link 코드를 기존 계약으로 안전하게 소비합니다.
  private async verifyLegacyInitialKakao(input: {
    code: string;
    externalUserId: string;
    displayName: string;
    channelId: string;
  }): Promise<ProviderVerificationResult> {
    const outcome = await this.database.withTransaction(async (transaction) => {
      const candidates = await transaction.query<ChallengeRow[]>(
        `SELECT challenge.id, challenge.user_account_id, challenge.code_hash, challenge.failed_attempt_count,
          challenge.expires_at <= UTC_TIMESTAMP(3) AS challenge_expired,
          account_row.status AS account_status,
          account_row.pending_expires_at IS NULL OR account_row.pending_expires_at <= UTC_TIMESTAMP(3) AS pending_expired,
          account_row.system_account_name
         FROM user_verification_challenges challenge
         JOIN user_accounts account_row ON account_row.id = challenge.user_account_id
         WHERE challenge.code_hint = ? AND challenge.provider_code = 'kakao'
           AND challenge.purpose_code = 'initial_link' AND challenge.status = 'pending'
         ORDER BY challenge.created_at DESC FOR UPDATE`,
        [input.code.slice(0, 4)]
      );
      const codeHash = hashVerificationCode(input.code, this.verificationPepper);
      const challenge = candidates.find((row) => row.code_hash === codeHash);
      if (challenge === undefined) {
        // 같은 hint 충돌 시 다른 사용자의 challenge를 함께 실패 처리하지 않습니다.
        if (candidates.length === 1 && candidates[0] !== undefined) {
          const candidate = candidates[0];
          const nextCount = candidate.failed_attempt_count + 1;
          await transaction.execute(
            `UPDATE user_verification_challenges SET failed_attempt_count = ?,
              status = IF(? >= ?, 'failed', status), updated_at = UTC_TIMESTAMP(3) WHERE id = ?`,
            [nextCount, nextCount, USER_CODE_MAX_FAILURES, candidate.id]
          );
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
      if (challenge.account_status !== "pending_kakao_link"
        || Boolean(challenge.pending_expired)) {
        throw new ApplicationError("SIGNUP_NOT_PENDING", "인증 가능한 가입 계정이 아닙니다.", 409);
      }
      if (input.displayName !== challenge.system_account_name) {
        const nextCount = challenge.failed_attempt_count + 1;
        await transaction.execute(
          `UPDATE user_verification_challenges SET failed_attempt_count = ?,
            status = IF(? >= ?, 'failed', status), updated_at = UTC_TIMESTAMP(3) WHERE id = ?`,
          [nextCount, nextCount, USER_CODE_MAX_FAILURES, challenge.id]
        );
        return {
          error: new ApplicationError(
            "ACCOUNT_NAME_MISMATCH",
            `"${input.displayName}"님 카카오톡 닉네임을 "${challenge.system_account_name}"(으)로 변경한 뒤 다시 인증해 주세요.`,
            409
          )
        };
      }

      const identities = await transaction.query<Array<{ id: bigint; player_id: bigint | null }>>(
        `SELECT id, player_id FROM external_identities
         WHERE provider_code = 'kakao' AND external_user_id = ? FOR UPDATE`,
        [input.externalUserId]
      );
      let identityId = identities[0]?.id;
      if (identities[0]?.player_id !== null && identities[0]?.player_id !== undefined) {
        throw new ApplicationError("PROVIDER_IDENTITY_ALREADY_LINKED", "이미 다른 시스템 계정에 연결된 KakaoTalk 계정입니다.", 409);
      }
      if (identityId === undefined) {
        const identity = await transaction.execute(
          `INSERT INTO external_identities
             (provider_code, external_user_id, display_name, status, created_at, updated_at)
            VALUES ('kakao', ?, NULL, 'candidate', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          [input.externalUserId]
        );
        identityId = identity.insertId;
      }

      const playerId = await createInitialPlayer(transaction, challenge.system_account_name, input.channelId, identityId);
      const linked = await transaction.execute(
        `UPDATE external_identities SET player_id = ?, display_name = ?, status = 'linked', updated_at = UTC_TIMESTAMP(3)
         WHERE id = ? AND player_id IS NULL`,
        [playerId, input.displayName, identityId]
      );
      if (linked.affectedRows !== 1n) {
        throw new ApplicationError("PROVIDER_IDENTITY_ALREADY_LINKED", "KakaoTalk 계정 연결 상태가 먼저 변경됐습니다.", 409);
      }
      await transaction.execute(
        `INSERT INTO external_identity_names
          (external_identity_id, display_name, source_code, trust_status, provider_event_id, observed_at)
         VALUES (?, ?, 'provider_verification', 'verified', ?, UTC_TIMESTAMP(3))`,
        [identityId, input.displayName, `verification:${challenge.id.toString()}`]
      );
      await transaction.execute(
        `UPDATE user_accounts SET player_id = ?, status = 'active', pending_expires_at = NULL,
          activated_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3)
         WHERE id = ? AND status = 'pending_kakao_link'`,
        [playerId, challenge.user_account_id]
      );
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
        [randomUUID(), identityId, JSON.stringify({ playerId: playerId.toString(), status: "verified" })]
      );
      await transaction.execute(
        `INSERT INTO command_audit
          (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason,
           change_summary_json, created_at)
         VALUES (?, 'external_identity', ?, 'player', ?, 'user.signup.kakao.verify', 'success',
           '사이트 회원가입 Kakao 인증', ?, UTC_TIMESTAMP(3))`,
        [operation.insertId, identityId, playerId, JSON.stringify({ accountId: challenge.user_account_id.toString() })]
      );
      await transaction.execute(
        `INSERT INTO outbox_messages
          (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at)
         VALUES (?, 'internal', ?, 'user.signup.completed', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [operation.insertId, playerId.toString(), JSON.stringify({ playerId: playerId.toString(), systemAccountName: challenge.system_account_name })]
      );
      return {
        result: {
          status: "verified" as const,
          playerId: playerId.toString(),
          data: `✅ '${challenge.system_account_name}' 계정의 KakaoTalk 연동과 회원가입이 완료됐습니다.`
        }
      };
    });
    if ("error" in outcome) throw outcome.error;
    return outcome.result;
  }
}
