import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { USER_CODE_MINUTES } from "../user-auth/policy.js";
import { AccountPlatformService, deriveIdentityScopeKey, type AccountPlatformCode, type AccountPlatformContextType, type AccountVerificationPurpose, type VerifyGameAccountResult } from "./account-platform-service.js";
import { MariaAccountPlatformRepository } from "./maria-account-platform-repository.js";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_MAX_FAILURES = 5;

interface AccountPlatformChallengeRow {
  id: bigint;
  public_id: string;
  user_account_id: bigint;
  target_player_id: bigint | null;
  expected_display_name: string;
  platform_code: AccountPlatformCode;
  identity_scope_key: string | null;
  context_type: AccountPlatformContextType | null;
  external_context_key: string | null;
  purpose_code: AccountVerificationPurpose;
  code_hash: string;
  failed_attempt_count: number;
  status: string;
  challenge_expired: number;
  consumed_request_key: string | null;
}

export interface AccountPlatformChallengeIssueResult {
  challengeId: string;
  verificationCode: string;
  purpose: AccountVerificationPurpose;
  expiresAt: string;
}

// 8자리 플랫폼 인증 코드를 생성합니다.
function generateCode(): string {
  const bytes = randomBytes(8);
  let code = "";
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return code;
}

// 인증 코드 원문을 저장하지 않도록 pepper HMAC으로 변환합니다.
export function hashAccountPlatformVerificationCode(code: string, pepper: string): string {
  return createHmac("sha256", pepper).update(code.toUpperCase()).digest("hex");
}

// challenge 오류 상태를 commit한 뒤 호출자에게 던질 결과로 감쌉니다.
function failed(error: ApplicationError): { error: ApplicationError } {
  return { error };
}

// 이미 열린 challenge transaction을 하위 repository가 같은 원자 경계로 재사용하게 합니다.
function joinChallengeTransaction(transaction: DatabaseTransaction): DatabaseClient {
  return {
    ping: async () => { await transaction.query("SELECT 1"); },
    verifyRollback: async () => true,
    query: <T>(sql: string, values: readonly unknown[] = []) => transaction.query<T>(sql, values),
    execute: (sql: string, values: readonly unknown[] = []) => transaction.execute(sql, values),
    withTransaction: async <T>(work: (nested: DatabaseTransaction) => Promise<T>) => work(transaction),
    close: async () => undefined
  };
}

// 신규·레거시 challenge 발급과 원자적 플랫폼 인증 소비를 담당합니다.
export class AccountPlatformChallengeService {
  constructor(
    private readonly database: DatabaseClient,
    private readonly pepper: string,
    private readonly now: () => Date = () => new Date()
  ) {
    if (pepper.length < 16) throw new Error("ACCOUNT_PLATFORM_VERIFICATION_PEPPER_TOO_SHORT");
  }

