import { createHash, randomBytes } from "node:crypto";
import { verify } from "argon2";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

export interface AdminSession {
  sessionId: string;
  operatorId: string;
  loginId: string;
  displayName: string;
  roleCodes: string[];
  permissions: string[];
}

export interface LoginResult extends AdminSession {
  sessionToken: string;
  csrfToken: string;
}

interface OperatorRow {
  id: bigint;
  login_id: string;
  display_name: string;
  password_hash: string;
  status: string;
  failed_login_count: number;
  locked_until: Date | string | null;
  account_locked: number;
}

// 세션·CSRF 원문 대신 저장할 SHA-256 값을 생성합니다.
function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// 역할 기본 권한과 개인 allow/deny를 결합한 최종 인가 정보를 조회합니다.
export async function readAuthorization(database: DatabaseClient, operatorId: string): Promise<{ roleCodes: string[]; permissions: string[] }> {
  const [roles, basePermissions, overrides] = await Promise.all([
    database.query<Array<{ code: string }>>(
      `SELECT role.code FROM admin_operator_roles operator_role
       JOIN admin_roles role ON role.id = operator_role.role_id
       WHERE operator_role.operator_id = ? AND role.active = TRUE ORDER BY role.code`,
      [operatorId]
    ),
    database.query<Array<{ code: string }>>(
    `SELECT DISTINCT permission.code
     FROM admin_operator_roles operator_role
     JOIN admin_role_permissions role_permission ON role_permission.role_id = operator_role.role_id
     JOIN admin_permissions permission ON permission.code = role_permission.permission_code
     JOIN admin_roles role ON role.id = operator_role.role_id
     WHERE operator_role.operator_id = ? AND role.active = TRUE
     ORDER BY permission.code`,
    [operatorId]
    ),
    database.query<Array<{ permission_code: string; effect: "allow" | "deny" }>>(
      `SELECT permission_code, effect FROM admin_operator_permission_overrides
       WHERE operator_id = ? ORDER BY permission_code`,
      [operatorId]
    )
  ]);
  const permissions = new Set(basePermissions.map((row) => row.code));
  for (const override of overrides) {
    if (override.effect === "deny") permissions.delete(override.permission_code);
    else permissions.add(override.permission_code);
  }
  return { roleCodes: roles.map((row) => row.code), permissions: [...permissions].sort() };
}

export class AdminAuthService {
  constructor(private readonly database: DatabaseClient) {}

  async login(loginId: string, password: string): Promise<LoginResult> {
    const operators = await this.database.query<OperatorRow[]>(
      `SELECT id, login_id, display_name, password_hash, status, failed_login_count, locked_until,
        locked_until IS NOT NULL AND locked_until > UTC_TIMESTAMP(3) AS account_locked
       FROM admin_operators WHERE login_id = ?`,
      [loginId]
    );
    const operator = operators[0];
    if (operator === undefined || operator.status !== "active") {
      await this.database.execute(
        `INSERT INTO admin_auth_events (operator_id, login_id, event_code, result_code)
         VALUES (?, ?, 'session.created', 'invalid_credentials')`,
        [operator?.id ?? null, loginId]
      );
      throw new ApplicationError("INVALID_CREDENTIALS", "로그인 정보를 확인해 주세요.", 401);
    }
    if (Boolean(operator.account_locked)) {
      await this.database.execute(
        `INSERT INTO admin_auth_events (operator_id, login_id, event_code, result_code)
         VALUES (?, ?, 'session.created', 'account_locked')`,
        [operator.id, operator.login_id]
      );
      throw new ApplicationError("ACCOUNT_LOCKED", "로그인 실패 횟수 초과로 계정이 잠겼습니다.", 423);
    }
    if (!await verify(operator.password_hash, password)) {
      await this.database.withTransaction(async (transaction) => {
        await transaction.execute(
          `UPDATE admin_operators SET
            locked_until = IF(failed_login_count + 1 >= 5, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 15 MINUTE), NULL),
            failed_login_count = failed_login_count + 1,
            updated_at = UTC_TIMESTAMP(3) WHERE id = ?`,
          [operator.id]
        );
        await transaction.execute(
          `INSERT INTO admin_auth_events (operator_id, login_id, event_code, result_code)
           VALUES (?, ?, 'session.created', 'invalid_credentials')`,
          [operator.id, operator.login_id]
        );
      });
      throw new ApplicationError("INVALID_CREDENTIALS", "로그인 정보를 확인해 주세요.", 401);
    }

    const sessionToken = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(32).toString("base64url");
    const session = await this.database.withTransaction(async (transaction) => {
      await transaction.execute(
        "UPDATE admin_operators SET failed_login_count = 0, locked_until = NULL, updated_at = UTC_TIMESTAMP(3) WHERE id = ?",
        [operator.id]
      );
      const created = await transaction.execute(
        `INSERT INTO admin_sessions
           (operator_id, token_hash, csrf_secret_hash, last_seen_at, idle_expires_at, absolute_expires_at, created_at)
         VALUES (?, ?, ?, UTC_TIMESTAMP(3), DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 8 HOUR),
           DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 24 HOUR), UTC_TIMESTAMP(3))`,
        [operator.id, hashSecret(sessionToken), hashSecret(csrfToken)]
      );
      await transaction.execute(
        `INSERT INTO admin_auth_events (operator_id, login_id, event_code, result_code, session_id)
         VALUES (?, ?, 'session.created', 'success', ?)`,
        [operator.id, operator.login_id, created.insertId]
      );
      return created;
    });
    const authorization = await readAuthorization(this.database, operator.id.toString());
    return {
      sessionId: session.insertId.toString(),
      operatorId: operator.id.toString(),
      loginId: operator.login_id,
      displayName: operator.display_name,
      ...authorization,
      sessionToken,
      csrfToken
    };
  }

