import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import type { GuildJoinCandidate } from "./guild-join-policy.js";
import type {
  GuildJoinCommandRecord, GuildJoinPlayer, GuildJoinRepository, GuildJoinResult,
  GuildJoinTransaction, PendingGuildJoin
} from "./guild-join-repository.js";

const JOIN_TICKET_CODE = "legacy-guild-join-ticket";

// 긴 이벤트 ID를 operation 멱등성 키 길이에 맞게 정규화합니다.
function normalizeEventKey(eventId: string): string {
  return eventId.length <= 191 ? eventId : `sha256:${createHash("sha256").update(eventId).digest("hex")}`;
}

// MariaDB JSON 결과를 길드가입 결과 객체로 복원합니다.
function parseResult(value: string | GuildJoinResult): GuildJoinResult {
  return typeof value === "string" ? JSON.parse(value) as GuildJoinResult : value;
}

// 길드가입 Repository 계약을 MariaDB 잠금·원장·outbox 쿼리로 구현합니다.
export class MariaGuildJoinRepository implements GuildJoinRepository {
  constructor(private readonly database: DatabaseClient) {}

  async runInTransaction<T>(work: (transaction: GuildJoinTransaction) => Promise<T>): Promise<T> {
    return this.database.withTransaction(async (transaction) => work(this.bind(transaction)));
  }

  // 한 DB 트랜잭션에 종속된 길드가입 저장 동작을 구성합니다.
  private bind(transaction: DatabaseTransaction): GuildJoinTransaction {
    return {
      lockPlayer: async (externalUserId) => this.lockPlayer(transaction, externalUserId),
      readPriorResult: async (eventId, commandCode, playerId) => this.readPriorResult(transaction, eventId, commandCode, playerId),
      startCommand: async (eventId, commandCode, playerId) => this.startCommand(transaction, eventId, commandCode, playerId),
      listJoinableGuilds: async (playerId) => this.listGuildsForPlayer(transaction, playerId),
      lockGuild: async (guildId) => (await this.listGuilds(transaction, true, guildId))[0] ?? null,
      lockPendingJoin: async (playerId) => this.lockPending(transaction, playerId),
      savePendingJoin: async (playerId, guildId, guildNo, eventId) => this.savePending(transaction, playerId, guildId, guildNo, eventId),
      clearPendingJoin: async (playerId, status) => { await transaction.execute(
        "UPDATE guild_join_requests SET status = ?, completed_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3) WHERE player_id = ? AND status = 'pending'",
        [status, playerId]
      ); },
      addMembershipAndSpendTicket: async (operationId, playerId, guildId) => this.joinAndSpend(transaction, operationId, playerId, guildId),
      completeCommand: async (operationId, record, result) => this.complete(transaction, operationId, record, result)
    };
  }

  private async lockPlayer(transaction: DatabaseTransaction, externalUserId: string): Promise<GuildJoinPlayer | null> {
    const rows = await transaction.query<Array<{ player_id: bigint; current_display_name: string; experience: bigint; guild_id: bigint | null; ticket_quantity: bigint }>>(
      `SELECT identity.player_id, profile.current_display_name, profile.experience,
        membership.guild_id, COALESCE(ticket.quantity, 0) AS ticket_quantity
       FROM external_identities identity
       JOIN player_profiles profile ON profile.player_id = identity.player_id
       LEFT JOIN guild_members membership ON membership.player_id = identity.player_id
       LEFT JOIN item_definitions item ON item.code = ? AND item.active = TRUE AND item.stackable = TRUE
       LEFT JOIN inventory_stacks ticket ON ticket.player_id = identity.player_id AND ticket.item_id = item.id
       WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ?
         AND identity.status = 'linked' AND identity.player_id IS NOT NULL FOR UPDATE`,
      [JOIN_TICKET_CODE, externalUserId]
    );
    const row = rows[0];
    return row === undefined ? null : {
      playerId: row.player_id.toString(), rankLabel: row.current_display_name, experience: row.experience,
      currentGuildId: row.guild_id?.toString() ?? null, joinTicketQuantity: row.ticket_quantity
    };
  }

