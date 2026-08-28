import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { sortJoinableGuilds, type GuildJoinCandidate } from "./guild-join-policy.js";

export interface GuildJoinableListRow extends GuildJoinCandidate {
  guildVersion: bigint;
  policyVersion: bigint;
  masterName: string;
  masterRank: string;
}

export interface GuildJoinableListReadResult {
  status: "listed" | "empty";
  data: string;
  outboxId: string;
  snapshotId: string;
  snapshotToken: string;
  snapshotVersion: string;
  rowCount: number;
}

export interface GuildJoinableListReadInput {
  eventId: string;
  externalUserId: string;
  destinationId: string;
  message: string;
}

// 길드목록 exact 명령만 현대화 읽기 경로로 전달합니다.
export function isGuildJoinableListReadCommand(message: string | undefined): boolean {
  return message === "/길드목록";
}

// BIGINT 표시값을 천 단위 문자열로 변환합니다.
function formatInteger(value: bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// 가입 가능한 길드를 안정 번호와 다섯 행 allsee 경계로 표시합니다.
export function formatGuildJoinableList(rows: readonly GuildJoinableListRow[], allsee = "\u200b".repeat(500)): string {
  if (rows.length === 0) return "📋 가입 가능한 길드 목록\n\n현재 가입 가능한 길드가 없습니다.";
  const lines = ["📋 가입 가능한 길드 목록", "━━━━━━━━━━━━━━━"];
  rows.forEach((row, index) => {
    if (index === 5) lines.push(allsee);
    const master = `${row.masterRank}${row.masterName || "미지정"}`;
    lines.push(`${index + 1}. ${row.displayName}(${row.mark})`);
    lines.push(`서버: ${row.serverCode || "미지정"} | 레벨: ${row.level}`);
    lines.push(`길드장: ${master} | 인원: ${row.memberCount}/${row.maxMembers + row.recruitmentBonus}`);
    lines.push(`가입조건: ${formatInteger(row.joinRequirementExperience)} EXP 이상`);
  });
  lines.push("━━━━━━━━━━━━━━━", "가입: /길드가입 [번호]");
  return lines.join("\n");
}

// 긴 이벤트 ID를 operation 멱등성 키 길이에 맞게 정규화합니다.
function normalizeEventKey(eventId: string): string {
  return eventId.length <= 191 ? eventId : `sha256:${createHash("sha256").update(eventId).digest("hex")}`;
}

// MariaDB 중복키 충돌인지 판별합니다.
function isDuplicateKey(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ER_DUP_ENTRY";
}

// 가입 가능 길드의 DB 권위 목록과 가입 번호 스냅샷을 원자적으로 기록합니다.
export class GuildJoinableListReadService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(input: GuildJoinableListReadInput): Promise<GuildJoinableListReadResult | null> {
    if (!isGuildJoinableListReadCommand(input.message)) return null;
    try {
      return await this.execute(input);
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      return this.execute(input);
    }
  }

  private async execute(input: GuildJoinableListReadInput): Promise<GuildJoinableListReadResult | null> {
    return this.database.withTransaction(async (transaction) => {
      const actors = await transaction.query<Array<{ identity_id: bigint; player_id: bigint }>>(
        `SELECT identity.id AS identity_id, identity.player_id
         FROM external_identities identity
         JOIN players player ON player.id=identity.player_id AND player.status='active'
         WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' AND identity.player_id IS NOT NULL
         FOR UPDATE`, [input.externalUserId]
      );
      const actor = actors[0];
      if (actor === undefined) return null;
      const key = normalizeEventKey(input.eventId);
      const prior = await transaction.query<Array<{ result_json: string | GuildJoinableListReadResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope='guild.joinable_list.read' AND idempotency_key=? FOR UPDATE", [key]
      );
      if (prior[0]?.result_json != null) {
        return typeof prior[0].result_json === "string" ? JSON.parse(prior[0].result_json) as GuildJoinableListReadResult : prior[0].result_json;
      }
      const operation = await transaction.execute(
        `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES(?,'guild.joinable_list.read',?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))`,
        [randomUUID(), key, actor.identity_id.toString()]
      );
      const rawRows = await this.readRows(transaction);
      const rows = sortJoinableGuilds(rawRows) as GuildJoinableListRow[];
      const snapshotToken = randomUUID();
      const snapshotVersion = operation.insertId;
      const snapshot = await transaction.execute(
        `INSERT INTO guild_joinable_list_snapshots(operation_id,player_id,snapshot_token,snapshot_version,expires_at)
         VALUES(?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 30 MINUTE))`,
        [operation.insertId, actor.player_id, snapshotToken, snapshotVersion]
      );
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index]!;
        await transaction.execute(
          "INSERT INTO guild_joinable_list_entries(snapshot_id,position_no,guild_id,guild_version,policy_version) VALUES(?,?,?,?,?)",
          [snapshot.insertId, index + 1, row.guildId, row.guildVersion, row.policyVersion]
        );
      }
      const data = formatGuildJoinableList(rows);
      const status = rows.length === 0 ? "empty" : "listed";
      const outbox = await transaction.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES(?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operation.insertId, input.destinationId, JSON.stringify({ data })]
      );
      await transaction.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES(?,'GUILD_JOINABLE_LIST_READ',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [input.eventId, operation.insertId, status]
      );
      await transaction.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES(?,'external_identity',?,'guild_list',NULL,'guild.joinable_list.read',?,'Iris /길드목록',?,UTC_TIMESTAMP(3))",
        [operation.insertId, actor.identity_id, status, JSON.stringify({ rowCount: rows.length, snapshotId: snapshot.insertId.toString(), snapshotVersion: snapshotVersion.toString(), domainMutation: false })]
      );
      const result: GuildJoinableListReadResult = {
        status, data, outboxId: outbox.insertId.toString(), snapshotId: snapshot.insertId.toString(), snapshotToken,
        snapshotVersion: snapshotVersion.toString(), rowCount: rows.length
      };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }

  // 길드·정책·회원·길드장 표시를 한 스냅샷에서 읽습니다.
  private async readRows(transaction: DatabaseTransaction): Promise<GuildJoinableListRow[]> {
    const rows = await transaction.query<Array<{ guild_id: bigint; display_name: string; mark_text: string | null; server_code: string | null; level_value: number; join_experience: bigint; member_count: bigint; max_members: number; recruitment_bonus: number; guild_version: bigint; policy_version: bigint; master_name: string | null; master_rank: string | null }>>(
      `SELECT guild.id AS guild_id,guild.display_name,COALESCE(profile.mark_text,guild.mark) AS mark_text,guild.server_code,
        guild.level AS level_value,guild.join_requirement_experience AS join_experience,COUNT(member.player_id) AS member_count,
        guild.max_members,guild.recruitment_bonus,guild.version AS guild_version,policy.version AS policy_version,
        MAX(CASE WHEN member.role_code='master' THEN member_profile.current_display_name END) AS master_name,
        MAX(CASE WHEN member.role_code='master' THEN legacy_rank.rank_emoji END) AS master_rank
       FROM guilds guild
       JOIN guild_join_policies policy ON policy.guild_id=guild.id
       LEFT JOIN guild_profile_details profile ON profile.guild_id=guild.id
       LEFT JOIN guild_members member ON member.guild_id=guild.id
       LEFT JOIN player_profiles member_profile ON member_profile.player_id=member.player_id
       LEFT JOIN player_legacy_rank_profiles legacy_rank ON legacy_rank.player_id=member.player_id
       WHERE guild.status='active' AND policy.member_join_closed=FALSE
       GROUP BY guild.id,guild.display_name,profile.mark_text,guild.mark,guild.server_code,guild.level,guild.join_requirement_experience,
        guild.max_members,guild.recruitment_bonus,guild.version,policy.version
       HAVING COUNT(member.player_id) < guild.max_members + guild.recruitment_bonus`, []
    );
    return rows.map((row) => ({
      guildId: row.guild_id.toString(), displayName: row.display_name, mark: row.mark_text ?? "", serverCode: row.server_code ?? "",
      level: row.level_value, joinRequirementExperience: row.join_experience, memberCount: Number(row.member_count), maxMembers: row.max_members,
      recruitmentBonus: row.recruitment_bonus, memberJoinClosed: false, guildVersion: row.guild_version, policyVersion: row.policy_version,
      masterName: row.master_name ?? "", masterRank: row.master_rank ?? ""
    }));
  }
}
