import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

export interface GuildLeadershipTransferInput { eventId: string; externalUserId: string; channelId: string; message: string; }
export interface ParsedGuildLeadershipTransfer { guildName: string; targetName: string; }
export interface GuildLeadershipTransferResult { status: "transferred"; guildId: string; previousMasterPlayerId: string; masterPlayerId: string; previousGuildVersion: string; guildVersion: string; leadershipVersion: string; data: string; outboxId: string; auditId: string; }

// 길드위임 명령 namespace만 공용 dispatch 후보로 판정합니다.
export function isGuildLeadershipTransferCandidate(message: string | undefined): boolean {
  return message === "/길드위임" || (message !== undefined && message.startsWith("/길드위임 "));
}

// 길드명과 대상명을 쉼표로 분리해 완전한 위임 입력만 허용합니다.
export function parseGuildLeadershipTransfer(message: string): ParsedGuildLeadershipTransfer {
  if (!isGuildLeadershipTransferCandidate(message)) throw new ApplicationError("INVALID_GUILD_TRANSFER_COMMAND", "길드위임 명령 형식이 올바르지 않습니다.", 422);
  const body = message.slice("/길드위임".length).trim();
  const parts = body.split(",");
  if (parts.length !== 2) throw new ApplicationError("GUILD_TRANSFER_USAGE", "사용법: /길드위임 길드명, 대상명", 422);
  const guildName = parts[0]!.trim(), targetName = parts[1]!.trim();
  if (guildName === "" || targetName === "") throw new ApplicationError("GUILD_TRANSFER_USAGE", "사용법: /길드위임 길드명, 대상명", 422);
  return { guildName, targetName };
}