  private async readPriorResult(transaction: DatabaseTransaction, eventId: string, commandCode: GuildJoinCommandRecord["commandCode"], playerId: string): Promise<GuildJoinResult | null> {
    const rows = await transaction.query<Array<{ result_json: string | GuildJoinResult | null }>>(
      "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE",
      [`guild.join:${commandCode}:${playerId}`, normalizeEventKey(eventId)]
    );
    return rows[0]?.result_json == null ? null : parseResult(rows[0].result_json);
  }

  private async startCommand(transaction: DatabaseTransaction, eventId: string, commandCode: GuildJoinCommandRecord["commandCode"], playerId: string): Promise<string> {
    const result = await transaction.execute(
      `INSERT INTO operations (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, created_at)
       VALUES (?, ?, ?, 'player', ?, 'iris', 'processing', UTC_TIMESTAMP(3))`,
      [randomUUID(), `guild.join:${commandCode}:${playerId}`, normalizeEventKey(eventId), playerId]
    );
    return result.insertId.toString();
  }

  private async listGuilds(transaction: DatabaseTransaction, lock: boolean, guildId?: string): Promise<GuildJoinCandidate[]> {
    const rows = await transaction.query<Array<{ id: bigint; display_name: string; mark: string | null; server_code: string | null; level: number; join_requirement_experience: bigint; member_join_closed: number; max_members: number; recruitment_bonus: number; member_count: bigint }>>(
      `SELECT guild.id, guild.display_name, guild.mark, guild.server_code, guild.level,
        guild.join_requirement_experience, policy.member_join_closed, guild.max_members, guild.recruitment_bonus,
        (SELECT COUNT(*) FROM guild_members member WHERE member.guild_id = guild.id) AS member_count
       FROM guilds guild
       JOIN guild_join_policies policy ON policy.guild_id = guild.id
       WHERE guild.status = 'active'${guildId === undefined ? "" : " AND guild.id = ?"}
       ${lock ? "FOR UPDATE" : ""}`,
      guildId === undefined ? [] : [guildId]
    );
    return rows.map((row) => ({
      guildId: row.id.toString(), displayName: row.display_name, mark: row.mark ?? "", serverCode: row.server_code ?? "",
      level: row.level, joinRequirementExperience: row.join_requirement_experience, memberJoinClosed: Boolean(row.member_join_closed),
      maxMembers: row.max_members, recruitmentBonus: row.recruitment_bonus, memberCount: Number(row.member_count)
    }));
  }

  // 최근 길드목록 스냅샷이 있으면 번호를 고정하고, 없으면 현재 목록을 계산합니다.
  private async listGuildsForPlayer(transaction: DatabaseTransaction, playerId?: string): Promise<GuildJoinCandidate[]> {
    if (playerId === undefined) return this.listGuilds(transaction, false);
    const snapshotRows = await transaction.query<Array<{ guild_id: bigint; position_no: number; display_name: string; mark: string | null; server_code: string | null; level: number; join_requirement_experience: bigint; member_join_closed: number; max_members: number; recruitment_bonus: number; member_count: bigint }>>(
      `SELECT entry.guild_id, entry.position_no, guild.display_name, guild.mark, guild.server_code, guild.level,
        guild.join_requirement_experience, policy.member_join_closed, guild.max_members, guild.recruitment_bonus,
        (SELECT COUNT(*) FROM guild_members member WHERE member.guild_id = guild.id) AS member_count
       FROM guild_joinable_list_snapshots snapshot
       JOIN guild_joinable_list_entries entry ON entry.snapshot_id = snapshot.id
       JOIN guilds guild ON guild.id = entry.guild_id
       JOIN guild_join_policies policy ON policy.guild_id = guild.id
       WHERE snapshot.id = (
         SELECT latest.id FROM guild_joinable_list_snapshots latest
         WHERE latest.player_id = ? AND latest.expires_at > UTC_TIMESTAMP(3)
         ORDER BY latest.snapshot_version DESC, latest.id DESC LIMIT 1
       )
       ORDER BY entry.position_no ASC`, [playerId]
    );
    if (snapshotRows.length === 0) return this.listGuilds(transaction, false);
    return snapshotRows.map((row) => ({
      guildId: row.guild_id.toString(), displayName: row.display_name, mark: row.mark ?? "", serverCode: row.server_code ?? "",
      level: row.level, joinRequirementExperience: row.join_requirement_experience, memberJoinClosed: Boolean(row.member_join_closed),
      maxMembers: row.max_members, recruitmentBonus: row.recruitment_bonus, memberCount: Number(row.member_count), snapshotPosition: row.position_no
    }));
  }

