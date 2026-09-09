import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

export interface GuildSubMasterAssignInput { eventId: string; externalUserId: string; channelId: string; message: string; }
export interface ParsedGuildSubMasterAssign { memberNumbers: number[]; }
export interface GuildSubMasterAssignResult {
  status: "assigned";
  guildId: string;
  selectedPlayerIds: string[];
  selectedNames: string[];
  previousSubMasterPlayerIds: string[];
  memberOrderHash: string;
  previousGuildVersion: string;
  guildVersion: string;
  leadershipVersion: string;
  data: string;
  outboxId: string;
  auditId: string;
}

interface MemberSnapshotRow {
  player_id: bigint;
  display_name: string;
  role_code: string;
  contribution_value: bigint;
  joined_at: string | null;
}

// 부길마 명령 namespace만 공용 dispatch 후보로 판정합니다.
export function isGuildSubMasterAssignCandidate(message: string | undefined): boolean {
  return message === "/부길마" || (message !== undefined && message.startsWith("/부길마 "));
}

// 한 개 또는 두 개의 양의 회원 번호만 부길마 대상으로 허용합니다.
export function parseGuildSubMasterAssign(message: string): ParsedGuildSubMasterAssign {
  if (!isGuildSubMasterAssignCandidate(message)) throw new ApplicationError("INVALID_GUILD_SUB_MASTER_COMMAND", "부길마 명령 형식이 올바르지 않습니다.", 422);
  const matched = /^\/부길마\s+(\d+)(?:\s+(\d+))?$/.exec(message);
  if (matched === null) throw new ApplicationError("GUILD_SUB_MASTER_USAGE", "사용법: /부길마 번호 [번호]", 422);
  const memberNumbers = [Number(matched[1]), matched[2] === undefined ? null : Number(matched[2])].filter((value): value is number => value !== null);
  if (memberNumbers.some((value) => !Number.isSafeInteger(value) || value < 1)) throw new ApplicationError("GUILD_SUB_MASTER_NUMBER_REQUIRED", "회원 번호는 1 이상의 숫자여야 합니다.", 422);
  if (new Set(memberNumbers).size !== memberNumbers.length) throw new ApplicationError("GUILD_SUB_MASTER_DUPLICATE", "같은 회원 번호를 중복 지정할 수 없습니다.", 422);
  return { memberNumbers };
}

