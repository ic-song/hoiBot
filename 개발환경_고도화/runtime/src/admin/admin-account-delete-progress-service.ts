import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

export type AdminAccountDeleteProgressCommand = { kind: "usage" } | { kind: "delete"; targetNames: string[] };
export type AdminAccountDeleteProgressResult = {
  message: string;
  outboxId: string;
  replayed: boolean;
  resultCode: string;
  deletedPlayerIds: string[];
  failures: Array<{ name: string; code: string }>;
};

export type AccountDeleteOperator = { operator_id: bigint; actor_player_id: bigint | null };
export type AccountDeleteTarget = { player_id: bigint; display_name: string };

const SCOPE = "admin.account_delete_progress";
const COMMAND = "ADMIN_ACCOUNT_DELETE_PROGRESS";

const stableKey = (value: string): string => value.length <= 191
  ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
const hashText = (value: string): string => createHash("sha256").update(value).digest("hex");
const stored = <T>(value: string | T): T => typeof value === "string" ? JSON.parse(value) as T : value;

// /계삭진행의 bare usage와 쉼표 대상 목록만 단일 행에서 허용합니다.
export function parseAdminAccountDeleteProgressCommand(message: string | undefined): AdminAccountDeleteProgressCommand | null {
  if (message === "/계삭진행") return { kind: "usage" };
  if (message === undefined || !/^\/계삭진행\s+\S(?:[^\r\n]*\S)?$/.test(message)) return null;
  const raw = message.replace(/^\/계삭진행\s+/, "");
  const targetNames: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const name = part.trim();
    if (name.length === 0 || seen.has(name)) continue;
    seen.add(name);
    targetNames.push(name);
  }
  return { kind: "delete", targetNames };
}

export function isAdminAccountDeleteProgressCommand(message: string | undefined): boolean {
  return parseAdminAccountDeleteProgressCommand(message) !== null;
}

export function normalizeAdminAccountDeleteProgressDispatchMessage(message: string): string {
  return isAdminAccountDeleteProgressCommand(message) ? "/계삭진행" : message;
}

export async function resolveAccountDeleteOperator(database: DatabaseClient, externalUserId: string): Promise<AccountDeleteOperator | null> {
  const rows = await database.query<AccountDeleteOperator[]>(
    `SELECT operator_row.id operator_id,identity.player_id actor_player_id
       FROM external_identities identity
       JOIN admin_operator_external_identities operator_identity ON operator_identity.external_identity_id=identity.id
       JOIN admin_operators operator_row ON operator_row.id=operator_identity.operator_id AND operator_row.status='active'
      WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
        AND NOT EXISTS (
          SELECT 1 FROM admin_operator_permission_overrides denied
           WHERE denied.operator_id=operator_row.id AND denied.permission_code='account.delete' AND denied.effect='deny'
        )
        AND (
          EXISTS (
            SELECT 1 FROM admin_operator_permission_overrides allowed
             WHERE allowed.operator_id=operator_row.id AND allowed.permission_code='account.delete' AND allowed.effect='allow'
          )
          OR EXISTS (
            SELECT 1 FROM admin_operator_roles operator_role
            JOIN admin_role_permissions role_permission ON role_permission.role_id=operator_role.role_id
             WHERE operator_role.operator_id=operator_row.id AND role_permission.permission_code='account.delete'
          )
        )
      ORDER BY operator_row.id LIMIT 1`, [externalUserId]
  );
  return rows[0] ?? null;
}

async function removeGuildMemberships(tx: DatabaseTransaction, playerId: bigint): Promise<number> {
  const memberships = await tx.query<Array<{ guild_id: bigint; role_code: string }>>(
    "SELECT guild_id,role_code FROM guild_members WHERE player_id=? ORDER BY guild_id FOR UPDATE", [playerId]
  );
  for (const membership of memberships) {
    if (membership.role_code === "master" || membership.role_code === "guild_master") {
      const successor = (await tx.query<Array<{ player_id: bigint }>>(
        `SELECT player_id FROM guild_members
          WHERE guild_id=? AND player_id<>?
          ORDER BY CASE role_code WHEN 'sub_master' THEN 0 WHEN 'officer' THEN 1 ELSE 2 END,
                   joined_at,player_id LIMIT 1 FOR UPDATE`, [membership.guild_id, playerId]
      ))[0];
      if (successor !== undefined) {
        await tx.execute("UPDATE guild_members SET role_code=? WHERE guild_id=? AND player_id=?", [
          membership.role_code, membership.guild_id, successor.player_id
        ]);
      }
    }
    await tx.execute("DELETE FROM guild_members WHERE guild_id=? AND player_id=?", [membership.guild_id, playerId]);
  }
  return memberships.length;
}

