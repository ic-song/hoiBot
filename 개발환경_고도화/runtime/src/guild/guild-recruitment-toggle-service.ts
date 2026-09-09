import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

export interface GuildRecruitmentToggleCommand { externalUserId: string; channelId: string; message: string; eventId: string; }
export interface GuildRecruitmentToggleResult {
  status: "closed" | "opened" | "already_closed" | "already_open";
  guildId: string;
  previousClosed: boolean;
  closed: boolean;
  version: string;
  data: string;
  outboxId: string;
  auditId: string;
}

// 길드 가입 마감·해제의 exact 명령만 허용합니다.
export function isGuildRecruitmentToggleCommand(message: string | undefined): boolean {
  return message === "/길드인원마감" || message === "/길드인원마감해제";
}

// 긴 Iris event ID를 operations 키 길이에 맞게 정규화합니다.
function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// MariaDB JSON 결과를 재시도 응답으로 복원합니다.
function stored(value: string | GuildRecruitmentToggleResult): GuildRecruitmentToggleResult {
  return typeof value === "string" ? JSON.parse(value) as GuildRecruitmentToggleResult : value;
}

// 길드 정책을 잠그고 가입 마감 상태·호환 projection·감사·응답을 원자 처리합니다.
export class GuildRecruitmentToggleService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(command: GuildRecruitmentToggleCommand): Promise<GuildRecruitmentToggleResult> {
    if (!isGuildRecruitmentToggleCommand(command.message)) throw new ApplicationError("INVALID_GUILD_RECRUITMENT_COMMAND", "길드인원마감 명령 형식이 올바르지 않습니다.", 422);
    const desiredClosed = command.message === "/길드인원마감";
    return this.database.withTransaction(async (tx) => {
      const actors = await tx.query<Array<{ player_id: bigint; guild_id: bigint; role_code: string; can_admin: number }>>(
        `SELECT identity.player_id,membership.guild_id,membership.role_code,
          EXISTS(SELECT 1 FROM admin_operator_external_identities mapping
            JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active'
            JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
            JOIN admin_roles role ON role.id=operator_role.role_id AND role.active=TRUE
            LEFT JOIN admin_role_permissions permission ON permission.role_id=role.id AND permission.permission_code='game.guild.change'
            WHERE mapping.external_identity_id=identity.id AND (role.code='super_admin' OR permission.permission_code IS NOT NULL)) AS can_admin
         FROM external_identities identity
         JOIN guild_members membership ON membership.player_id=identity.player_id
         JOIN guilds guild ON guild.id=membership.guild_id AND guild.status='active'
         WHERE identity.provider_code='kakao' AND identity.external_user_id=?
           AND identity.status='linked' AND identity.player_id IS NOT NULL FOR UPDATE`, [command.externalUserId]
      );
      const actor = actors[0];
      if (actor === undefined) throw new ApplicationError("GUILD_MEMBERSHIP_REQUIRED", "❌ 가입된 길드가 없습니다.", 404);
      const role = actor.role_code.toLowerCase();
      if (role !== "leader" && role !== "master" && actor.can_admin !== 1) {
        throw new ApplicationError("GUILD_LEADER_PERMISSION_REQUIRED", "❌ 길드장 또는 관리자만 변경할 수 있습니다.", 403);
      }
      const scope = `guild.recruitment:${actor.guild_id}`;
      const key = eventKey(command.eventId);
      const prior = await tx.query<Array<{ result_json: string | GuildRecruitmentToggleResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, key]
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) return stored(prior[0].result_json);
      const policies = await tx.query<Array<{ member_join_closed: number; version: bigint }>>(
        "SELECT member_join_closed,version FROM guild_join_policies WHERE guild_id=? FOR UPDATE", [actor.guild_id]
      );
      const policy = policies[0];
      if (policy === undefined) throw new ApplicationError("GUILD_JOIN_POLICY_REQUIRED", "길드 가입 정책이 준비되지 않았습니다.", 409);
      const previousClosed = policy.member_join_closed === 1;
      const changed = previousClosed !== desiredClosed;
      const operation = await tx.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'player',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), scope, key, actor.player_id]
      );
      if (changed) {
        const write = await tx.execute(
          "UPDATE guild_join_policies SET member_join_closed=?,version=version+1,updated_by_player_id=?,updated_at=UTC_TIMESTAMP(3) WHERE guild_id=? AND version=?",
          [desiredClosed, actor.player_id, actor.guild_id, policy.version]
        );
        if (write.affectedRows !== 1n) throw new ApplicationError("GUILD_JOIN_POLICY_CONFLICT", "길드 가입 정책이 먼저 변경되었습니다.", 409);
        await tx.execute("UPDATE guilds SET member_join_closed=?,version=version+1 WHERE id=?", [desiredClosed, actor.guild_id]);
      }
      const status: GuildRecruitmentToggleResult["status"] = desiredClosed
        ? (changed ? "closed" : "already_closed") : (changed ? "opened" : "already_open");
      const data = status === "closed" ? "길드 신규 가입을 마감했습니다."
        : status === "opened" ? "길드 신규 가입 마감을 해제했습니다."
        : status === "already_closed" ? "이미 길드 신규 가입이 마감되어 있습니다."
        : "이미 길드 신규 가입이 열려 있습니다.";
      const outbox = await tx.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operation.insertId, command.channelId, JSON.stringify({ data })]
      );
      const commandCode = desiredClosed ? "GUILD_RECRUITMENT_CLOSE" : "GUILD_RECRUITMENT_OPEN";
      await tx.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [command.eventId, commandCode, operation.insertId, status]
      );
      const audit = await tx.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'player',?,'guild',?,'guild.recruitment.toggle',?,'Iris 길드인원마감',?,UTC_TIMESTAMP(3))",
        [operation.insertId, actor.player_id, actor.guild_id, status, JSON.stringify({ previousClosed, closed: desiredClosed, changed })]
      );
      const result: GuildRecruitmentToggleResult = { status, guildId: actor.guild_id.toString(), previousClosed, closed: desiredClosed,
        version: (policy.version + (changed ? 1n : 0n)).toString(), data, outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString() };
      await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}