  // 대상 포털·게임계정에 묶고 플랫폼 context는 실제 인증 시점에 확정할 수 있는 일회용 challenge를 발급합니다.
  async issue(input: {
    legacyUserAccountId: string;
    purpose: AccountVerificationPurpose;
    targetPlayerId?: string;
    expectedDisplayName: string;
    platformCode: AccountPlatformCode;
    contextType?: AccountPlatformContextType;
    externalContextKey?: string;
  }, callerTransaction?: DatabaseTransaction): Promise<AccountPlatformChallengeIssueResult> {
    const hasContextType = input.contextType !== undefined;
    const hasContextKey = input.externalContextKey !== undefined;
    if (hasContextType !== hasContextKey) throw new ApplicationError("ACCOUNT_PLATFORM_CHALLENGE_INPUT_INVALID", "인증 context 정보가 올바르지 않습니다.", 422);
    if (input.expectedDisplayName.trim() === "" || input.expectedDisplayName.length > 191
      || (input.externalContextKey !== undefined && (input.externalContextKey.trim() === "" || input.externalContextKey.length > 191))) {
      throw new ApplicationError("ACCOUNT_PLATFORM_CHALLENGE_INPUT_INVALID", "인증 대상 정보가 올바르지 않습니다.", 422);
    }
    const identityScopeKey = hasContextType
      ? deriveIdentityScopeKey({ ...input, contextType: input.contextType!, externalContextKey: input.externalContextKey!, externalUserKey: "challenge-not-bound-to-user" })
      : null;
    if (input.purpose === "LEGACY_GAME_ACCOUNT_LINK" && input.targetPlayerId === undefined) throw new ApplicationError("LEGACY_PLAYER_REQUIRED", "연결할 기존 게임계정을 선택해 주세요.", 422);
    if (input.purpose === "NEW_GAME_ACCOUNT" && input.targetPlayerId !== undefined) throw new ApplicationError("NEW_PLAYER_TARGET_FORBIDDEN", "신규 게임계정 인증에는 기존 player_id를 지정할 수 없습니다.", 422);
    const code = generateCode();
    const publicId = randomUUID();
    const expiresAt = new Date(this.now().getTime() + USER_CODE_MINUTES * 60_000);
    const persist = async (transaction: DatabaseTransaction) => {
      const account = (await transaction.query<Array<{ id: bigint; status: string }>>(
        "SELECT id,status FROM user_accounts WHERE id=? FOR UPDATE", [input.legacyUserAccountId]
      ))[0];
      if (account === undefined || !["pending_kakao_link", "active"].includes(account.status)) throw new ApplicationError("PORTAL_ACCOUNT_UNAVAILABLE", "인증 가능한 포털계정이 아닙니다.", 409);
      if (input.purpose === "LEGACY_GAME_ACCOUNT_LINK") await this.assertLegacyTarget(transaction, input.targetPlayerId!, input.expectedDisplayName);
      await transaction.execute(
        `UPDATE user_verification_challenges SET status='superseded',updated_at=UTC_TIMESTAMP(3)
         WHERE user_account_id=? AND platform_code=? AND context_type <=> ? AND external_context_key <=> ? AND status='pending'`,
        [account.id, input.platformCode, input.contextType ?? null, input.externalContextKey ?? null]
      );
      await transaction.execute(
        `INSERT INTO user_verification_challenges
          (public_id,user_account_id,target_player_id,expected_display_name,provider_code,platform_code,identity_scope_key,context_type,external_context_key,purpose_code,code_hint,code_hash,status,failed_attempt_count,expires_at,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'pending',0,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [publicId, account.id, input.targetPlayerId ?? null, input.expectedDisplayName, input.platformCode.toLowerCase(), input.platformCode, identityScopeKey, input.contextType ?? null, input.externalContextKey ?? null, input.purpose, code.slice(0, 4), hashAccountPlatformVerificationCode(code, this.pepper), expiresAt]
      );
    };
    if (callerTransaction === undefined) await this.database.withTransaction(persist);
    else await persist(callerTransaction);
    return { challengeId: publicId, verificationCode: code, purpose: input.purpose, expiresAt: expiresAt.toISOString() };
  }

  // 코드·만료·context·닉네임을 확인하고 링크와 challenge 소비를 한 transaction으로 완료합니다.
  async verify(input: {
    requestKey: string;
    code: string;
    platformCode: AccountPlatformCode;
    contextType: AccountPlatformContextType;
    externalContextKey: string;
    externalUserKey: string;
    observedDisplayName: string;
    actor: string;
  }): Promise<VerifyGameAccountResult> {
    if (!/^[A-Z2-9]{8}$/i.test(input.code) || input.requestKey.trim() === "" || input.requestKey.length > 191) {
      throw new ApplicationError("VERIFICATION_CODE_INVALID", "인증 코드를 확인해 주세요.", 422);
    }
    const identityScopeKey = deriveIdentityScopeKey(input);
    const outcome = await this.database.withTransaction(async (transaction) => {
      const candidates = await transaction.query<AccountPlatformChallengeRow[]>(
        `SELECT id,public_id,user_account_id,target_player_id,expected_display_name,platform_code,identity_scope_key,context_type,external_context_key,purpose_code,code_hash,failed_attempt_count,status,
          expires_at<=UTC_TIMESTAMP(3) AS challenge_expired,consumed_request_key
         FROM user_verification_challenges WHERE code_hint=? AND platform_code=?
           AND ((context_type IS NULL AND external_context_key IS NULL) OR (context_type=? AND external_context_key=?))
           AND purpose_code IN ('NEW_GAME_ACCOUNT','LEGACY_GAME_ACCOUNT_LINK') ORDER BY created_at DESC FOR UPDATE`,
        [input.code.slice(0, 4).toUpperCase(), input.platformCode, input.contextType, input.externalContextKey]
      );
      const hash = hashAccountPlatformVerificationCode(input.code, this.pepper);
      const challenge = candidates.find((candidate) => candidate.code_hash === hash);
      if (challenge === undefined) {
        if (candidates.length === 1 && candidates[0]?.status === "pending") await this.recordFailure(transaction, candidates[0]);
        return failed(new ApplicationError("VERIFICATION_CODE_INVALID", "인증 코드를 확인해 주세요.", 422));
      }
      if (challenge.status === "verified") {
        if (challenge.consumed_request_key !== input.requestKey) return failed(new ApplicationError("VERIFICATION_CODE_CONSUMED", "이미 사용한 인증 코드입니다.", 409));
      } else if (challenge.status !== "pending") {
        return failed(new ApplicationError("VERIFICATION_CODE_UNAVAILABLE", "사용할 수 없는 인증 코드입니다.", 409));
      }
      if (Boolean(challenge.challenge_expired)) {
        await transaction.execute("UPDATE user_verification_challenges SET status='expired',updated_at=UTC_TIMESTAMP(3) WHERE id=? AND status='pending'", [challenge.id]);
        return failed(new ApplicationError("VERIFICATION_CODE_EXPIRED", "인증 코드가 만료됐습니다. 다시 발급해 주세요.", 409));
      }
      if (challenge.identity_scope_key !== null && challenge.identity_scope_key !== identityScopeKey) {
        return failed(new ApplicationError("VERIFICATION_CONTEXT_MISMATCH", "인증 코드를 발급한 방·서버에서 인증해 주세요.", 409));
      }
      if (challenge.identity_scope_key === null) {
        await transaction.execute(
          `UPDATE user_verification_challenges SET identity_scope_key=?,context_type=?,external_context_key=?,updated_at=UTC_TIMESTAMP(3)
           WHERE id=? AND identity_scope_key IS NULL AND context_type IS NULL AND external_context_key IS NULL`,
          [identityScopeKey, input.contextType, input.externalContextKey, challenge.id]
        );
      }
      const repository = new MariaAccountPlatformRepository(joinChallengeTransaction(transaction));
      const result = await new AccountPlatformService(repository).verifyGameAccount({
        requestKey: input.requestKey, legacyUserAccountId: challenge.user_account_id.toString(), purpose: challenge.purpose_code,
        expectedDisplayName: challenge.expected_display_name, observedDisplayName: input.observedDisplayName,
        ...(challenge.target_player_id === null ? {} : { targetPlayerId: challenge.target_player_id.toString() }),
        platformCode: input.platformCode, contextType: input.contextType, externalContextKey: input.externalContextKey,
        externalUserKey: input.externalUserKey, actor: input.actor
      });
      if (challenge.status === "pending") {
        await transaction.execute(
          `UPDATE user_verification_challenges SET status='verified',verified_platform_identity_id=?,verified_at=UTC_TIMESTAMP(3),consumed_at=UTC_TIMESTAMP(3),consumed_request_key=?,updated_at=UTC_TIMESTAMP(3)
           WHERE id=? AND status='pending'`,
          [result.platformIdentityId, input.requestKey, challenge.id]
        );
      }
      return { result };
    });
    if ("error" in outcome) throw outcome.error;
    return outcome.result;
  }

  // 레거시 player와 기대 닉네임을 잠금 조회로 검증합니다.
  private async assertLegacyTarget(transaction: DatabaseTransaction, playerId: string, expectedDisplayName: string): Promise<void> {
    const row = (await transaction.query<Array<{ status: string; current_display_name: string }>>(
      `SELECT player.status,profile.current_display_name FROM players player JOIN player_profiles profile ON profile.player_id=player.id
       WHERE player.id=? FOR UPDATE`, [playerId]
    ))[0];
    if (row === undefined || row.status !== "active" || row.current_display_name !== expectedDisplayName) throw new ApplicationError("LEGACY_PLAYER_UNAVAILABLE", "닉네임이 일치하는 기존 게임계정을 찾을 수 없습니다.", 409);
  }

  // 잘못된 코드 시도를 누적하고 상한에서 challenge를 실패 처리합니다.
  private async recordFailure(transaction: DatabaseTransaction, challenge: Pick<AccountPlatformChallengeRow, "id" | "failed_attempt_count">): Promise<void> {
    const next = challenge.failed_attempt_count + 1;
    await transaction.execute("UPDATE user_verification_challenges SET failed_attempt_count=?,status=IF(? >= ?,'failed',status),updated_at=UTC_TIMESTAMP(3) WHERE id=?", [next, next, CODE_MAX_FAILURES, challenge.id]);
  }
}
