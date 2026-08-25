import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const MASTER_ROLE = "super_admin";
const LIST_PERMISSION = "admin.master.roster.read";
const REVOKE_PERMISSION = "admin.master.roster.revoke";

export interface AdminMasterRosterCommand {
  externalUserId: string;
  channelId: string;
  message: string;
  eventId: string;
}

export interface AdminMasterRosterResult {
  status: "listed" | "revoked";
  commandKind: "list" | "remove";
  targetPlayerId?: string;
  targetOperatorId?: string;
  targetName?: string;
  roleCode: string;
  operatorDisabled?: boolean;
  masterCount?: number;
  outboxId: string;
  auditId: string;
  data: string;
  replayed?: boolean;
}

// 정확한 마스터 명단 조회 명령만 실행 대상으로 인정합니다.
export function isAdminMasterRosterListCommand(message: string | undefined): boolean {
  return message === "/마스터명단";
}

// 쉼표 뒤 대상명이 완전하게 포함된 마스터 제거 명령만 실행 대상으로 인정합니다.
export function isAdminMasterRosterRemoveCommand(message: string | undefined): boolean {
  return message !== undefined && /^\/마스터제거,\s*\S(?:.*\S)?$/.test(message);
}

// 마스터 명단 조회 또는 제거 명령인지 확인합니다.
export function isAdminMasterRosterCommand(message: string | undefined): boolean {
  return isAdminMasterRosterListCommand(message) || isAdminMasterRosterRemoveCommand(message);
}

// 마스터 제거 대상명을 정규화해 해석합니다.
function parseTargetName(message: string): string {
  const matched = /^\/마스터제거,\s*(\S(?:.*\S)?)$/.exec(message);
  if (matched === null) {
    throw new ApplicationError("INVALID_ADMIN_MASTER_REMOVE_COMMAND", "정확한 /마스터제거, [아이디]를 입력해주세요.", 422);
  }
  return matched[1]!;
}

// 긴 event ID를 operations 멱등키 길이에 맞게 정규화합니다.
function normalizeEventKey(eventId: string): string {
  return eventId.length <= 191 ? eventId : `sha256:${createHash("sha256").update(eventId).digest("hex")}`;
}

// MariaDB JSON 결과를 재시도 응답으로 복원합니다.
function parseStoredResult(value: string | AdminMasterRosterResult): AdminMasterRosterResult {
  const result = typeof value === "string" ? JSON.parse(value) as AdminMasterRosterResult : value;
  return { ...result, replayed: true };
}

// 연결된 Kakao 운영자의 마스터 권한을 확인합니다.
async function authorize(
  transaction: DatabaseTransaction,
  externalUserId: string,
  permissionCode: string
): Promise<bigint> {
  const actors = await transaction.query<Array<{ operator_id: bigint }>>(
    `SELECT mapping.operator_id
       FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator ON operator.id=mapping.operator_id
       JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
       JOIN admin_role_permissions permission ON permission.role_id=operator_role.role_id
      WHERE identity.provider_code='kakao'
        AND identity.external_user_id=?
        AND identity.status='linked'
        AND operator.status='active'
        AND permission.permission_code=?
      LIMIT 1 FOR UPDATE`,
    [externalUserId, permissionCode]
  );
  const actor = actors[0];
  if (actor === undefined) {
    throw new ApplicationError("FORBIDDEN", "마스터 명단 관리 권한이 없습니다.", 403);
  }
  return actor.operator_id;
}

// 마스터 명단 조회·제거 결과를 outbox와 감사 로그에 저장합니다.
async function persistResult(
  transaction: DatabaseTransaction,
  command: AdminMasterRosterCommand,
  actorOperatorId: bigint,
  operationId: bigint,
  commandCode: string,
  actionCode: string,
  targetId: bigint,
  result: Omit<AdminMasterRosterResult, "outboxId" | "auditId">
): Promise<AdminMasterRosterResult> {
  const outbox = await transaction.execute(
    `INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
     VALUES(?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
    [operationId, command.channelId, JSON.stringify({ data: result.data })]
  );
  await transaction.execute(
    `INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)
     VALUES(?, ?, ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [command.eventId, commandCode, operationId]
  );
  const audit = await transaction.execute(
    `INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
     VALUES(?,'admin_operator',?,'admin_operator',?,?,'success',?, ?, UTC_TIMESTAMP(3))`,
    [operationId, actorOperatorId, targetId, actionCode, `Iris ${command.message}`, JSON.stringify(result)]
  );
  const completed: AdminMasterRosterResult = {
    ...result,
    outboxId: outbox.insertId.toString(),
    auditId: audit.insertId.toString()
  };
  await transaction.execute(
    "UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
    [JSON.stringify(completed), operationId]
  );
  return completed;
}

// 마스터 명단 조회와 super_admin 역할 회수를 트랜잭션으로 처리합니다.
export class AdminMasterRosterService {
  constructor(private readonly database: DatabaseClient) {}

