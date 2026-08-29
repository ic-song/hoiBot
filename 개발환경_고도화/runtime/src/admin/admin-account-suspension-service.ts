import { randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { MariaCommandDispatchRepository, type RolloutState } from "../dispatch/command-dispatcher.js";
import { ApplicationError } from "../shared/application-error.js";
import { isAdminDormantAccountCommand, normalizeAdminDormantAccountDispatchMessage } from "./admin-dormant-account-delete-service.js";
import { isAdminDormantRegistryCommand, normalizeAdminDormantRegistryDispatchMessage } from "./admin-dormant-account-registry-service.js";

type AccountSuspensionCommandKind = "activate" | "release" | "list";

export interface ParsedAccountSuspensionCommand {
  kind: AccountSuspensionCommandKind;
  commandCode: "ADMIN_ACCOUNT_SUSPENSION_ACTIVATE" | "ADMIN_ACCOUNT_SUSPENSION_RELEASE" | "ADMIN_ACCOUNT_SUSPENSION_LIST";
  alias: "/계정정지" | "/계정정지해제" | "/계정정지리스트";
  targetName?: string;
}

interface AuthorizedOperator {
  operatorId: string;
  playerId: string | null;
}

interface TargetPlayer {
  playerId: string;
  displayName: string;
}

interface AccountSuspensionResult {
  status: "changed";
  data: string;
  outboxId: string;
  auditId: string;
  operationId: string;
  commandCode: ParsedAccountSuspensionCommand["commandCode"];
  targetPlayerId: string | null;
  changed: boolean;
  affectedRestrictionCount: number;
}

// 계정 정지 세 명령을 정확 일치 또는 단일 줄 대상 인자 형식으로 분리합니다.
export function parseAdminAccountSuspensionCommand(message: string): ParsedAccountSuspensionCommand | undefined {
  if (message === "/계정정지리스트") {
    return { kind: "list", commandCode: "ADMIN_ACCOUNT_SUSPENSION_LIST", alias: "/계정정지리스트" };
  }
  const release = /^\/계정정지해제[ \t]+([^\r\n]+)$/.exec(message);
  if (release !== null && release[1]!.trim() !== "") {
    return { kind: "release", commandCode: "ADMIN_ACCOUNT_SUSPENSION_RELEASE", alias: "/계정정지해제", targetName: release[1]!.trim() };
  }
  const activate = /^\/계정정지[ \t]+([^\r\n]+)$/.exec(message);
  if (activate !== null && activate[1]!.trim() !== "") {
    return { kind: "activate", commandCode: "ADMIN_ACCOUNT_SUSPENSION_ACTIVATE", alias: "/계정정지", targetName: activate[1]!.trim() };
  }
  return undefined;
}

// 계정 정지 후보를 완전한 명령 형식으로 제한해 접미 문구와 유사 명령 충돌을 차단합니다.
export function isAdminAccountSuspensionCommand(message: string | undefined): boolean {
  if (isAdminDormantRegistryCommand(message)) return true;
  if (isAdminDormantAccountCommand(message)) return true;
  if (message === "/계삭진행" || /^\/계삭진행\s+\S(?:[^\r\n]*\S)?$/.test(message ?? "")) return true;
  return message !== undefined && parseAdminAccountSuspensionCommand(message) !== undefined;
}

// 인자형 명령을 DB command_aliases 기본 명령어로 정규화합니다.
export function normalizeAdminAccountSuspensionDispatchMessage(message: string): string {
  if (isAdminDormantRegistryCommand(message)) return normalizeAdminDormantRegistryDispatchMessage(message);
  if (isAdminDormantAccountCommand(message)) return normalizeAdminDormantAccountDispatchMessage(message);
  // ADMIN_ACCOUNT_DELETE_PROGRESS_BRIDGE: 공용 관리자 dispatch 후보를 재사용합니다.
  if (message === "/계삭진행" || /^\/계삭진행\s+\S(?:[^\r\n]*\S)?$/.test(message)) return "/계삭진행";
  return parseAdminAccountSuspensionCommand(message)?.alias ?? message;
}

// 정지 목록을 시작일·경과일과 stable player ID 순서로 표시합니다.
export function formatAdminAccountSuspensionList(rows: Array<{ displayName: string; startedDate: string; elapsedDays: number }>): string {
  if (rows.length === 0) return "📋 계정 정지 목록\n\n정지된 계정이 없습니다.";
  return `📋 계정 정지 목록\n\n${rows.map((row, index) => `${index + 1}. [${row.displayName}] ${row.startedDate} (${row.elapsedDays}일 경과)`).join("\n")}`;
}

// 계정 정지·해제·목록을 stable identity, RBAC, operation, audit, outbox 한 계약으로 처리합니다.
export class AdminAccountSuspensionService {
  constructor(private readonly database: DatabaseClient) {}

  // 공용 Iris 관리자 dispatch 표준 진입점을 계정 정지 aggregate로 위임합니다.
  async handleIris(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<
    AccountSuspensionResult | { status: "shadow" | "legacy_fallback" }
  > {
    return this.handle(input);
  }

  async handle(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<
    AccountSuspensionResult | { status: "shadow" | "legacy_fallback" }
  > {
    const parsed = parseAdminAccountSuspensionCommand(input.message);
    if (parsed === undefined) throw new ApplicationError("INVALID_ACCOUNT_SUSPENSION_COMMAND", "계정 정지 명령 형식이 올바르지 않습니다.", 422);
    const definitions = await this.database.query<Array<{ rollout_state: RolloutState; enabled: number }>>(
      "SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1", [parsed.commandCode]
    );
    const definition = definitions[0];
    const dispatch = new MariaCommandDispatchRepository(this.database);
    if (definition === undefined || definition.enabled !== 1 || definition.rollout_state === "LEGACY_ONLY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "LEGACY_FALLBACK", reasonCode: "ROLLOUT_LEGACY_ONLY", commandCode: parsed.commandCode, handlerKey: "admin_account_suspension" });
      return { status: "legacy_fallback" };
    }
    if (definition.rollout_state === "SHADOW") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "SHADOW", reasonCode: "ROLLOUT_SHADOW", commandCode: parsed.commandCode, handlerKey: "admin_account_suspension" });
      return { status: "shadow" };
    }
    const operator = await this.resolveOperator(input.externalUserId);
    const target = parsed.kind === "list" ? undefined : await this.resolveTarget(parsed.targetName!);
    if (target !== undefined && operator.playerId === target.playerId) {
      throw new ApplicationError("ACCOUNT_SUSPENSION_SELF_FORBIDDEN", "자기 계정은 정지할 수 없습니다.", 409);
    }
    return this.execute({ ...input, parsed, operator, target });
  }

  // 연결된 Kakao identity와 최종 account.restrict 권한을 가진 운영자만 반환합니다.
  private async resolveOperator(externalUserId: string): Promise<AuthorizedOperator> {
    const rows = await this.database.query<Array<{ operator_id: bigint; player_id: bigint | null }>>(
      `SELECT DISTINCT mapping.operator_id,identity.player_id
       FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator ON operator.id=mapping.operator_id
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
         AND operator.status='active'
         AND (
           EXISTS (
             SELECT 1 FROM admin_operator_roles operator_role
             JOIN admin_roles role ON role.id=operator_role.role_id AND role.active=TRUE
             JOIN admin_role_permissions role_permission ON role_permission.role_id=operator_role.role_id
             WHERE operator_role.operator_id=operator.id AND role_permission.permission_code='account.restrict'
           ) OR EXISTS (
             SELECT 1 FROM admin_operator_permission_overrides permission_override
             WHERE permission_override.operator_id=operator.id AND permission_override.permission_code='account.restrict' AND permission_override.effect='allow'
           )
         )
         AND NOT EXISTS (
           SELECT 1 FROM admin_operator_permission_overrides permission_override
           WHERE permission_override.operator_id=operator.id AND permission_override.permission_code='account.restrict' AND permission_override.effect='deny'
         )
       ORDER BY mapping.operator_id LIMIT 2`, [externalUserId]
    );
    if (rows.length === 0) throw new ApplicationError("FORBIDDEN", "계정 정지 관리 권한이 없습니다.", 403);
    if (rows.length > 1) throw new ApplicationError("ADMIN_IDENTITY_AMBIGUOUS", "연결된 운영자 identity가 중복되어 실행할 수 없습니다.", 409);
    return { operatorId: rows[0]!.operator_id.toString(), playerId: rows[0]!.player_id?.toString() ?? null };
  }

  // 현재 표시명으로 삭제되지 않은 stable player ID를 하나만 확정합니다.
  private async resolveTarget(targetName: string): Promise<TargetPlayer> {
    const rows = await this.database.query<Array<{ player_id: bigint; current_display_name: string }>>(
      `SELECT profile.player_id,profile.current_display_name
       FROM player_profiles profile JOIN players player ON player.id=profile.player_id
       WHERE profile.current_display_name=? AND player.deleted_at IS NULL
       ORDER BY profile.player_id LIMIT 2`, [targetName]
    );
    if (rows.length === 0) throw new ApplicationError("PLAYER_NOT_FOUND", `❌ [${targetName}] 님은 존재하지 않습니다.`, 404);
    if (rows.length > 1) throw new ApplicationError("PLAYER_NAME_AMBIGUOUS", "동일 표시명의 회원이 여러 명이므로 player ID 기반 관리가 필요합니다.", 409);
    return { playerId: rows[0]!.player_id.toString(), displayName: rows[0]!.current_display_name };
  }

  // operation lock 아래 도메인 변경, 감사, 실행, outbox를 원자 완료합니다.
  private async execute(input: {
    externalUserId: string; channelId: string; message: string; eventId: string;
    parsed: ParsedAccountSuspensionCommand; operator: AuthorizedOperator; target?: TargetPlayer;
  }): Promise<AccountSuspensionResult> {
    const scope = `admin.account_suspension.${input.parsed.kind}`;
    return this.database.withTransaction(async (transaction) => {
      const operation = await transaction.execute(
        `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
        [randomUUID(), scope, input.eventId, input.operator.operatorId]
      );
      const operationId = operation.insertId;
      const prior = await transaction.query<Array<{ result_json: string | AccountSuspensionResult | null }>>(
        "SELECT result_json FROM operations WHERE id=? FOR UPDATE", [operationId]
      );
      if (prior[0]?.result_json != null) {
        return typeof prior[0].result_json === "string" ? JSON.parse(prior[0].result_json) : prior[0].result_json;
      }

      let data: string;
      let changed = false;
      let affectedRestrictionCount = 0;
      let targetPlayerId: string | null = input.target?.playerId ?? null;
      let actionCode: string;
      if (input.parsed.kind === "list") {
        const rows = await transaction.query<Array<{ player_id: bigint; current_display_name: string; started_date: string; elapsed_days: bigint }>>(
          `SELECT restriction.player_id,profile.current_display_name,
             DATE_FORMAT(DATE_ADD(restriction.starts_at,INTERVAL 9 HOUR),'%Y-%m-%d') AS started_date,
             GREATEST(TIMESTAMPDIFF(DAY,restriction.starts_at,UTC_TIMESTAMP(3)),0) AS elapsed_days
           FROM player_restrictions restriction
           JOIN player_profiles profile ON profile.player_id=restriction.player_id
           JOIN players player ON player.id=restriction.player_id AND player.deleted_at IS NULL
           WHERE restriction.status='active' AND (restriction.ends_at IS NULL OR restriction.ends_at>UTC_TIMESTAMP(3))
           ORDER BY restriction.starts_at,restriction.player_id,restriction.id`
        );
        data = formatAdminAccountSuspensionList(rows.map((row) => ({ displayName: row.current_display_name,
          startedDate: row.started_date, elapsedDays: Number(row.elapsed_days) })));
        affectedRestrictionCount = rows.length;
        actionCode = "admin.account_suspension.list";
      } else {
        const target = input.target!;
        const playerRows = await transaction.query<Array<{ status: string }>>(
          "SELECT status FROM players WHERE id=? AND deleted_at IS NULL FOR UPDATE", [target.playerId]
        );
        if (playerRows[0] === undefined) throw new ApplicationError("PLAYER_NOT_FOUND", `❌ [${target.displayName}] 님은 존재하지 않습니다.`, 404);
        const accountRows = await transaction.query<Array<{ status: string }>>(
          "SELECT status FROM user_accounts WHERE player_id=? AND deleted_at IS NULL FOR UPDATE", [target.playerId]
        );
        const restrictions = await transaction.query<Array<{ id: bigint }>>(
          `SELECT id FROM player_restrictions
           WHERE player_id=? AND status='active' AND (ends_at IS NULL OR ends_at>UTC_TIMESTAMP(3))
           ORDER BY id FOR UPDATE`, [target.playerId]
        );
        if (input.parsed.kind === "activate") {
          if (restrictions.length === 0) {
            await transaction.execute(
              `INSERT INTO player_restrictions(player_id,restriction_type,status,reason,starts_at,created_by,created_at,updated_at)
               VALUES (?,'permanent_suspension','active','Iris 총괄 운영자 /계정정지',UTC_TIMESTAMP(3),?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
              [target.playerId, input.operator.operatorId]
            );
            affectedRestrictionCount = 1;
          }
          await transaction.execute("UPDATE players SET status='suspended',version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND status<>'suspended'", [target.playerId]);
          await transaction.execute("UPDATE user_accounts SET status='suspended',updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND deleted_at IS NULL AND status='active'", [target.playerId]);
          await transaction.execute(
            `UPDATE user_sessions session JOIN user_accounts account_row ON account_row.id=session.user_account_id
             SET session.revoked_at=UTC_TIMESTAMP(3)
             WHERE account_row.player_id=? AND session.revoked_at IS NULL`, [target.playerId]
          );
          changed = restrictions.length === 0 || playerRows[0]!.status !== "suspended" || accountRows.some((row) => row.status === "active");
          data = restrictions.length === 0
            ? `⛔ 계정 정지 완료\n[${target.displayName}] 님의 계정을 정지했습니다.`
            : `ℹ️ [${target.displayName}] 님은 이미 정지 상태입니다.`;
          actionCode = "admin.account_suspension.activate";
        } else {
          if (restrictions.length > 0) {
            const ids = restrictions.map((row) => row.id.toString());
            await transaction.execute(
              `UPDATE player_restrictions SET status='revoked',revoked_by=?,revoked_reason='Iris 총괄 운영자 /계정정지해제',
                 revoked_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3)
               WHERE player_id=? AND status='active' AND (ends_at IS NULL OR ends_at>UTC_TIMESTAMP(3))`,
              [input.operator.operatorId, target.playerId]
            );
            affectedRestrictionCount = ids.length;
          }
          await transaction.execute("UPDATE players SET status='active',version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND status='suspended'", [target.playerId]);
          await transaction.execute("UPDATE user_accounts SET status='active',updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND deleted_at IS NULL AND status='suspended'", [target.playerId]);
          changed = restrictions.length > 0 || playerRows[0]!.status === "suspended" || accountRows.some((row) => row.status === "suspended");
          data = changed
            ? `✅ 계정 정지 해제 완료\n[${target.displayName}] 님의 계정 정지를 해제했습니다.`
            : `ℹ️ [${target.displayName}] 님은 정지 상태가 아닙니다.`;
          actionCode = "admin.account_suspension.release";
        }
      }

      const audit = await transaction.execute(
        `INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES (?,'admin_operator',?,'player',?,?, 'success',?,?,UTC_TIMESTAMP(3))`,
        [operationId, input.operator.operatorId, targetPlayerId, actionCode, `Iris 총괄 운영자 ${input.parsed.alias}`,
          JSON.stringify({ changed, affectedRestrictionCount, targetPlayerId })]
      );
      await transaction.execute(
        `INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)
         VALUES (?,?,?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [input.eventId, input.parsed.commandCode, operationId]
      );
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
         VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [operationId, input.channelId, JSON.stringify({ data })]
      );
      const result: AccountSuspensionResult = { status: "changed", data, outboxId: outbox.insertId.toString(),
        auditId: audit.insertId.toString(), operationId: operationId.toString(), commandCode: input.parsed.commandCode,
        targetPlayerId, changed, affectedRestrictionCount };
      if (input.parsed.kind !== "list") {
        await transaction.execute(
          `INSERT INTO admin_account_suspension_changes(operation_id,player_id,action_code,affected_restriction_count,result_json)
           VALUES (?,?,?,?,?)`,
          [operationId, targetPlayerId, input.parsed.kind, affectedRestrictionCount, JSON.stringify(result)]
        );
      }
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
        [JSON.stringify(result), operationId]);
      return result;
    });
  }
}