// 긴 event ID를 operations 키 길이에 맞게 정규화합니다.
function eventKey(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function stored(value: string | GuildSubMasterAssignResult): GuildSubMasterAssignResult { return typeof value === "string" ? JSON.parse(value) as GuildSubMasterAssignResult : value; }
function normalizedRole(roleCode: string): string { return roleCode.toLowerCase() === "submaster" ? "sub_master" : roleCode.toLowerCase(); }

// 고정 회원 순번과 leadership version을 잠근 뒤 최대 두 부마스터를 원자 교체합니다.
export class GuildSubMasterAssignService {
  constructor(private readonly database: DatabaseClient) {}

  async handleIris(input: GuildSubMasterAssignInput): Promise<{ status: "changed"; data: string; outboxId: string } | { status: "shadow" } | { status: "legacy_fallback" }> {
    parseGuildSubMasterAssign(input.message);
    const rollout = (await this.database.query<Array<{ rollout_state: string; enabled: number }>>("SELECT rollout_state,enabled FROM command_registry WHERE command_code='GUILD_SUB_MASTER_ASSIGN' LIMIT 1"))[0];
    if (rollout === undefined || rollout.enabled !== 1 || rollout.rollout_state === "LEGACY_ONLY") return { status: "legacy_fallback" };
    if (rollout.rollout_state !== "ACTIVE") return { status: "shadow" };
    const result = await this.assign(input);
    return { status: "changed", data: result.data, outboxId: result.outboxId };
  }

  async assign(input: GuildSubMasterAssignInput): Promise<GuildSubMasterAssignResult> {
    const parsed = parseGuildSubMasterAssign(input.message);
    return this.database.withTransaction(async (tx) => {
      const actor = (await tx.query<Array<{ player_id: bigint; can_admin: number }>>(
        `SELECT identity.player_id,
          EXISTS(SELECT 1 FROM admin_operator_external_identities mapping
            JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active'
            JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
            JOIN admin_roles role ON role.id=operator_role.role_id AND role.active=TRUE
            LEFT JOIN admin_role_permissions permission ON permission.role_id=role.id AND permission.permission_code='game.guild.change'
            WHERE mapping.external_identity_id=identity.id AND (role.code='super_admin' OR permission.permission_code IS NOT NULL)) can_admin
         FROM external_identities identity
         WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' AND identity.player_id IS NOT NULL
         LIMIT 1 FOR UPDATE`, [input.externalUserId]))[0];
      if (actor === undefined) throw new ApplicationError("VERIFIED_PLAYER_REQUIRED", "❌ 인증된 유저를 찾을 수 없습니다.", 404);
      const guild = (await tx.query<Array<{ id: bigint; display_name: string; version: bigint; actor_role: string }>>(
        `SELECT guild.id,guild.display_name,guild.version,member.role_code actor_role
         FROM guild_members member JOIN guilds guild ON guild.id=member.guild_id AND guild.status='active'
         WHERE member.player_id=? LIMIT 1 FOR UPDATE`, [actor.player_id]))[0];
      if (guild === undefined) throw new ApplicationError("GUILD_MEMBERSHIP_REQUIRED", "❌ 가입한 길드가 없습니다.", 404);
      const scope = `guild.sub-master:${guild.id}`;
      const key = eventKey(input.eventId);
      const prior = await tx.query<Array<{ actor_id: bigint | null; result_json: string | GuildSubMasterAssignResult | null }>>("SELECT actor_id,result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, key]);
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) {
        if (prior[0].actor_id !== actor.player_id) throw new ApplicationError("GUILD_SUB_MASTER_REPLAY_ACTOR_MISMATCH", "동일 요청의 실행자가 다릅니다.", 409);
        return stored(prior[0].result_json);
      }
      await tx.execute(
        "INSERT IGNORE INTO guild_leadership_state(guild_id,master_player_id,version) SELECT guild_id,player_id,1 FROM guild_members WHERE guild_id=? AND role_code IN ('leader','master') ORDER BY CASE role_code WHEN 'master' THEN 0 ELSE 1 END,player_id LIMIT 1",
        [guild.id]
      );
      const leadership = (await tx.query<Array<{ master_player_id: bigint; version: bigint }>>("SELECT master_player_id,version FROM guild_leadership_state WHERE guild_id=? FOR UPDATE", [guild.id]))[0];
      if (leadership === undefined) throw new ApplicationError("GUILD_MASTER_REQUIRED", "❌ 현재 길드마스터를 확인할 수 없습니다.", 409);
      const actorRole = normalizedRole(guild.actor_role);
      if (actor.can_admin !== 1 && ((actorRole !== "master" && actorRole !== "leader") || leadership.master_player_id !== actor.player_id)) throw new ApplicationError("GUILD_SUB_MASTER_PERMISSION_REQUIRED", "❌ 길드마스터 또는 관리자만 지정할 수 있습니다.", 403);
      const members = await tx.query<MemberSnapshotRow[]>(
        `SELECT member.player_id,profile.current_display_name display_name,member.role_code,
          COALESCE(detail.contribution_value,0) contribution_value,member.joined_at
         FROM guild_members member
         JOIN player_profiles profile ON profile.player_id=member.player_id
         LEFT JOIN guild_member_profile_details detail ON detail.guild_id=member.guild_id AND detail.player_id=member.player_id
         WHERE member.guild_id=?
         ORDER BY CASE member.role_code WHEN 'master' THEN 0 WHEN 'leader' THEN 0 WHEN 'sub_master' THEN 1 WHEN 'submaster' THEN 1 ELSE 2 END,
          COALESCE(detail.contribution_value,0) DESC,COALESCE(member.joined_at,'9999-12-31'),member.player_id
         FOR UPDATE`, [guild.id]);
      const selected = parsed.memberNumbers.map((number) => {
        const member = members[number - 1];
        if (member === undefined) throw new ApplicationError("GUILD_SUB_MASTER_RANGE", `❌ ${number}번 회원은 존재하지 않습니다.`, 422);
        const role = normalizedRole(member.role_code);
        if (role === "master" || role === "leader" || member.player_id === leadership.master_player_id) throw new ApplicationError("GUILD_SUB_MASTER_MASTER_FORBIDDEN", "❌ 길드마스터는 부길마로 지정할 수 없습니다.", 422);
        return member;
      });
      const selectedIds = new Set(selected.map((member) => member.player_id.toString()));
      if (selectedIds.size !== selected.length) throw new ApplicationError("GUILD_SUB_MASTER_DUPLICATE", "같은 회원을 중복 지정할 수 없습니다.", 422);
      const previousSubMasters = members.filter((member) => normalizedRole(member.role_code) === "sub_master");
      const changes = members.flatMap((member) => {
        const previousRole = normalizedRole(member.role_code);
        const nextRole = selectedIds.has(member.player_id.toString()) ? "sub_master" : previousRole === "sub_master" ? "member" : previousRole;
        return previousRole === nextRole && member.role_code === nextRole ? [] : [{ member, previousRole: member.role_code, nextRole }];
      });
      const memberOrderHash = createHash("sha256").update(members.map((member, index) => `${index + 1}:${member.player_id}:${member.role_code}:${member.contribution_value}`).join("|")).digest("hex");
      const operation = await tx.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'player',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), scope, key, actor.player_id]);
      let sequence = 1;
      for (const change of changes) {
        const write = await tx.execute("UPDATE guild_members SET role_code=? WHERE guild_id=? AND player_id=? AND role_code=?", [change.nextRole, guild.id, change.member.player_id, change.previousRole]);
        if (write.affectedRows !== 1n) throw new ApplicationError("GUILD_SUB_MASTER_CONFLICT", "길드 회원 역할이 먼저 변경되었습니다.", 409);
        await tx.execute("INSERT INTO guild_role_history(operation_id,sequence_no,guild_id,player_id,previous_role_code,role_code,change_code) VALUES (?,?,?,?,?,?,?)", [operation.insertId, sequence++, guild.id, change.member.player_id, change.previousRole, change.nextRole, selectedIds.has(change.member.player_id.toString()) ? "SUB_MASTER_ASSIGN" : "SUB_MASTER_RELEASE"]);
      }
      const leadershipWrite = await tx.execute("UPDATE guild_leadership_state SET version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE guild_id=? AND version=?", [guild.id, leadership.version]);
      const guildWrite = await tx.execute("UPDATE guilds SET version=version+1 WHERE id=? AND version=?", [guild.id, guild.version]);
      if (leadershipWrite.affectedRows !== 1n || guildWrite.affectedRows !== 1n) throw new ApplicationError("GUILD_SUB_MASTER_VERSION_CONFLICT", "길드 역할 정보가 먼저 변경되었습니다.", 409);
      const selectedNames = selected.map((member) => member.display_name);
      const data = `✅ [${guild.display_name}] 부길마가 지정되었습니다.\n${selectedNames.join(", ")}`;
      const outbox = await tx.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operation.insertId, input.channelId, JSON.stringify({ data })]);
      await tx.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'GUILD_SUB_MASTER_ASSIGN',?,'completed','assigned',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, operation.insertId]);
      const audit = await tx.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'player',?,'guild',?,'guild.sub_master.assign','assigned','Iris 부길마 지정',?,UTC_TIMESTAMP(3))", [operation.insertId, actor.player_id, guild.id, JSON.stringify({ selectedMemberNumbers: parsed.memberNumbers, selectedPlayerIds: selected.map((member) => member.player_id.toString()), previousSubMasterPlayerIds: previousSubMasters.map((member) => member.player_id.toString()), memberOrderHash, guildVersion: (guild.version + 1n).toString(), leadershipVersion: (leadership.version + 1n).toString() })]);
      const result: GuildSubMasterAssignResult = { status: "assigned", guildId: guild.id.toString(), selectedPlayerIds: selected.map((member) => member.player_id.toString()), selectedNames, previousSubMasterPlayerIds: previousSubMasters.map((member) => member.player_id.toString()), memberOrderHash, previousGuildVersion: guild.version.toString(), guildVersion: (guild.version + 1n).toString(), leadershipVersion: (leadership.version + 1n).toString(), data, outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString() };
      await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}