export async function logicallyDeletePlayerAccount(
  tx: DatabaseTransaction, operationId: bigint, operatorId: bigint, sequence: number, target: AccountDeleteTarget
): Promise<{ accountId: bigint | null; anonymizedName: string; guildCount: number }> {
  const suffix = hashText(`${operationId}:${target.player_id}:${randomUUID()}`);
  const anonymizedName = `삭제 ${suffix.slice(0, 12)}`;
  const account = (await tx.query<Array<{ id: bigint }>>(
    "SELECT id FROM user_accounts WHERE player_id=? FOR UPDATE", [target.player_id]
  ))[0];
  const guildCount = await removeGuildMemberships(tx, target.player_id);
  if (account !== undefined) {
    await tx.execute("DELETE FROM user_sessions WHERE user_account_id=?", [account.id]);
    await tx.execute("DELETE FROM user_verification_challenges WHERE user_account_id=?", [account.id]);
    await tx.execute(
      `UPDATE user_accounts SET login_id=?,system_account_name=?,password_hash=?,status='deleted',
        player_id=NULL,failed_login_count=0,locked_until=NULL,pending_expires_at=NULL,
        deleted_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE id=?`,
      [`del_${suffix.slice(0, 12)}`, anonymizedName, `deleted:${suffix}`, account.id]
    );
  }
  await tx.execute(
    "DELETE identity_name FROM external_identity_names identity_name JOIN external_identities identity ON identity.id=identity_name.external_identity_id WHERE identity.player_id=?",
    [target.player_id]
  );
  const identities = await tx.query<Array<{ id: bigint; provider_code: string; external_user_id: string }>>(
    "SELECT id,provider_code,external_user_id FROM external_identities WHERE player_id=? ORDER BY id FOR UPDATE", [target.player_id]
  );
  for (const identity of identities) {
    const externalHash = hashText(`${identity.provider_code}:${identity.external_user_id}:${suffix}`).slice(0, 32);
    await tx.execute(
      "UPDATE external_identities SET player_id=NULL,external_user_id=?,display_name=NULL,status='deleted',updated_at=UTC_TIMESTAMP(3) WHERE id=?",
      [`deleted_${identity.provider_code}_${externalHash}`, identity.id]
    );
  }
  await tx.execute(
    "UPDATE player_restrictions SET status='revoked',revoked_by=?,revoked_reason='ACCOUNT_DELETED',revoked_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND status='active' AND revoked_at IS NULL",
    [operatorId, target.player_id]
  );
  await tx.execute(
    "UPDATE player_profiles SET current_display_name=?,terms_agreed=FALSE,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=?",
    [anonymizedName, target.player_id]
  );
  await tx.execute(
    "UPDATE players SET status='deleted',version=version+1,deleted_at=COALESCE(deleted_at,UTC_TIMESTAMP(3)),updated_at=UTC_TIMESTAMP(3) WHERE id=?",
    [target.player_id]
  );
  await tx.execute(
    `INSERT INTO admin_account_deletion_targets
      (operation_id,sequence_no,requested_name,player_id,user_account_id,result_code,anonymized_name,removed_guild_count)
     VALUES (?,?,?,?,?,'deleted',?,?)`,
    [operationId, sequence, target.display_name, target.player_id, account?.id ?? null, anonymizedName, guildCount]
  );
  return { accountId: account?.id ?? null, anonymizedName, guildCount };
}

// 계정 aggregate의 접근 경로를 한 transaction에서 익명화·논리 삭제하고 불변 원장은 보존합니다.
export class AdminAccountDeleteProgressService {
  constructor(private readonly database: DatabaseClient) {}

  // 공용 Iris 관리자 dispatch 반환 계약으로 변환합니다.
  async handleIris(input: { eventId: string; externalUserId: string; channelId: string; message: string }): Promise<{
    status: "changed"; data: string; outboxId: string;
  }> {
    const result = await this.execute({
      eventId: input.eventId, externalUserId: input.externalUserId,
      destinationId: input.channelId, message: input.message
    });
    return { status: "changed", data: result.message, outboxId: result.outboxId };
  }