// 긴 event ID를 operations 키 길이에 맞게 정규화합니다.
function eventKey(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function stored(value: string | GuildLeadershipTransferResult): GuildLeadershipTransferResult { return typeof value === "string" ? JSON.parse(value) as GuildLeadershipTransferResult : value; }

// 길드 마스터 1명 불변과 양쪽 역할 이력을 한 transaction으로 전환합니다.
export class GuildLeadershipTransferService {
  constructor(private readonly database: DatabaseClient) {}

  async handleIris(input: GuildLeadershipTransferInput): Promise<{ status: "changed"; data: string; outboxId: string } | { status: "shadow" } | { status: "legacy_fallback" }> {
    parseGuildLeadershipTransfer(input.message);
    const rollout = (await this.database.query<Array<{ rollout_state: string; enabled: number }>>("SELECT rollout_state,enabled FROM command_registry WHERE command_code='GUILD_LEADERSHIP_TRANSFER' LIMIT 1"))[0];
    if (rollout === undefined || rollout.enabled !== 1 || rollout.rollout_state === "LEGACY_ONLY") return { status: "legacy_fallback" };
    if (rollout.rollout_state !== "ACTIVE") return { status: "shadow" };
    const result = await this.transfer(input);
    return { status: "changed", data: result.data, outboxId: result.outboxId };
  }

  async transfer(input: GuildLeadershipTransferInput): Promise<GuildLeadershipTransferResult> {
    const parsed = parseGuildLeadershipTransfer(input.message);
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
      const guild = (await tx.query<Array<{ id: bigint; display_name: string; version: bigint }>>("SELECT id,display_name,version FROM guilds WHERE display_name=? AND status='active' LIMIT 1 FOR UPDATE", [parsed.guildName]))[0];
      if (guild === undefined) throw new ApplicationError("GUILD_NOT_FOUND", "❌ 존재하지 않는 길드입니다.", 404);
      const scope = `guild.leadership:${guild.id}`;
      const key = eventKey(input.eventId);
      const prior = await tx.query<Array<{ actor_id: bigint | null; result_json: string | GuildLeadershipTransferResult | null }>>("SELECT actor_id,result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, key]);
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) {
        if (prior[0].actor_id !== actor.player_id) throw new ApplicationError("GUILD_TRANSFER_REPLAY_ACTOR_MISMATCH", "동일 요청의 실행자가 다릅니다.", 409);
        return stored(prior[0].result_json);
      }
      const actorMembership = (await tx.query<Array<{ role_code: string }>>("SELECT role_code FROM guild_members WHERE guild_id=? AND player_id=? FOR UPDATE", [guild.id, actor.player_id]))[0];
      const actorRole = actorMembership?.role_code.toLowerCase() ?? "";
      if (actor.can_admin !== 1 && actorRole !== "leader" && actorRole !== "master") throw new ApplicationError("GUILD_TRANSFER_PERMISSION_REQUIRED", "❌ 길드장 또는 관리자만 위임할 수 있습니다.", 403);
      const target = (await tx.query<Array<{ player_id: bigint; display_name: string; role_code: string }>>(
        `SELECT member.player_id,profile.current_display_name display_name,member.role_code
         FROM guild_members member JOIN player_profiles profile ON profile.player_id=member.player_id
         WHERE member.guild_id=? AND profile.current_display_name=? LIMIT 1 FOR UPDATE`, [guild.id, parsed.targetName]))[0];
      if (target === undefined) throw new ApplicationError("GUILD_TRANSFER_TARGET_REQUIRED", "❌ 해당 길드의 대상 회원을 찾을 수 없습니다.", 404);
      await tx.execute(
        "INSERT IGNORE INTO guild_leadership_state(guild_id,master_player_id,version) SELECT guild_id,player_id,1 FROM guild_members WHERE guild_id=? AND role_code IN ('leader','master') ORDER BY CASE role_code WHEN 'master' THEN 0 ELSE 1 END,player_id LIMIT 1",
        [guild.id]
      );
      const leadership = (await tx.query<Array<{ master_player_id: bigint; version: bigint }>>("SELECT master_player_id,version FROM guild_leadership_state WHERE guild_id=? FOR UPDATE", [guild.id]))[0];
      if (leadership === undefined) throw new ApplicationError("GUILD_MASTER_REQUIRED", "❌ 현재 길드마스터를 확인할 수 없습니다.", 409);
      const previousMaster = (await tx.query<Array<{ player_id: bigint; display_name: string; role_code: string }>>(
        `SELECT member.player_id,profile.current_display_name display_name,member.role_code FROM guild_members member JOIN player_profiles profile ON profile.player_id=member.player_id WHERE member.guild_id=? AND member.player_id=? FOR UPDATE`, [guild.id, leadership.master_player_id]))[0];
      if (previousMaster === undefined) throw new ApplicationError("GUILD_MASTER_MEMBERSHIP_REQUIRED", "❌ 길드마스터 회원 정보가 일치하지 않습니다.", 409);
      if (target.player_id === previousMaster.player_id) throw new ApplicationError("GUILD_TRANSFER_ALREADY_MASTER", "❌ 대상은 이미 길드마스터입니다.", 409);
      const operation = await tx.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'player',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), scope, key, actor.player_id]);
      const oldWrite = await tx.execute("UPDATE guild_members SET role_code='member' WHERE guild_id=? AND player_id=? AND role_code IN ('leader','master')", [guild.id, previousMaster.player_id]);
      const newWrite = await tx.execute("UPDATE guild_members SET role_code='master' WHERE guild_id=? AND player_id=? AND role_code=?", [guild.id, target.player_id, target.role_code]);
      if (oldWrite.affectedRows !== 1n || newWrite.affectedRows !== 1n) throw new ApplicationError("GUILD_TRANSFER_CONFLICT", "길드 회원 역할이 먼저 변경되었습니다.", 409);
      const leadershipWrite = await tx.execute("UPDATE guild_leadership_state SET master_player_id=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE guild_id=? AND version=?", [target.player_id, guild.id, leadership.version]);
      const guildWrite = await tx.execute("UPDATE guilds SET version=version+1 WHERE id=? AND version=?", [guild.id, guild.version]);
      if (leadershipWrite.affectedRows !== 1n || guildWrite.affectedRows !== 1n) throw new ApplicationError("GUILD_TRANSFER_VERSION_CONFLICT", "길드 정보가 먼저 변경되었습니다.", 409);
      await tx.execute("INSERT INTO guild_role_history(operation_id,sequence_no,guild_id,player_id,previous_role_code,role_code,change_code) VALUES (?,1,?,?,?,'member','LEADERSHIP_TRANSFER_OUT'),(?,2,?,?,?,'master','LEADERSHIP_TRANSFER_IN')", [operation.insertId, guild.id, previousMaster.player_id, previousMaster.role_code, operation.insertId, guild.id, target.player_id, target.role_code]);
      const data = `✅ [${guild.display_name}] 길드마스터가 위임되었습니다.\n${previousMaster.display_name} → ${target.display_name}`;
      const outbox = await tx.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operation.insertId, input.channelId, JSON.stringify({ data })]);
      await tx.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'GUILD_LEADERSHIP_TRANSFER',?,'completed','transferred',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, operation.insertId]);
      const audit = await tx.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'player',?,'guild',?,'guild.leadership.transfer','transferred','Iris 길드위임',?,UTC_TIMESTAMP(3))", [operation.insertId, actor.player_id, guild.id, JSON.stringify({ previousMasterPlayerId: previousMaster.player_id.toString(), masterPlayerId: target.player_id.toString(), previousMasterRole: previousMaster.role_code, targetPreviousRole: target.role_code, guildVersion: (guild.version + 1n).toString(), leadershipVersion: (leadership.version + 1n).toString() })]);
      const result: GuildLeadershipTransferResult = { status: "transferred", guildId: guild.id.toString(), previousMasterPlayerId: previousMaster.player_id.toString(), masterPlayerId: target.player_id.toString(), previousGuildVersion: guild.version.toString(), guildVersion: (guild.version + 1n).toString(), leadershipVersion: (leadership.version + 1n).toString(), data, outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString() };
      await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}
