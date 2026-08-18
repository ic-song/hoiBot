import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { argon2id, hash, verify } from "argon2";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import {
  USER_CODE_MINUTES,
  USER_LOGIN_LOCK_MINUTES,
  USER_LOGIN_MAX_FAILURES,
  USER_PENDING_HOURS,
  USER_TERMS_VERSION,
  validateLoginId,
  validateUserAccountName,
  validateUserPassword
} from "./policy.js";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export interface SignupResult {
  accountId: string;
  status: "pending_kakao_link";
  systemAccountName: string;
  challengeId: string;
  verificationCode: string;
  codeExpiresAt: string;
  pendingExpiresAt: string;
}

export interface UserSessionResult {
  accountId: string;
  loginId: string;
  systemAccountName: string;
  playerId: string;
  sessionToken: string;
  csrfToken: string;
}

interface AccountRow {
  id: bigint;
  player_id: bigint | null;
  login_id: string;
  password_hash: string;
  system_account_name: string;
  status: string;
  account_type?: string;
  scheduled_delete_at?: Date | string | null;
  pending_expired?: number;
  failed_login_count?: number;
  locked_until?: Date | string | null;
  account_locked?: number;
}

// 세션과 CSRF 원문 대신 저장할 SHA-256 hash를 생성합니다.
function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// 사람이 옮겨 적기 쉬운 8자리 인증 코드를 생성합니다.
function generateVerificationCode(): string {
  const bytes = randomBytes(8);
  let code = "";
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return code;
}

// DB 유출 시 짧은 인증 코드 원문을 복원하기 어렵도록 pepper HMAC을 생성합니다.
export function hashVerificationCode(code: string, pepper: string): string {
  return createHmac("sha256", pepper).update(code.toUpperCase()).digest("hex");
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null
    && (("errno" in error && error.errno === 1062) || ("code" in error && error.code === "ER_DUP_ENTRY"));
}

// 만료된 동일 로그인 ID·이름의 미인증 계정과 종속 임시 데이터를 제거합니다.
async function cleanupExpiredPendingAccounts(
  transaction: DatabaseTransaction,
  loginId: string,
  systemAccountName: string
): Promise<void> {
  const rows = await transaction.query<Array<{ id: bigint }>>(
    `SELECT id FROM user_accounts
     WHERE status = 'pending_kakao_link' AND pending_expires_at <= UTC_TIMESTAMP(3)
       AND (login_id = ? OR system_account_name = ?) FOR UPDATE`,
    [loginId, systemAccountName]
  );
  for (const row of rows) {
    await transaction.execute("DELETE FROM user_verification_challenges WHERE user_account_id = ?", [row.id]);
    await transaction.execute("DELETE FROM user_terms_acceptances WHERE user_account_id = ?", [row.id]);
    await transaction.execute("DELETE FROM user_sessions WHERE user_account_id = ?", [row.id]);
    await transaction.execute("DELETE FROM user_accounts WHERE id = ?", [row.id]);
  }
}

