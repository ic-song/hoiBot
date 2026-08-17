import { randomUUID } from "node:crypto";
import { argon2id, hash } from "argon2";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

type Actor = { operatorId: string; idempotencyKey: string; reason: string };

function asJson<T>(value: string | T): T {
  return typeof value === "string" ? JSON.parse(value) as T : value;
}

function readDate(value: string | undefined, fieldName: string): Date | undefined {
  if (value === undefined) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new ApplicationError("INVALID_DATETIME", `${fieldName} 날짜가 올바르지 않습니다.`, 422);
  return parsed;
}

export class AdminManagementService {
  constructor(private readonly database: DatabaseClient) {}

  // 관리자 변경을 멱등 operation과 감사 기록으로 한 트랜잭션에 묶습니다.
  private async mutate<T extends Record<string, unknown>>(
    input: Actor & { scope: string; actionCode: string; targetType: string; targetId?: string },
    work: (transaction: DatabaseTransaction) => Promise<T>
  ): Promise<T & { auditId: string }> {
    return this.database.withTransaction(async (transaction) => {
      const previous = await transaction.query<Array<{ result_json: string | (T & { auditId: string }) }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE",
        [input.scope, input.idempotencyKey]
      );
      if (previous[0]?.result_json !== undefined) return asJson(previous[0].result_json);
      const operation = await transaction.execute(
        `INSERT INTO operations
          (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, created_at)
         VALUES (?, ?, ?, 'admin_operator', ?, 'admin_api', 'processing', UTC_TIMESTAMP(3))`,
        [randomUUID(), input.scope, input.idempotencyKey, input.operatorId]
      );
      const result = await work(transaction);
      const audit = await transaction.execute(
        `INSERT INTO command_audit
          (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at)
         VALUES (?, 'admin_operator', ?, ?, ?, ?, 'success', ?, ?, UTC_TIMESTAMP(3))`,
        [operation.insertId, input.operatorId, input.targetType, input.targetId ?? null, input.actionCode, input.reason, JSON.stringify(result)]
      );
      const completed = { ...result, auditId: audit.insertId.toString() };
      await transaction.execute(
        "UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?",
        [JSON.stringify(completed), operation.insertId]
      );
      return completed;
    });
  }

  async overview(): Promise<Record<string, string>> {
    await this.database.execute(
      "UPDATE player_restrictions SET status = 'expired', updated_at = UTC_TIMESTAMP(3) WHERE status = 'active' AND ends_at IS NOT NULL AND ends_at <= UTC_TIMESTAMP(3)"
    );
    const rows = await this.database.query<Array<Record<string, bigint>>>(
      `SELECT
        (SELECT COUNT(*) FROM players WHERE status = 'active') AS activePlayers,
        (SELECT COUNT(*) FROM player_restrictions WHERE status = 'active' AND (ends_at IS NULL OR ends_at > UTC_TIMESTAMP(3))) AS activeRestrictions,
        (SELECT COUNT(*) FROM account_deletion_requests WHERE status = 'grace_period') AS deletionGrace,
        (SELECT COUNT(*) FROM external_identities WHERE status = 'candidate') AS identityCandidates,
        (SELECT COUNT(*) FROM outbox_messages WHERE status IN ('failed', 'dead_letter')) AS outboxFailures,
        (SELECT COUNT(*) FROM admin_operators WHERE status = 'active') AS activeOperators`
    );
    return Object.fromEntries(Object.entries(rows[0] ?? {}).map(([key, value]) => [key, value.toString()]));
  }

  // 관리자 사이트에 표시할 외부 플랫폼 연결 제한 설정을 조회합니다.
  async getExternalPlatformSettings(): Promise<{ maxActiveLinks: number }> {
    const rows = await this.database.query<Array<{ max_active_links: bigint | null }>>(
      `SELECT COALESCE((SELECT value_row.integer_value
        FROM configuration_sets config
        JOIN configuration_values value_row ON value_row.configuration_set_id = config.id
        WHERE config.set_code = 'site.external_platform' AND config.status = 'active'
          AND value_row.config_key = 'max_active_links'
        ORDER BY config.version DESC LIMIT 1), 10) AS max_active_links`
    );
    return { maxActiveLinks: Number(rows[0]?.max_active_links ?? 10n) };
  }

  // 기존 연결은 유지하면서 이후 신규 연결에 적용할 전역 최대 개수를 변경합니다.
  async updateExternalPlatformSettings(input: Actor & { maxActiveLinks: number }): Promise<Record<string, unknown>> {
    if (!Number.isInteger(input.maxActiveLinks) || input.maxActiveLinks < 1 || input.maxActiveLinks > 10) {
      throw new ApplicationError("INVALID_EXTERNAL_LINK_LIMIT", "외부 플랫폼 연결 한도는 1~10개로 설정해 주세요.", 422);
    }
    return this.mutate({
      ...input,
      scope: `settings.external-platform:${input.maxActiveLinks}`,
      actionCode: "settings.external_platform.updated",
      targetType: "configuration_set",
      targetId: "site.external_platform"
    }, async (transaction) => {
      const versions = await transaction.query<Array<{ version: bigint }>>(
        `SELECT version FROM configuration_sets
         WHERE set_code = 'site.external_platform' ORDER BY version DESC LIMIT 1 FOR UPDATE`
      );
      const nextVersion = (versions[0]?.version ?? 0n) + 1n;
      await transaction.execute(
        `UPDATE configuration_sets SET status = 'superseded', effective_to = UTC_TIMESTAMP(3)
         WHERE set_code = 'site.external_platform' AND status = 'active'`
      );
      const created = await transaction.execute(
        `INSERT INTO configuration_sets
          (set_code, version, status, effective_from, approved_by, created_at)
         VALUES ('site.external_platform', ?, 'active', UTC_TIMESTAMP(3), ?, UTC_TIMESTAMP(3))`,
        [nextVersion, input.operatorId]
      );
      await transaction.execute(
        `INSERT INTO configuration_values
          (configuration_set_id, config_key, value_type, integer_value, validation_json)
         VALUES (?, 'max_active_links', 'integer', ?, JSON_OBJECT('minimum', 1, 'maximum', 10))`,
        [created.insertId, input.maxActiveLinks]
      );
      await transaction.execute(
        `INSERT INTO configuration_change_log
          (configuration_set_id, actor_id, action_code, change_json, created_at)
         VALUES (?, ?, 'max_active_links.updated', ?, UTC_TIMESTAMP(3))`,
        [created.insertId, input.operatorId, JSON.stringify({ maxActiveLinks: input.maxActiveLinks })]
      );
      return { maxActiveLinks: input.maxActiveLinks, version: nextVersion.toString() };
    });
  }

  // 관리자 연결관리 화면에 표시할 사이트 계정별 외부 플랫폼 연결을 조회합니다.
  async listExternalPlatformLinks(status: string | undefined, limit: number, offset: number): Promise<{
    items: Array<Record<string, unknown>>;
    total: number;
  }> {
    const allowedStatuses = new Set(["active", "unlinked", "blocked"]);
    if (status !== undefined && !allowedStatuses.has(status)) {
      throw new ApplicationError("INVALID_EXTERNAL_LINK_STATUS", "외부 플랫폼 연결 상태가 올바르지 않습니다.", 422);
    }
    const where = status === undefined ? "" : "WHERE link.status = ?";
    const values = status === undefined ? [] : [status];
    const rows = await this.database.query<Array<{
      id: bigint; user_account_id: bigint; login_id: string; system_account_name: string;
      provider_code: string; external_user_id: string; display_name: string | null; status: string;
      linked_at: Date | string; unlinked_at: Date | string | null; blocked_at: Date | string | null;
    }>>(
      `SELECT link.id, link.user_account_id, account_row.login_id, account_row.system_account_name,
        identity.provider_code, identity.external_user_id, identity.display_name, link.status,
        link.linked_at, link.unlinked_at, link.blocked_at
       FROM user_account_external_identities link
       JOIN user_accounts account_row ON account_row.id = link.user_account_id
       JOIN external_identities identity ON identity.id = link.external_identity_id
       ${where} ORDER BY link.updated_at DESC, link.id DESC LIMIT ? OFFSET ?`,
      [...values, limit, offset]
    );
    const counts = await this.database.query<Array<{ total: bigint }>>(
      `SELECT COUNT(*) AS total FROM user_account_external_identities link ${where}`, values
    );
    return {
      items: rows.map((row) => ({
        id: row.id.toString(), accountId: row.user_account_id.toString(), loginId: row.login_id,
        systemAccountName: row.system_account_name, providerCode: row.provider_code,
        externalUserId: row.external_user_id, displayName: row.display_name, status: row.status,
        linkedAt: new Date(row.linked_at).toISOString(),
        unlinkedAt: row.unlinked_at === null ? null : new Date(row.unlinked_at).toISOString(),
        blockedAt: row.blocked_at === null ? null : new Date(row.blocked_at).toISOString()
      })),
      total: Number(counts[0]?.total ?? 0n)
    };
  }

  // 한 외부 플랫폼 연결의 생성·재연결·해제·차단 이력을 조회합니다.
  async listExternalPlatformLinkHistory(linkId: string): Promise<Array<Record<string, unknown>>> {
    if (!/^\d+$/.test(linkId)) throw new ApplicationError("INVALID_EXTERNAL_LINK_ID", "외부 플랫폼 연결 번호가 올바르지 않습니다.", 422);
    const rows = await this.database.query<Array<{
      id: bigint; action_code: string; actor_type: string; actor_id: bigint | null; reason: string | null; created_at: Date | string;
    }>>(
      `SELECT id, action_code, actor_type, actor_id, reason, created_at
       FROM user_account_external_identity_history WHERE link_id = ? ORDER BY created_at DESC, id DESC`,
      [linkId]
    );
    return rows.map((row) => ({
      id: row.id.toString(), actionCode: row.action_code, actorType: row.actor_type,
      actorId: row.actor_id?.toString() ?? null, reason: row.reason,
      createdAt: new Date(row.created_at).toISOString()
    }));
  }

  // 관리자가 연결을 강제 해제하거나 차단하고 변경 이력과 감사를 함께 남깁니다.
  async changeExternalPlatformLinkStatus(input: Actor & { linkId: string; action: "unlink" | "block" }): Promise<Record<string, unknown>> {
    if (!/^\d+$/.test(input.linkId)) throw new ApplicationError("INVALID_EXTERNAL_LINK_ID", "외부 플랫폼 연결 번호가 올바르지 않습니다.", 422);
    const nextStatus = input.action === "block" ? "blocked" : "unlinked";
    return this.mutate({
      ...input,
      scope: `admin.external-link.${input.action}:${input.linkId}`,
      actionCode: `admin.external_identity.${input.action}`,
      targetType: "user_account_external_identity",
      targetId: input.linkId
    }, async (transaction) => {
      const links = await transaction.query<Array<{
        id: bigint; user_account_id: bigint; external_identity_id: bigint; status: string;
      }>>(
        `SELECT id, user_account_id, external_identity_id, status
         FROM user_account_external_identities WHERE id = ? FOR UPDATE`, [input.linkId]
      );
      const link = links[0];
      if (link === undefined) throw new ApplicationError("EXTERNAL_LINK_NOT_FOUND", "외부 플랫폼 연결을 찾을 수 없습니다.", 404);
      if (link.status === nextStatus) return { linkId: input.linkId, status: nextStatus };
      await transaction.execute(
        `UPDATE user_account_external_identities SET status = ?,
          unlinked_at = IF(? = 'unlinked', UTC_TIMESTAMP(3), NULL),
          blocked_at = IF(? = 'blocked', UTC_TIMESTAMP(3), NULL), updated_at = UTC_TIMESTAMP(3)
         WHERE id = ?`,
        [nextStatus, nextStatus, nextStatus, link.id]
      );
      await transaction.execute(
        `UPDATE external_identities SET player_id = NULL, status = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`,
        [nextStatus === "blocked" ? "blocked" : "candidate", link.external_identity_id]
      );
      await transaction.execute(
        `INSERT INTO user_account_external_identity_history
          (link_id, user_account_id, external_identity_id, action_code, actor_type, actor_id, reason, created_at)
         VALUES (?, ?, ?, ?, 'admin_operator', ?, ?, UTC_TIMESTAMP(3))`,
        [link.id, link.user_account_id, link.external_identity_id, nextStatus, input.operatorId, input.reason]
      );
      return { linkId: input.linkId, status: nextStatus };
    });
  }

  async listOperators(): Promise<Array<Record<string, unknown>>> {
    const rows = await this.database.query<Array<{
      id: bigint; login_id: string; display_name: string; status: string; roles: string | null; created_at: Date;
    }>>(
      `SELECT operator.id, operator.login_id, operator.display_name, operator.status, operator.created_at,
        GROUP_CONCAT(DISTINCT role.code ORDER BY role.code SEPARATOR ',') AS roles
       FROM admin_operators operator
       LEFT JOIN admin_operator_roles operator_role ON operator_role.operator_id = operator.id
       LEFT JOIN admin_roles role ON role.id = operator_role.role_id AND role.active = TRUE
       GROUP BY operator.id ORDER BY operator.id`
    );
    return rows.map((row) => ({ id: row.id.toString(), loginId: row.login_id, displayName: row.display_name,
      status: row.status, roleCodes: row.roles?.split(",") ?? [], createdAt: row.created_at.toISOString() }));
  }

  async getOperator(operatorId: string): Promise<Record<string, unknown>> {
    const operators = await this.listOperators();
    const operator = operators.find((row) => row.id === operatorId);
    if (operator === undefined) throw new ApplicationError("OPERATOR_NOT_FOUND", "운영자를 찾을 수 없습니다.", 404);
    const overrides = await this.database.query<Array<{ permission_code: string; effect: string; reason: string }>>(
      "SELECT permission_code, effect, reason FROM admin_operator_permission_overrides WHERE operator_id = ? ORDER BY permission_code",
      [operatorId]
    );
    return { ...operator, permissionOverrides: overrides.map((row) => ({ permissionCode: row.permission_code, effect: row.effect, reason: row.reason })) };
  }

  async createOperator(input: Actor & { loginId: string; displayName: string; password: string; roleCode: "manager" | "super_admin" }): Promise<Record<string, unknown>> {
    if (!/^[a-z0-9][a-z0-9_-]{5,19}$/.test(input.loginId)) throw new ApplicationError("INVALID_OPERATOR_LOGIN_ID", "운영자 ID는 영문 소문자·숫자 6~20자여야 합니다.", 422);
    if (input.displayName.trim().length < 2 || input.password.length < 12) throw new ApplicationError("INVALID_OPERATOR", "표시명과 12자 이상 비밀번호가 필요합니다.", 422);
    const passwordHash = await hash(input.password, { type: argon2id });
    return this.mutate({ ...input, scope: `operator.create:${input.loginId}`, actionCode: "operator.created", targetType: "admin_operator" }, async (transaction) => {
      const created = await transaction.execute(
        `INSERT INTO admin_operators (login_id, display_name, password_hash, status, created_at, updated_at)
         VALUES (?, ?, ?, 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [input.loginId, input.displayName.trim(), passwordHash]
      );
      const role = await transaction.execute(
        `INSERT INTO admin_operator_roles (operator_id, role_id)
         SELECT ?, id FROM admin_roles WHERE code = ? AND active = TRUE`,
        [created.insertId, input.roleCode]
      );
      if (role.affectedRows !== 1n) throw new ApplicationError("ROLE_NOT_FOUND", "활성 역할을 찾을 수 없습니다.", 422);
      return { operatorId: created.insertId.toString(), roleCode: input.roleCode };
    });
  }

  private async assertNotLastSuperAdmin(transaction: DatabaseTransaction, operatorId: string): Promise<void> {
    const roles = await transaction.query<Array<{ is_super_admin: number }>>(
      `SELECT EXISTS(SELECT 1 FROM admin_operator_roles operator_role JOIN admin_roles role ON role.id = operator_role.role_id
       WHERE operator_role.operator_id = ? AND role.code = 'super_admin') AS is_super_admin`, [operatorId]
    );
    if (!Boolean(roles[0]?.is_super_admin)) return;
    const count = await transaction.query<Array<{ count: bigint }>>(
      `SELECT COUNT(DISTINCT operator.id) AS count FROM admin_operators operator
       JOIN admin_operator_roles operator_role ON operator_role.operator_id = operator.id
       JOIN admin_roles role ON role.id = operator_role.role_id
       WHERE operator.status = 'active' AND role.code = 'super_admin' FOR UPDATE`
    );
    if ((count[0]?.count ?? 0n) <= 1n) throw new ApplicationError("LAST_SUPER_ADMIN", "마지막 활성 최고관리자는 변경할 수 없습니다.", 409);
  }

  async updateOperator(input: Actor & { targetOperatorId: string; displayName?: string; status?: "active" | "suspended" }): Promise<Record<string, unknown>> {
    return this.mutate({ ...input, scope: `operator.update:${input.targetOperatorId}`, actionCode: "operator.updated", targetType: "admin_operator", targetId: input.targetOperatorId }, async (transaction) => {
      if (input.status === "suspended") await this.assertNotLastSuperAdmin(transaction, input.targetOperatorId);
      const result = await transaction.execute(
        `UPDATE admin_operators SET display_name = COALESCE(?, display_name), status = COALESCE(?, status), updated_at = UTC_TIMESTAMP(3)
         WHERE id = ?`, [input.displayName?.trim() ?? null, input.status ?? null, input.targetOperatorId]
      );
      if (result.affectedRows !== 1n) throw new ApplicationError("OPERATOR_NOT_FOUND", "운영자를 찾을 수 없습니다.", 404);
      if (input.status === "suspended") await transaction.execute("UPDATE admin_sessions SET revoked_at = UTC_TIMESTAMP(3) WHERE operator_id = ? AND revoked_at IS NULL", [input.targetOperatorId]);
      return { operatorId: input.targetOperatorId, status: input.status ?? null, displayName: input.displayName?.trim() ?? null };
    });
  }

  async setRole(input: Actor & { targetOperatorId: string; roleCode: "manager" | "super_admin"; remove: boolean }): Promise<Record<string, unknown>> {
    return this.mutate({ ...input, scope: `operator.role:${input.targetOperatorId}:${input.roleCode}:${input.remove}`, actionCode: input.remove ? "operator.role.removed" : "operator.role.assigned", targetType: "admin_operator", targetId: input.targetOperatorId }, async (transaction) => {
      if (input.remove && input.roleCode === "super_admin") await this.assertNotLastSuperAdmin(transaction, input.targetOperatorId);
      if (input.remove) {
        await transaction.execute(
          `DELETE operator_role FROM admin_operator_roles operator_role JOIN admin_roles role ON role.id = operator_role.role_id
           WHERE operator_role.operator_id = ? AND role.code = ?`, [input.targetOperatorId, input.roleCode]
        );
      } else {
        const result = await transaction.execute(
          `INSERT IGNORE INTO admin_operator_roles (operator_id, role_id)
           SELECT ?, id FROM admin_roles WHERE code = ? AND active = TRUE`, [input.targetOperatorId, input.roleCode]
        );
        if (result.affectedRows === 0n) {
          const exists = await transaction.query<Array<{ found: number }>>("SELECT EXISTS(SELECT 1 FROM admin_operators WHERE id = ?) AS found", [input.targetOperatorId]);
          if (!Boolean(exists[0]?.found)) throw new ApplicationError("OPERATOR_NOT_FOUND", "운영자를 찾을 수 없습니다.", 404);
        }
        if (input.roleCode === "super_admin") await transaction.execute("DELETE FROM admin_operator_permission_overrides WHERE operator_id = ?", [input.targetOperatorId]);
      }
      return { operatorId: input.targetOperatorId, roleCode: input.roleCode, assigned: !input.remove };
    });
  }

  async setPermissionOverride(input: Actor & { targetOperatorId: string; permissionCode: string; effect: "allow" | "deny"; remove: boolean }): Promise<Record<string, unknown>> {
    return this.mutate({ ...input, scope: `operator.permission:${input.targetOperatorId}:${input.permissionCode}:${input.remove}`, actionCode: input.remove ? "operator.permission_override.removed" : "operator.permission_override.set", targetType: "admin_operator", targetId: input.targetOperatorId }, async (transaction) => {
      const targetRoles = await transaction.query<Array<{ operator_exists: number; is_super_admin: number }>>(
        `SELECT EXISTS(SELECT 1 FROM admin_operators WHERE id = ?) AS operator_exists,
          EXISTS(SELECT 1 FROM admin_operator_roles operator_role JOIN admin_roles role ON role.id = operator_role.role_id
            WHERE operator_role.operator_id = ? AND role.code = 'super_admin') AS is_super_admin`, [input.targetOperatorId, input.targetOperatorId]
      );
      if (!Boolean(targetRoles[0]?.operator_exists)) throw new ApplicationError("OPERATOR_NOT_FOUND", "운영자를 찾을 수 없습니다.", 404);
      if (Boolean(targetRoles[0]?.is_super_admin)) throw new ApplicationError("SUPER_ADMIN_OVERRIDE_FORBIDDEN", "최고관리자에는 개인 권한 예외를 적용할 수 없습니다.", 409);
      if (input.remove) await transaction.execute("DELETE FROM admin_operator_permission_overrides WHERE operator_id = ? AND permission_code = ?", [input.targetOperatorId, input.permissionCode]);
      else {
        const permission = await transaction.query<Array<{ code: string }>>("SELECT code FROM admin_permissions WHERE code = ?", [input.permissionCode]);
        if (permission[0] === undefined) throw new ApplicationError("PERMISSION_NOT_FOUND", "권한 코드를 찾을 수 없습니다.", 404);
        await transaction.execute(
          `INSERT INTO admin_operator_permission_overrides (operator_id, permission_code, effect, granted_by, reason, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
           ON DUPLICATE KEY UPDATE effect = VALUES(effect), granted_by = VALUES(granted_by), reason = VALUES(reason), updated_at = UTC_TIMESTAMP(3)`,
          [input.targetOperatorId, input.permissionCode, input.effect, input.operatorId, input.reason]
        );
      }
      return { operatorId: input.targetOperatorId, permissionCode: input.permissionCode, effect: input.remove ? null : input.effect };
    });
  }

  async listPasses(playerId: string): Promise<Array<Record<string, unknown>>> {
    const rows = await this.database.query<Array<{ pass_code: string; enabled: number; permanent: number; starts_at: Date | null; ends_at: Date | null }>>(
      `SELECT pass_code, enabled, permanent, starts_at, ends_at FROM player_passes WHERE player_id = ? ORDER BY pass_code`, [playerId]
    );
    return rows.map((row) => ({ passCode: row.pass_code, enabled: Boolean(row.enabled), permanent: Boolean(row.permanent), startsAt: row.starts_at?.toISOString() ?? null, endsAt: row.ends_at?.toISOString() ?? null }));
  }

  async listRestrictions(playerId: string): Promise<Array<Record<string, unknown>>> {
    await this.database.execute(
      "UPDATE player_restrictions SET status = 'expired', updated_at = UTC_TIMESTAMP(3) WHERE player_id = ? AND status = 'active' AND ends_at IS NOT NULL AND ends_at <= UTC_TIMESTAMP(3)",
      [playerId]
    );
    const rows = await this.database.query<Array<{ id: bigint; restriction_type: string; status: string; reason: string; starts_at: Date; ends_at: Date | null }>>(
      "SELECT id, restriction_type, status, reason, starts_at, ends_at FROM player_restrictions WHERE player_id = ? ORDER BY id DESC",
      [playerId]
    );
    return rows.map((row) => ({ id: row.id.toString(), restrictionType: row.restriction_type, status: row.status, reason: row.reason, startsAt: row.starts_at.toISOString(), endsAt: row.ends_at?.toISOString() ?? null }));
  }

  async setPass(input: Actor & { playerId: string; passCode: string; permanent: boolean; startsAt?: string; endsAt?: string; revoke: boolean }): Promise<Record<string, unknown>> {
    if (!/^[a-z][a-z0-9_]{0,127}$/.test(input.passCode)) throw new ApplicationError("INVALID_PASS_CODE", "프리패스 코드가 올바르지 않습니다.", 422);
    if (!input.revoke && !input.permanent && input.endsAt === undefined) throw new ApplicationError("PASS_END_REQUIRED", "기간형 프리패스는 만료일이 필요합니다.", 422);
    const startsAt = readDate(input.startsAt, "startsAt") ?? new Date();
    const endsAt = readDate(input.endsAt, "endsAt");
    return this.mutate({ ...input, scope: `player.pass:${input.playerId}:${input.passCode}`, actionCode: input.revoke ? "player.pass.revoked" : "player.pass.granted", targetType: "player", targetId: input.playerId }, async (transaction) => {
      if (input.revoke) await transaction.execute("UPDATE player_passes SET enabled = FALSE, ends_at = UTC_TIMESTAMP(3) WHERE player_id = ? AND pass_code = ?", [input.playerId, input.passCode]);
      else await transaction.execute(
        `INSERT INTO player_passes (player_id, pass_code, enabled, permanent, starts_at, ends_at)
         VALUES (?, ?, TRUE, ?, ?, ?)
         ON DUPLICATE KEY UPDATE enabled = TRUE, permanent = VALUES(permanent), starts_at = VALUES(starts_at), ends_at = VALUES(ends_at)`,
        [input.playerId, input.passCode, input.permanent, startsAt, input.permanent ? null : endsAt]
      );
      await transaction.execute(
        `INSERT INTO player_pass_admin_history
          (player_id, pass_code, action_code, permanent, starts_at, ends_at, operator_id, reason, idempotency_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [input.playerId, input.passCode, input.revoke ? "revoke" : "grant", input.permanent, startsAt, input.permanent ? null : endsAt ?? null, input.operatorId, input.reason, input.idempotencyKey]
      );
      return { playerId: input.playerId, passCode: input.passCode, enabled: !input.revoke, permanent: input.permanent, startsAt: startsAt.toISOString(), endsAt: input.permanent ? null : endsAt?.toISOString() ?? null };
    });
  }

  async createRestriction(input: Actor & { playerId: string; restrictionType: "temporary_suspension" | "permanent_suspension"; endsAt?: string }): Promise<Record<string, unknown>> {
    if (input.restrictionType === "temporary_suspension" && input.endsAt === undefined) throw new ApplicationError("RESTRICTION_END_REQUIRED", "기간 정지는 종료 시각이 필요합니다.", 422);
    const endsAt = readDate(input.endsAt, "endsAt");
    return this.mutate({ ...input, scope: `player.restriction:${input.playerId}`, actionCode: "player.restriction.created", targetType: "player", targetId: input.playerId }, async (transaction) => {
      const created = await transaction.execute(
        `INSERT INTO player_restrictions (player_id, restriction_type, reason, ends_at, created_by)
         VALUES (?, ?, ?, ?, ?)`, [input.playerId, input.restrictionType, input.reason, endsAt ?? null, input.operatorId]
      );
      await transaction.execute("UPDATE user_accounts SET status = 'suspended', updated_at = UTC_TIMESTAMP(3) WHERE player_id = ?", [input.playerId]);
      await transaction.execute("UPDATE user_sessions session JOIN user_accounts account_row ON account_row.id = session.user_account_id SET session.revoked_at = UTC_TIMESTAMP(3) WHERE account_row.player_id = ? AND session.revoked_at IS NULL", [input.playerId]);
      return { restrictionId: created.insertId.toString(), playerId: input.playerId, restrictionType: input.restrictionType, endsAt: endsAt?.toISOString() ?? null };
    });
  }

  async updateRestriction(input: Actor & { restrictionId: string; status: "revoked" }): Promise<Record<string, unknown>> {
    return this.mutate({ ...input, scope: `restriction.update:${input.restrictionId}`, actionCode: "player.restriction.revoked", targetType: "player_restriction", targetId: input.restrictionId }, async (transaction) => {
      const rows = await transaction.query<Array<{ player_id: bigint }>>("SELECT player_id FROM player_restrictions WHERE id = ? AND status = 'active' FOR UPDATE", [input.restrictionId]);
      const row = rows[0];
      if (row === undefined) throw new ApplicationError("RESTRICTION_NOT_FOUND", "활성 제재를 찾을 수 없습니다.", 404);
      await transaction.execute(
        `UPDATE player_restrictions SET status = 'revoked', revoked_by = ?, revoked_reason = ?, revoked_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3) WHERE id = ?`,
        [input.operatorId, input.reason, input.restrictionId]
      );
      const remaining = await transaction.query<Array<{ count: bigint }>>(
        "SELECT COUNT(*) AS count FROM player_restrictions WHERE player_id = ? AND status = 'active' AND (ends_at IS NULL OR ends_at > UTC_TIMESTAMP(3))", [row.player_id]
      );
      if ((remaining[0]?.count ?? 0n) === 0n) await transaction.execute("UPDATE user_accounts SET status = 'active', updated_at = UTC_TIMESTAMP(3) WHERE player_id = ? AND status = 'suspended'", [row.player_id]);
      return { restrictionId: input.restrictionId, playerId: row.player_id.toString(), status: input.status };
    });
  }

  async listDeletionRequests(): Promise<Array<Record<string, unknown>>> {
    const rows = await this.database.query<Array<{ id: bigint; user_account_id: bigint; player_id: bigint; status: string; requested_at: Date; scheduled_delete_at: Date }>>(
      "SELECT id, user_account_id, player_id, status, requested_at, scheduled_delete_at FROM account_deletion_requests ORDER BY id DESC LIMIT 200"
    );
    return rows.map((row) => ({ id: row.id.toString(), accountId: row.user_account_id.toString(), playerId: row.player_id.toString(), status: row.status, requestedAt: row.requested_at.toISOString(), scheduledDeleteAt: row.scheduled_delete_at.toISOString() }));
  }

  async updateDeletionRequest(input: Actor & { requestId: string; status: "recovered" }): Promise<Record<string, unknown>> {
    return this.mutate({ ...input, scope: `deletion.update:${input.requestId}`, actionCode: "account.deletion.recovered", targetType: "account_deletion_request", targetId: input.requestId }, async (transaction) => {
      const rows = await transaction.query<Array<{ user_account_id: bigint }>>("SELECT user_account_id FROM account_deletion_requests WHERE id = ? AND status = 'grace_period' FOR UPDATE", [input.requestId]);
      const row = rows[0];
      if (row === undefined) throw new ApplicationError("DELETION_REQUEST_NOT_RECOVERABLE", "복구할 수 있는 탈퇴 요청이 아닙니다.", 409);
      await transaction.execute(
        `UPDATE account_deletion_requests SET status = 'recovered', recovered_at = UTC_TIMESTAMP(3), recovered_by_type = 'admin_operator', recovered_by_id = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`,
        [input.operatorId, input.requestId]
      );
      await transaction.execute("UPDATE user_accounts SET status = 'active', updated_at = UTC_TIMESTAMP(3) WHERE id = ?", [row.user_account_id]);
      return { requestId: input.requestId, status: input.status };
    });
  }

  async listCleanupRuns(): Promise<Array<Record<string, unknown>>> {
    const rows = await this.database.query<Array<{ id: bigint; deletion_request_id: bigint; status: string; attempt_no: number; error_code: string | null; started_at: Date; completed_at: Date | null }>>(
      "SELECT id, deletion_request_id, status, attempt_no, error_code, started_at, completed_at FROM account_cleanup_runs ORDER BY id DESC LIMIT 200"
    );
    return rows.map((row) => ({ id: row.id.toString(), deletionRequestId: row.deletion_request_id.toString(), status: row.status, attemptNo: row.attempt_no, errorCode: row.error_code, startedAt: row.started_at.toISOString(), completedAt: row.completed_at?.toISOString() ?? null }));
  }
}
