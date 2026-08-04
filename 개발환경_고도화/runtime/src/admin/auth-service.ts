import { createHash, randomBytes } from "node:crypto";
import { verify } from "argon2";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

export interface AdminSession {
  sessionId: string;
  operatorId: string;
  loginId: string;
  displayName: string;
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

// 운영자 권한 코드를 역할 매핑에서 조회합니다.
async function readPermissions(database: DatabaseClient, operatorId: string): Promise<string[]> {
  const rows = await database.query<Array<{ code: string }>>(
    `SELECT DISTINCT permission.code
     FROM admin_operator_roles operator_role
     JOIN admin_role_permissions role_permission ON role_permission.role_id = operator_role.role_id
     JOIN admin_permissions permission ON permission.code = role_permission.permission_code
     JOIN admin_roles role ON role.id = operator_role.role_id
     WHERE operator_role.operator_id = ? AND role.active = TRUE
     ORDER BY permission.code`,
    [operatorId]
  );
  return rows.map((row) => row.code);
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
      throw new ApplicationError("INVALID_CREDENTIALS", "로그인 정보를 확인해 주세요.", 401);
    }
    if (Boolean(operator.account_locked)) {
      throw new ApplicationError("ACCOUNT_LOCKED", "로그인 실패 횟수 초과로 계정이 잠겼습니다.", 423);
    }
    if (!await verify(operator.password_hash, password)) {
      await this.database.execute(
        `UPDATE admin_operators SET
          locked_until = IF(failed_login_count + 1 >= 5, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 15 MINUTE), NULL),
          failed_login_count = failed_login_count + 1,
          updated_at = UTC_TIMESTAMP(3) WHERE id = ?`,
        [operator.id]
      );
      throw new ApplicationError("INVALID_CREDENTIALS", "로그인 정보를 확인해 주세요.", 401);
    }

    const sessionToken = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(32).toString("base64url");
    const session = await this.database.withTransaction(async (transaction) => {
      await transaction.execute(
        "UPDATE admin_operators SET failed_login_count = 0, locked_until = NULL, updated_at = UTC_TIMESTAMP(3) WHERE id = ?",
        [operator.id]
      );
      return transaction.execute(
        `INSERT INTO admin_sessions
           (operator_id, token_hash, csrf_secret_hash, last_seen_at, idle_expires_at, absolute_expires_at, created_at)
         VALUES (?, ?, ?, UTC_TIMESTAMP(3), DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 8 HOUR),
           DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 24 HOUR), UTC_TIMESTAMP(3))`,
        [operator.id, hashSecret(sessionToken), hashSecret(csrfToken)]
      );
    });
    return {
      sessionId: session.insertId.toString(),
      operatorId: operator.id.toString(),
      loginId: operator.login_id,
      displayName: operator.display_name,
      permissions: await readPermissions(this.database, operator.id.toString()),
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
    return {
      sessionId: row.session_id.toString(), operatorId: row.operator_id.toString(),
      loginId: row.login_id, displayName: row.display_name,
      permissions: await readPermissions(this.database, row.operator_id.toString())
    };
  }

  async logout(sessionToken: string, csrfToken: string): Promise<void> {
    const session = await this.authenticate(sessionToken, csrfToken);
    await this.database.execute("UPDATE admin_sessions SET revoked_at = UTC_TIMESTAMP(3) WHERE id = ?", [session.sessionId]);
  }
}

// 유스케이스 진입 전에 필요한 관리자 권한을 확인합니다.
export function requirePermission(session: AdminSession, permission: string): void {
  if (!session.permissions.includes(permission)) {
    throw new ApplicationError("FORBIDDEN", "이 작업을 수행할 권한이 없습니다.", 403);
  }
}