  private async lockPending(transaction: DatabaseTransaction, playerId: string): Promise<PendingGuildJoin | null> {
    const rows = await transaction.query<Array<{ guild_id: bigint; guild_no: number }>>(
      "SELECT guild_id, guild_no FROM guild_join_requests WHERE player_id = ? AND status = 'pending' AND expires_at > UTC_TIMESTAMP(3) FOR UPDATE",
      [playerId]
    );
    return rows[0] === undefined ? null : { guildId: rows[0].guild_id.toString(), guildNo: rows[0].guild_no };
  }

  private async savePending(transaction: DatabaseTransaction, playerId: string, guildId: string, guildNo: number, eventId: string): Promise<void> {
    await transaction.execute(
      `INSERT INTO guild_join_requests (player_id, guild_id, guild_no, status, requested_event_id, expires_at)
       VALUES (?, ?, ?, 'pending', (SELECT event_id FROM event_inbox WHERE event_id = ?), DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 30 MINUTE))
       ON DUPLICATE KEY UPDATE guild_id = VALUES(guild_id), guild_no = VALUES(guild_no), status = 'pending',
        requested_event_id = VALUES(requested_event_id), expires_at = VALUES(expires_at), updated_at = UTC_TIMESTAMP(3), completed_at = NULL`,
      [playerId, guildId, guildNo, eventId]
    );
  }

  private async joinAndSpend(transaction: DatabaseTransaction, operationId: string, playerId: string, guildId: string): Promise<void> {
    await transaction.execute("INSERT INTO guild_members (guild_id, player_id, role_code, joined_at) VALUES (?, ?, 'member', UTC_TIMESTAMP(3))", [guildId, playerId]);
    const updated = await transaction.execute(
      `UPDATE inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id
       SET stack.quantity = stack.quantity - 1, stack.version = stack.version + 1
       WHERE stack.player_id = ? AND item.code = ? AND stack.quantity >= 1`, [playerId, JOIN_TICKET_CODE]
    );
    if (updated.affectedRows !== 1n) throw new Error("Guild join ticket update conflict.");
    await transaction.execute(
      `INSERT INTO inventory_ledger (operation_id, sequence_no, player_id, item_id, quantity_delta, reason_code)
       SELECT ?, 1, ?, id, -1, 'guild_join_ticket_used' FROM item_definitions WHERE code = ?`,
      [operationId, playerId, JOIN_TICKET_CODE]
    );
  }

  private async complete(transaction: DatabaseTransaction, operationId: string, record: GuildJoinCommandRecord, result: GuildJoinResult): Promise<GuildJoinResult> {
    const outbox = await transaction.execute(
      `INSERT INTO outbox_messages (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at)
       VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [operationId, record.channelId, JSON.stringify({ data: record.data })]
    );
    await transaction.execute(
      `INSERT INTO command_executions (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at)
       VALUES (?, ?, ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [record.eventId, record.commandCode, operationId]
    );
    const audit = await transaction.execute(
      `INSERT INTO command_audit (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at)
       VALUES (?, 'player', ?, 'guild', ?, ?, 'success', 'Iris 길드가입', ?, UTC_TIMESTAMP(3))`,
      [operationId, record.playerId, record.guildId, record.actionCode, JSON.stringify(record.changeSummary)]
    );
    const completed = { ...result, auditId: audit.insertId.toString(), outboxId: outbox.insertId.toString() };
    await transaction.execute("UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?", [JSON.stringify(completed), operationId]);
    return completed;
  }
}