  async execute(command: AdminMasterRosterCommand): Promise<AdminMasterRosterResult> {
    const commandKind = isAdminMasterRosterListCommand(command.message) ? "list" : "remove";
    const targetName = commandKind === "remove" ? parseTargetName(command.message) : undefined;
    const permissionCode = commandKind === "list" ? LIST_PERMISSION : REVOKE_PERMISSION;

    return this.database.withTransaction(async transaction => {
      const actorOperatorId = await authorize(transaction, command.externalUserId, permissionCode);
      const scope = `admin.master-roster:${commandKind}:${actorOperatorId}`;
      const eventKey = normalizeEventKey(command.eventId);
      const prior = await transaction.query<Array<{ result_json: string | AdminMasterRosterResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",
        [scope, eventKey]
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) {
        const replay = parseStoredResult(prior[0].result_json);
        if (replay.commandKind !== commandKind || (commandKind === "remove" && replay.targetName !== targetName)) {
          throw new ApplicationError("ADMIN_MASTER_ROSTER_REPLAY_MISMATCH", "같은 이벤트의 마스터 명령 내용이 이전 요청과 다릅니다.", 409);
        }
        return replay;
      }

      const operation = await transaction.execute(
        `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES(?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, eventKey, actorOperatorId]
      );

      if (commandKind === "list") {
        const masters = await transaction.query<Array<{ operator_id: bigint; display_name: string }>>(
          `SELECT operator.id operator_id, operator.display_name
             FROM admin_operators operator
             JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
             JOIN admin_roles role ON role.id=operator_role.role_id
            WHERE operator.status='active' AND role.code=? AND role.active=TRUE
            ORDER BY operator.id`,
          [MASTER_ROLE]
        );
        const lines = masters.map((master, index) => `${index + 1}. ${master.display_name}`);
        const data = lines.length === 0 ? "📋 등록된 마스터가 없습니다." : `📋 마스터 명단\n\n${lines.join("\n")}`;
        return persistResult(transaction, command, actorOperatorId, operation.insertId, "admin_master_roster_list",
          LIST_PERMISSION, actorOperatorId, {
            status: "listed", commandKind, roleCode: MASTER_ROLE, masterCount: masters.length, data
          });
      }

      const targets = await transaction.query<Array<{ player_id: bigint; external_identity_id: bigint }>>(
        `SELECT profile.player_id, identity.id external_identity_id
           FROM player_profiles profile
           JOIN external_identities identity ON identity.player_id=profile.player_id
          WHERE profile.current_display_name=?
            AND identity.provider_code='kakao'
            AND identity.status='linked'
          ORDER BY profile.player_id,identity.id LIMIT 3 FOR UPDATE`,
        [targetName]
      );
      if (targets.length === 0) {
        throw new ApplicationError("MASTER_TARGET_NOT_FOUND", `❌ [${targetName}] 회원 또는 연결된 Kakao identity를 찾을 수 없습니다.`, 404);
      }
      if (targets.length > 1) {
        throw new ApplicationError("MASTER_TARGET_AMBIGUOUS", "동일 회원명 또는 Kakao identity가 여러 개라 마스터 제거를 중단했습니다.", 409);
      }
      const target = targets[0]!;
      const roles = await transaction.query<Array<{ id: bigint }>>(
        "SELECT id FROM admin_roles WHERE code=? AND active=TRUE FOR UPDATE",
        [MASTER_ROLE]
      );
      const role = roles[0];
      if (role === undefined) {
        throw new ApplicationError("MASTER_ROLE_REQUIRED", "super_admin 역할 설정을 찾을 수 없습니다.", 409);
      }
      const mappings = await transaction.query<Array<{ operator_id: bigint }>>(
        "SELECT operator_id FROM admin_operator_external_identities WHERE external_identity_id=? FOR UPDATE",
        [target.external_identity_id]
      );
      const mapping = mappings[0];
      if (mapping === undefined) {
        throw new ApplicationError("MASTER_ROLE_NOT_ASSIGNED", `[${targetName}] 님은 마스터가 아닙니다.`, 409);
      }
      const assigned = await transaction.query<Array<{ operator_id: bigint }>>(
        "SELECT operator_id FROM admin_operator_roles WHERE operator_id=? AND role_id=? FOR UPDATE",
        [mapping.operator_id, role.id]
      );
      if (assigned[0] === undefined) {
        throw new ApplicationError("MASTER_ROLE_NOT_ASSIGNED", `[${targetName}] 님은 마스터가 아닙니다.`, 409);
      }

      await transaction.execute(
        "DELETE FROM admin_operator_roles WHERE operator_id=? AND role_id=?",
        [mapping.operator_id, role.id]
      );
      const remaining = await transaction.query<Array<{ role_count: bigint }>>(
        "SELECT COUNT(*) role_count FROM admin_operator_roles WHERE operator_id=? FOR UPDATE",
        [mapping.operator_id]
      );
      const operatorDisabled = (remaining[0]?.role_count ?? 0n) === 0n;
      if (operatorDisabled) {
        await transaction.execute(
          "UPDATE admin_operators SET status='inactive',updated_at=UTC_TIMESTAMP(3) WHERE id=?",
          [mapping.operator_id]
        );
        await transaction.execute(
          "UPDATE admin_sessions SET revoked_at=COALESCE(revoked_at,UTC_TIMESTAMP(3)) WHERE operator_id=?",
          [mapping.operator_id]
        );
      }
      await transaction.execute(
        `INSERT INTO admin_role_assignment_history(operation_id,actor_operator_id,target_operator_id,target_player_id,external_identity_id,role_id,action_code)
         VALUES(?,?,?,?,?,?,'revoked')`,
        [operation.insertId, actorOperatorId, mapping.operator_id, target.player_id, target.external_identity_id, role.id]
      );
      const data = `✅ [${targetName}] 님을 마스터 명단에서 제거했습니다.`;
      return persistResult(transaction, command, actorOperatorId, operation.insertId, "admin_master_roster_remove",
        REVOKE_PERMISSION, mapping.operator_id, {
          status: "revoked", commandKind, targetPlayerId: target.player_id.toString(),
          targetOperatorId: mapping.operator_id.toString(), targetName, roleCode: MASTER_ROLE, operatorDisabled, data
        });
    });
  }
}