  async authenticate(sessionToken: string, csrfToken?: string): Promise<AdminSession> {
    if (sessionToken === "") {
      throw new ApplicationError("ADMIN_AUTH_REQUIRED", "관리자 로그인이 필요합니다.", 401);
    }
    const rows = await this.database.query<Array<{
      session_id: bigint; operator_id: bigint; login_id: string; display_name: string; csrf_secret_hash: string;
    }>>(
      `SELECT session.id AS session_id, operator.id AS operator_id, operator.login_id,
        operator.display_name, session.csrf_secret_hash
       FROM admin_sessions session JOIN admin_operators operator ON operator.id = session.operator_id
       WHERE session.token_hash = ? AND session.revoked_at IS NULL AND operator.status = 'active'
         AND session.idle_expires_at > UTC_TIMESTAMP(3) AND session.absolute_expires_at > UTC_TIMESTAMP(3)`,
      [hashSecret(sessionToken)]
    );
    const row = rows[0];
    if (row === undefined) {
      throw new ApplicationError("ADMIN_SESSION_INVALID", "관리자 세션이 만료됐습니다.", 401);
    }
    if (csrfToken !== undefined && hashSecret(csrfToken) !== row.csrf_secret_hash) {
      throw new ApplicationError("CSRF_TOKEN_INVALID", "CSRF 토큰이 올바르지 않습니다.", 403);
    }
    await this.database.execute(
      `UPDATE admin_sessions SET last_seen_at = UTC_TIMESTAMP(3),
       idle_expires_at = LEAST(DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 8 HOUR), absolute_expires_at)
       WHERE id = ?`,
      [row.session_id]
    );
    const authorization = await readAuthorization(this.database, row.operator_id.toString());
    return {
      sessionId: row.session_id.toString(), operatorId: row.operator_id.toString(),
      loginId: row.login_id, displayName: row.display_name,
      ...authorization
    };
  }

  async logout(sessionToken: string, csrfToken: string): Promise<void> {
    const session = await this.authenticate(sessionToken, csrfToken);
    await this.database.withTransaction(async (transaction) => {
      await transaction.execute("UPDATE admin_sessions SET revoked_at = UTC_TIMESTAMP(3) WHERE id = ?", [session.sessionId]);
      await transaction.execute(
        `INSERT INTO admin_auth_events (operator_id, login_id, event_code, result_code, session_id)
         VALUES (?, ?, 'session.revoked', 'success', ?)`,
        [session.operatorId, session.loginId, session.sessionId]
      );
    });
  }
}

// 유스케이스 진입 전에 필요한 관리자 권한을 확인합니다.
export function requirePermission(session: AdminSession, permission: string): void {
  if (!session.permissions.includes(permission)) {
    throw new ApplicationError("FORBIDDEN", "이 작업을 수행할 권한이 없습니다.", 403);
  }
}