  async execute(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<AdminAccountDeleteProgressResult> {
    const command = parseAdminAccountDeleteProgressCommand(input.message);
    if (command === null) throw new ApplicationError("ADMIN_ACCOUNT_DELETE_COMMAND_INVALID", "계정 삭제 명령 형식을 확인해 주세요.", 422);
    const operator = await resolveAccountDeleteOperator(this.database, input.externalUserId);
    if (operator === null) throw new ApplicationError("ADMIN_ACCOUNT_DELETE_FORBIDDEN", "계정 삭제 권한이 없습니다.", 403);
    const requested = command.kind === "usage" ? [] : command.targetNames;
    const requestHash = hashText(JSON.stringify({ command: COMMAND, targets: requested }));
    return this.database.withTransaction(async (tx) => {
      await tx.query("SELECT lock_key FROM canonical_account_authority_global_locks WHERE lock_key='ACCOUNT_AUTHORITY' FOR UPDATE");
      const eventKey = stableKey(input.eventId);
      const previous = (await tx.query<Array<{ result_json: string | AdminAccountDeleteProgressResult | null; request_hash: string | null }>>(
        `SELECT operation.result_json,run_row.request_hash FROM operations operation
         LEFT JOIN admin_account_deletion_runs run_row ON run_row.operation_id=operation.id
         WHERE operation.idempotency_scope=? AND operation.idempotency_key=? FOR UPDATE`, [SCOPE, eventKey]
      ))[0];
      if (previous?.result_json != null) {
        if (previous.request_hash !== requestHash) throw new ApplicationError("ADMIN_ACCOUNT_DELETE_EVENT_CONFLICT", "같은 이벤트의 삭제 요청 내용이 다릅니다.", 409);
        return { ...stored<AdminAccountDeleteProgressResult>(previous.result_json), replayed: true };
      }
      const operationId = (await tx.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), SCOPE, eventKey, operator.operator_id]
      )).insertId;
      const failures: Array<{ name: string; code: string }> = [];
      const resolved: AccountDeleteTarget[] = [];
      for (const name of requested) {
        const matches = await tx.query<AccountDeleteTarget[]>(
          `SELECT player.id player_id,profile.current_display_name display_name
             FROM player_profiles profile JOIN players player ON player.id=profile.player_id
            WHERE player.status='active' AND player.deleted_at IS NULL AND BINARY profile.current_display_name=BINARY ?
            ORDER BY player.id LIMIT 2`, [name]
        );
        if (matches.length === 0) failures.push({ name, code: "not_found" });
        else if (matches.length > 1) failures.push({ name, code: "ambiguous" });
        else if (operator.actor_player_id !== null && matches[0]!.player_id === operator.actor_player_id) failures.push({ name, code: "self_forbidden" });
        else resolved.push(matches[0]!);
      }
      const uniqueTargets = Array.from(new Map(resolved.map((target) => [target.player_id.toString(), target])).values())
        .sort((left, right) => left.player_id < right.player_id ? -1 : left.player_id > right.player_id ? 1 : 0);
      for (const target of uniqueTargets) await tx.query("SELECT id FROM players WHERE id=? FOR UPDATE", [target.player_id]);
      const deletedPlayerIds: string[] = [];
      let sequence = 1;
      for (const target of uniqueTargets) {
        await logicallyDeletePlayerAccount(tx, operationId, operator.operator_id, sequence++, target);
        deletedPlayerIds.push(target.player_id.toString());
      }
      for (const failure of failures) {
        await tx.execute(
          "INSERT INTO admin_account_deletion_targets(operation_id,sequence_no,requested_name,result_code) VALUES (?,?,?,?)",
          [operationId, sequence++, failure.name, failure.code]
        );
      }
      const resultCode = command.kind === "usage" ? "usage"
        : deletedPlayerIds.length === 0 ? "no_target_deleted" : failures.length === 0 ? "success" : "partial_success";
      const successNames = uniqueTargets.map((target) => target.display_name);
      const message = command.kind === "usage"
        ? "사용법: /계삭진행 대상명1, 대상명2"
        : [`계정 삭제 처리 결과`, `성공 ${successNames.length}명: ${successNames.length === 0 ? "없음" : successNames.join(", ")}`,
          `실패 ${failures.length}명: ${failures.length === 0 ? "없음" : failures.map((failure) => `${failure.name}(${failure.code})`).join(", ")}`].join("\n");
      const outbox = await tx.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operationId, input.destinationId, JSON.stringify({ data: message })]
      );
      const result: AdminAccountDeleteProgressResult = {
        message, outboxId: outbox.insertId.toString(), replayed: false, resultCode, deletedPlayerIds, failures
      };
      await tx.execute(
        `INSERT INTO admin_account_deletion_runs
          (operation_id,operator_id,request_hash,requested_target_count,deleted_target_count,failed_target_count,result_json)
         VALUES (?,?,?,?,?,?,?)`,
        [operationId, operator.operator_id, requestHash, requested.length, deletedPlayerIds.length, failures.length, JSON.stringify(result)]
      );
      await tx.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [eventKey, COMMAND, operationId, resultCode]
      );
      await tx.execute(
        `INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,change_summary_json,created_at)
         VALUES (?,'admin_operator',?,'player',NULL,'account.delete',?,?,UTC_TIMESTAMP(3))`,
        [operationId, operator.operator_id, resultCode, JSON.stringify({ requestedCount: requested.length, deletedPlayerIds, failures })]
      );
      await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operationId]);
      return result;
    });
  }
}