// 기존 challenge를 만료시키고 새 KakaoTalk 인증 코드를 생성합니다.
async function createChallenge(
  transaction: DatabaseTransaction,
  accountId: bigint,
  pepper: string
): Promise<{ publicId: string; code: string; expiresAt: Date }> {
  await transaction.execute(
    `UPDATE user_verification_challenges SET status = 'superseded', updated_at = UTC_TIMESTAMP(3)
     WHERE user_account_id = ? AND provider_code = 'kakao' AND purpose_code = 'initial_link' AND status = 'pending'`,
    [accountId]
  );
  const code = generateVerificationCode();
  const publicId = randomUUID();
  const expiresAt = new Date(Date.now() + USER_CODE_MINUTES * 60_000);
  await transaction.execute(
    `INSERT INTO user_verification_challenges
      (public_id, user_account_id, provider_code, purpose_code, code_hint, code_hash, status,
       failed_attempt_count, expires_at, created_at, updated_at)
     VALUES (?, ?, 'kakao', 'initial_link', ?, ?, 'pending', 0, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [publicId, accountId, code.slice(0, 4), hashVerificationCode(code, pepper), expiresAt]
  );
  return { publicId, code, expiresAt };
}

export class UserAuthService {
  constructor(private readonly database: DatabaseClient, private readonly verificationPepper: string, private readonly nodeEnv = "development") {}

  // 잘못된 비밀번호 시도를 누적하고 임계치 도달 시 계정을 일시 잠급니다.
  private async recordFailedCredentialAttempt(accountId: bigint): Promise<void> {
    await this.database.execute(
      `UPDATE user_accounts SET failed_login_count = failed_login_count + 1,
        locked_until = IF(failed_login_count + 1 >= ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MINUTE), locked_until),
        updated_at = UTC_TIMESTAMP(3) WHERE id = ?`,
      [USER_LOGIN_MAX_FAILURES, USER_LOGIN_LOCK_MINUTES, accountId]
    );
  }

  // 자격 증명 확인 성공 시 이전 로그인 실패와 잠금 상태를 초기화합니다.
  private async clearCredentialFailures(accountId: bigint): Promise<void> {
    await this.database.execute(
      "UPDATE user_accounts SET failed_login_count = 0, locked_until = NULL, updated_at = UTC_TIMESTAMP(3) WHERE id = ? AND (failed_login_count > 0 OR locked_until IS NOT NULL)",
      [accountId]
    );
  }

  // 사이트 약관 동의와 이름 검사를 거쳐 KakaoTalk 인증 대기 계정을 생성합니다.
  async signup(input: {
    loginId: string;
    password: string;
    systemAccountName: string;
    acceptTerms: boolean;
  }): Promise<SignupResult> {
    const loginId = validateLoginId(input.loginId);
    const password = validateUserPassword(input.password);
    const name = validateUserAccountName(input.systemAccountName);
    if (!input.acceptTerms) {
      throw new ApplicationError("REQUIRED_CONSENT_MISSING", "이용약관에 동의해 주세요.", 422);
    }
    const passwordHash = await hash(password, { type: argon2id });
    try {
      return await this.database.withTransaction(async (transaction) => {
        await cleanupExpiredPendingAccounts(transaction, loginId, name.displayName);
        const existing = await transaction.query<Array<{ id: bigint }>>(
          `SELECT id FROM user_accounts WHERE login_id = ? OR system_account_name = ?
           UNION ALL SELECT player_id AS id FROM player_profiles WHERE current_display_name = ? LIMIT 1`,
          [loginId, name.displayName, name.displayName]
        );
        if (existing[0] !== undefined) {
          throw new ApplicationError("ACCOUNT_ALREADY_EXISTS", "이미 사용 중이거나 가입을 진행 중인 계정 정보입니다.", 409);
        }
        const account = await transaction.execute(
          `INSERT INTO user_accounts
            (login_id, password_hash, system_account_name, gender_code, status, pending_expires_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'pending_kakao_link', DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 24 HOUR), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          [loginId, passwordHash, name.displayName, name.genderCode]
        );
        await transaction.execute(
          `INSERT INTO user_terms_acceptances (user_account_id, terms_type, terms_version, accepted_at)
           VALUES (?, 'terms_of_service', ?, UTC_TIMESTAMP(3))`,
          [account.insertId, USER_TERMS_VERSION]
        );
        const challenge = await createChallenge(transaction, account.insertId, this.verificationPepper);
        return {
          accountId: account.insertId.toString(), status: "pending_kakao_link",
          systemAccountName: name.displayName, challengeId: challenge.publicId,
          verificationCode: challenge.code, codeExpiresAt: challenge.expiresAt.toISOString(),
          pendingExpiresAt: new Date(Date.now() + USER_PENDING_HOURS * 3_600_000).toISOString()
        };
      });
    } catch (error) {
      if (error instanceof ApplicationError || !isDuplicateKeyError(error)) throw error;
      throw new ApplicationError("ACCOUNT_ALREADY_EXISTS", "이미 사용 중이거나 가입을 진행 중인 계정 정보입니다.", 409);
    }
  }

  // 미인증 사용자의 자격 증명을 확인하고 KakaoTalk 인증 코드를 재발급합니다.
  async reissueSignupCode(loginIdValue: string, passwordValue: string): Promise<SignupResult> {
    const loginId = validateLoginId(loginIdValue);
    validateUserPassword(passwordValue);
    const rows = await this.database.query<AccountRow[]>(
      `SELECT id, player_id, login_id, password_hash, system_account_name, status,
        pending_expires_at <= UTC_TIMESTAMP(3) AS pending_expired,
        locked_until IS NOT NULL AND locked_until > UTC_TIMESTAMP(3) AS account_locked
       FROM user_accounts WHERE login_id = ?`,
      [loginId]
    );
    const account = rows[0];
    if (account === undefined) {
      throw new ApplicationError("INVALID_CREDENTIALS", "로그인 정보를 확인해 주세요.", 401);
    }
    if (Boolean(account.account_locked)) {
      throw new ApplicationError("ACCOUNT_TEMPORARILY_LOCKED", "로그인 시도가 반복되어 계정이 잠겼습니다. 15분 후 다시 시도해 주세요.", 423);
    }
    if (!await verify(account.password_hash, passwordValue)) {
      await this.recordFailedCredentialAttempt(account.id);
      throw new ApplicationError("INVALID_CREDENTIALS", "로그인 정보를 확인해 주세요.", 401);
    }
    await this.clearCredentialFailures(account.id);
    if (account.status !== "pending_kakao_link" || Boolean(account.pending_expired)) {
      throw new ApplicationError("SIGNUP_NOT_PENDING", "KakaoTalk 인증을 재발급할 수 없는 계정입니다.", 409);
    }
    return this.database.withTransaction(async (transaction) => {
      const challenge = await createChallenge(transaction, account.id, this.verificationPepper);
      return {
        accountId: account.id.toString(), status: "pending_kakao_link",
        systemAccountName: account.system_account_name, challengeId: challenge.publicId,
        verificationCode: challenge.code, codeExpiresAt: challenge.expiresAt.toISOString(),
        pendingExpiresAt: new Date(Date.now() + USER_PENDING_HOURS * 3_600_000).toISOString()
      };
    });
  }

  // 공개 challenge ID로 민감정보 없이 인증 진행 상태를 조회합니다.
  async readSignupStatus(publicId: string): Promise<{ status: string; verifiedAt: string | null }> {
    const rows = await this.database.query<Array<{ status: string; verified_at: Date | string | null }>>(
      `SELECT CASE WHEN status = 'pending' AND expires_at <= UTC_TIMESTAMP(3) THEN 'expired' ELSE status END AS status,
        verified_at FROM user_verification_challenges WHERE public_id = ?`,
      [publicId]
    );
    const row = rows[0];
    if (row === undefined) throw new ApplicationError("VERIFICATION_NOT_FOUND", "인증 요청을 찾을 수 없습니다.", 404);
    return { status: row.status, verifiedAt: row.verified_at === null ? null : new Date(row.verified_at).toISOString() };
  }

  // 활성 사용자 자격 증명을 확인하고 24시간 idle·7일 absolute 세션을 생성합니다.
  async login(loginIdValue: string, passwordValue: string): Promise<UserSessionResult> {
    const loginId = validateLoginId(loginIdValue);
    validateUserPassword(passwordValue);
    const rows = await this.database.query<AccountRow[]>(
      `SELECT account_row.id, account_row.player_id, account_row.login_id, account_row.password_hash,
        account_row.system_account_name, account_row.status, account_row.account_type,
        account_row.locked_until IS NOT NULL AND account_row.locked_until > UTC_TIMESTAMP(3) AS account_locked,
        deletion.scheduled_delete_at
       FROM user_accounts account_row
       LEFT JOIN account_deletion_requests deletion ON deletion.user_account_id = account_row.id AND deletion.status = 'grace_period'
       WHERE account_row.login_id = ?`,
      [loginId]
    );
    const account = rows[0];
    if (account === undefined) {
      throw new ApplicationError("INVALID_CREDENTIALS", "로그인 정보를 확인해 주세요.", 401);
    }
    if (Boolean(account.account_locked)) {
      throw new ApplicationError("ACCOUNT_TEMPORARILY_LOCKED", "로그인 시도가 반복되어 계정이 잠겼습니다. 15분 후 다시 시도해 주세요.", 423);
    }
    if (!await verify(account.password_hash, passwordValue)) {
      await this.recordFailedCredentialAttempt(account.id);
      throw new ApplicationError("INVALID_CREDENTIALS", "로그인 정보를 확인해 주세요.", 401);
    }
    await this.clearCredentialFailures(account.id);
    if (this.nodeEnv === "production" && account.account_type === "test") {
      throw new ApplicationError("TEST_ACCOUNT_FORBIDDEN", "테스트계정은 운영 환경에서 사용할 수 없습니다.", 403);
    }
    if (account.status === "suspended" && account.player_id !== null) {
      await this.database.withTransaction(async (transaction) => {
        await transaction.execute(
          "UPDATE player_restrictions SET status = 'expired', updated_at = UTC_TIMESTAMP(3) WHERE player_id = ? AND status = 'active' AND ends_at IS NOT NULL AND ends_at <= UTC_TIMESTAMP(3)",
          [account.player_id]
        );
        const active = await transaction.query<Array<{ count: bigint }>>(
          "SELECT COUNT(*) AS count FROM player_restrictions WHERE player_id = ? AND status = 'active' AND (ends_at IS NULL OR ends_at > UTC_TIMESTAMP(3))",
          [account.player_id]
        );
        if ((active[0]?.count ?? 0n) === 0n) {
          await transaction.execute("UPDATE user_accounts SET status = 'active', updated_at = UTC_TIMESTAMP(3) WHERE id = ? AND status = 'suspended'", [account.id]);
          account.status = "active";
        }
      });
    }
    if (account.status === "pending_kakao_link") {
      throw new ApplicationError("KAKAO_LINK_REQUIRED", "KakaoTalk 인증을 완료해 주세요.", 409);
    }
    if (account.status === "deletion_grace") {
      const scheduled = account.scheduled_delete_at === null || account.scheduled_delete_at === undefined ? "" : new Date(account.scheduled_delete_at).toISOString();
      throw new ApplicationError("ACCOUNT_DELETION_GRACE", `${scheduled}까지 탈퇴 유예 중입니다. 사이트에서 복구할 수 있습니다.`, 409);
    }
    if (account.status !== "active" || account.player_id === null) {
      throw new ApplicationError("ACCOUNT_UNAVAILABLE", "현재 사용할 수 없는 계정입니다.", 403);
    }
    const sessionToken = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(32).toString("base64url");
    await this.database.execute(
      `INSERT INTO user_sessions
        (user_account_id, token_hash, csrf_secret_hash, last_seen_at, idle_expires_at, absolute_expires_at, created_at)
       VALUES (?, ?, ?, UTC_TIMESTAMP(3), DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 24 HOUR),
         DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 7 DAY), UTC_TIMESTAMP(3))`,
      [account.id, hashSecret(sessionToken), hashSecret(csrfToken)]
    );
    return {
      accountId: account.id.toString(), loginId: account.login_id,
      systemAccountName: account.system_account_name, playerId: account.player_id.toString(),
      sessionToken, csrfToken
    };
  }

  // 현재 사용자 세션과 선택적 CSRF token을 검증합니다.
  async authenticate(sessionToken: string, csrfToken?: string): Promise<Omit<UserSessionResult, "sessionToken" | "csrfToken"> & { sessionId: string }> {
    const rows = await this.database.query<Array<{
      session_id: bigint; account_id: bigint; player_id: bigint; login_id: string;
      system_account_name: string; csrf_secret_hash: string;
    }>>(
      `SELECT session.id AS session_id, account_row.id AS account_id, account_row.player_id,
        account_row.login_id, account_row.system_account_name, session.csrf_secret_hash
       FROM user_sessions session JOIN user_accounts account_row ON account_row.id = session.user_account_id
       WHERE session.token_hash = ? AND session.revoked_at IS NULL AND account_row.status = 'active'
         AND session.idle_expires_at > UTC_TIMESTAMP(3) AND session.absolute_expires_at > UTC_TIMESTAMP(3)`,
      [hashSecret(sessionToken)]
    );
    const row = rows[0];
    if (row === undefined) throw new ApplicationError("USER_SESSION_INVALID", "로그인 세션이 만료됐습니다.", 401);
    if (csrfToken !== undefined && hashSecret(csrfToken) !== row.csrf_secret_hash) {
      throw new ApplicationError("CSRF_TOKEN_INVALID", "CSRF 토큰이 올바르지 않습니다.", 403);
    }
    await this.database.execute(
      `UPDATE user_sessions SET last_seen_at = UTC_TIMESTAMP(3),
       idle_expires_at = LEAST(DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 24 HOUR), absolute_expires_at) WHERE id = ?`,
      [row.session_id]
    );
    return {
      sessionId: row.session_id.toString(), accountId: row.account_id.toString(),
      playerId: row.player_id.toString(), loginId: row.login_id, systemAccountName: row.system_account_name
    };
  }

  // 새 브라우저 로드에서도 안전하게 로그아웃할 수 있도록 현재 세션의 CSRF secret을 교체합니다.
  async refreshSession(sessionToken: string): Promise<{
    session: Omit<UserSessionResult, "sessionToken" | "csrfToken"> & { sessionId: string };
    csrfToken: string;
  }> {
    const session = await this.authenticate(sessionToken);
    const csrfToken = randomBytes(32).toString("base64url");
    await this.database.execute(
      "UPDATE user_sessions SET csrf_secret_hash = ? WHERE id = ? AND revoked_at IS NULL",
      [hashSecret(csrfToken), session.sessionId]
    );
    return { session, csrfToken };
  }

  // 일반 로그아웃 시 현재 세션만 폐기합니다.
  async logout(sessionToken: string, csrfToken: string): Promise<void> {
    const session = await this.authenticate(sessionToken, csrfToken);
    await this.database.execute("UPDATE user_sessions SET revoked_at = UTC_TIMESTAMP(3) WHERE id = ?", [session.sessionId]);
  }

  // 로그인된 사용자의 계정을 30일 탈퇴 유예 상태로 전환합니다.
  async requestDeletion(sessionToken: string, csrfToken: string): Promise<{ requestId: string; scheduledDeleteAt: string }> {
    const session = await this.authenticate(sessionToken, csrfToken);
    return this.database.withTransaction(async (transaction) => {
      const existing = await transaction.query<Array<{ id: bigint; scheduled_delete_at: Date }>>(
        "SELECT id, scheduled_delete_at FROM account_deletion_requests WHERE user_account_id = ? AND status = 'grace_period' FOR UPDATE",
        [session.accountId]
      );
      if (existing[0] !== undefined) return { requestId: existing[0].id.toString(), scheduledDeleteAt: existing[0].scheduled_delete_at.toISOString() };
      const scheduledDeleteAt = new Date(Date.now() + 30 * 86_400_000);
      const created = await transaction.execute(
        `INSERT INTO account_deletion_requests (user_account_id, player_id, status, scheduled_delete_at)
         VALUES (?, ?, 'grace_period', ?)`, [session.accountId, session.playerId, scheduledDeleteAt]
      );
      await transaction.execute("UPDATE user_accounts SET status = 'deletion_grace', updated_at = UTC_TIMESTAMP(3) WHERE id = ?", [session.accountId]);
      await transaction.execute("UPDATE user_sessions SET revoked_at = UTC_TIMESTAMP(3) WHERE user_account_id = ? AND revoked_at IS NULL", [session.accountId]);
      return { requestId: created.insertId.toString(), scheduledDeleteAt: scheduledDeleteAt.toISOString() };
    });
  }

  // 유예 중 계정의 자격 증명을 다시 확인하고 탈퇴 요청을 철회합니다.
  async recoverDeletion(loginIdValue: string, passwordValue: string): Promise<{ requestId: string; status: "recovered" }> {
    const loginId = validateLoginId(loginIdValue); validateUserPassword(passwordValue);
    const rows = await this.database.query<Array<{ id: bigint; password_hash: string; status: string; request_id: bigint }>>(
      `SELECT account_row.id, account_row.password_hash, account_row.status, deletion.id AS request_id
       FROM user_accounts account_row JOIN account_deletion_requests deletion ON deletion.user_account_id = account_row.id
       WHERE account_row.login_id = ? AND deletion.status = 'grace_period'`, [loginId]
    );
    const row = rows[0];
    if (row === undefined || !await verify(row.password_hash, passwordValue)) throw new ApplicationError("INVALID_CREDENTIALS", "로그인 정보를 확인해 주세요.", 401);
    if (row.status !== "deletion_grace") throw new ApplicationError("DELETION_REQUEST_NOT_RECOVERABLE", "복구할 수 있는 탈퇴 요청이 아닙니다.", 409);
    await this.database.withTransaction(async (transaction) => {
      await transaction.execute(
        `UPDATE account_deletion_requests SET status = 'recovered', recovered_at = UTC_TIMESTAMP(3),
          recovered_by_type = 'user_account', recovered_by_id = ?, updated_at = UTC_TIMESTAMP(3)
         WHERE id = ? AND status = 'grace_period'`, [row.id, row.request_id]
      );
      await transaction.execute("UPDATE user_accounts SET status = 'active', updated_at = UTC_TIMESTAMP(3) WHERE id = ?", [row.id]);
    });
    return { requestId: row.request_id.toString(), status: "recovered" };
  }
}
