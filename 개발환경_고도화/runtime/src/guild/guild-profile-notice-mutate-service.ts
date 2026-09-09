import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

export interface GuildProfileNoticeIrisInput { eventId: string; externalUserId: string; channelId: string; message: string; }
export interface GuildProfileNoticeMutationResult {
  status: "changed" | "unchanged";
  guildId: string;
  previousNotice: string | null;
  notice: string;
  version: string;
  data: string;
  outboxId: string;
  auditId: string;
}

// 길드공지 명령과 인자 입력만 공용 dispatch 후보로 판정합니다.
export function isGuildProfileNoticeMutateCandidate(message: string | undefined): boolean {
  return message === "/길드공지" || (message !== undefined && message.startsWith("/길드공지 "));
}

// 길드공지 본문을 1~30자로 정규화합니다.
export function parseGuildProfileNotice(message: string): string {
  if (!isGuildProfileNoticeMutateCandidate(message)) {
    throw new ApplicationError("INVALID_GUILD_NOTICE_COMMAND", "길드공지 명령 형식이 올바르지 않습니다.", 422);
  }
  const notice = message.slice("/길드공지".length).trim();
  if (notice.length === 0) throw new ApplicationError("GUILD_NOTICE_REQUIRED", "❌ 변경할 길드 공지를 입력해주세요.", 422);
  if (notice.length > 30) throw new ApplicationError("GUILD_NOTICE_TOO_LONG", "❌ 길드 공지는 30자까지 입력할 수 있습니다.", 422);
  return notice;
}

// 긴 Iris event ID를 operations 키 길이에 맞게 정규화합니다.
function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// MariaDB JSON 결과를 재실행 응답으로 복원합니다.
function stored(value: string | GuildProfileNoticeMutationResult): GuildProfileNoticeMutationResult {
  return typeof value === "string" ? JSON.parse(value) as GuildProfileNoticeMutationResult : value;
}

// 길드 공지와 감사·outbox를 한 MariaDB transaction으로 변경합니다.
export class GuildProfileNoticeMutateService {
  constructor(private readonly database: DatabaseClient) {}

  async handleIris(input: GuildProfileNoticeIrisInput): Promise<{ status: "changed"; data: string; outboxId: string } | { status: "shadow" } | { status: "legacy_fallback" }> {
    parseGuildProfileNotice(input.message);
    const rollout = (await this.database.query<Array<{ rollout_state: string; enabled: number }>>(
      "SELECT rollout_state,enabled FROM command_registry WHERE command_code='GUILD_PROFILE_NOTICE_MUTATE' LIMIT 1"
    ))[0];
    if (rollout === undefined || rollout.enabled !== 1 || rollout.rollout_state === "LEGACY_ONLY") return { status: "legacy_fallback" };
    if (rollout.rollout_state !== "ACTIVE") return { status: "shadow" };
    const result = await this.mutate(input);
    return { status: "changed", data: result.data, outboxId: result.outboxId };
  }

  async mutate(input: GuildProfileNoticeIrisInput): Promise<GuildProfileNoticeMutationResult> {
    const notice = parseGuildProfileNotice(input.message);
    return this.database.withTransaction(async (tx) => {
      const actors = await tx.query<Array<{ player_id: bigint; guild_id: bigint; guild_name: string; role_code: string; notice_text: string | null; version: bigint; can_admin: number }>>(
        `SELECT identity.player_id,membership.guild_id,guild.display_name guild_name,membership.role_code,
          detail.notice_text,detail.version,
          EXISTS(SELECT 1 FROM admin_operator_external_identities mapping
            JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active'
            JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
            JOIN admin_roles role ON role.id=operator_role.role_id AND role.active=TRUE
            LEFT JOIN admin_role_permissions permission ON permission.role_id=role.id AND permission.permission_code='game.guild.change'
            WHERE mapping.external_identity_id=identity.id AND (role.code='super_admin' OR permission.permission_code IS NOT NULL)) can_admin
         FROM external_identities identity
         JOIN guild_members membership ON membership.player_id=identity.player_id
         JOIN guilds guild ON guild.id=membership.guild_id AND guild.status='active'
         JOIN guild_profile_details detail ON detail.guild_id=guild.id
         WHERE identity.provider_code='kakao' AND identity.external_user_id=?
           AND identity.status='linked' AND identity.player_id IS NOT NULL
         LIMIT 1 FOR UPDATE`, [input.externalUserId]
      );
      const actor = actors[0];
      if (actor === undefined) throw new ApplicationError("GUILD_MEMBERSHIP_REQUIRED", "❌ 가입된 길드가 없습니다.", 404);
      const role = actor.role_code.toLowerCase();
      if (!["leader", "master", "sub_master", "submaster"].includes(role) && actor.can_admin !== 1) {
        throw new ApplicationError("GUILD_NOTICE_PERMISSION_REQUIRED", "❌ 길드장 또는 부마스터만 공지를 변경할 수 있습니다.", 403);
      }
      const scope = `guild.profile.notice:${actor.guild_id}`;
      const key = eventKey(input.eventId);
      const prior = await tx.query<Array<{ result_json: string | GuildProfileNoticeMutationResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, key]
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) return stored(prior[0].result_json);
      const operation = await tx.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'player',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), scope, key, actor.player_id]
      );
      const changed = actor.notice_text !== notice;
      if (changed) {
        const write = await tx.execute(
          "UPDATE guild_profile_details SET notice_text=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE guild_id=? AND version=?",
          [notice, actor.guild_id, actor.version]
        );
        if (write.affectedRows !== 1n) throw new ApplicationError("GUILD_NOTICE_CONFLICT", "길드 공지가 먼저 변경되었습니다.", 409);
        await tx.execute("UPDATE guilds SET version=version+1 WHERE id=?", [actor.guild_id]);
      }
      const resultingVersion = actor.version + (changed ? 1n : 0n);
      await tx.execute(
        "INSERT INTO guild_profile_notice_history(operation_id,guild_id,actor_player_id,previous_notice_text,notice_text,previous_version,resulting_version) VALUES (?,?,?,?,?,?,?)",
        [operation.insertId, actor.guild_id, actor.player_id, actor.notice_text, notice, actor.version, resultingVersion]
      );
      const data = changed
        ? `✅ [${actor.guild_name}] 길드 공지가 변경되었습니다.\n공지: ${notice}`
        : `✅ [${actor.guild_name}] 이미 같은 길드 공지가 등록되어 있습니다.\n공지: ${notice}`;
      const outbox = await tx.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operation.insertId, input.channelId, JSON.stringify({ data })]
      );
      const status: GuildProfileNoticeMutationResult["status"] = changed ? "changed" : "unchanged";
      await tx.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'GUILD_PROFILE_NOTICE_MUTATE',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [input.eventId, operation.insertId, status]
      );
      const audit = await tx.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'player',?,'guild',?,'guild.profile.notice.mutate',?,'Iris 길드공지',?,UTC_TIMESTAMP(3))",
        [operation.insertId, actor.player_id, actor.guild_id, status, JSON.stringify({ previousNotice: actor.notice_text, notice, changed, previousVersion: actor.version.toString(), resultingVersion: resultingVersion.toString(), role })]
      );
      const result: GuildProfileNoticeMutationResult = {
        status, guildId: actor.guild_id.toString(), previousNotice: actor.notice_text, notice,
        version: resultingVersion.toString(), data, outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString()
      };
      await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}
