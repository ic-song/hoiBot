import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import type {
  GuildForceExpelActor,
  GuildForceExpelRecord,
  GuildForceExpelRepository,
  GuildForceExpelResult,
  GuildForceExpelTarget,
  GuildForceExpelTransaction
} from "./guild-force-expel-repository.js";

// 긴 이벤트 ID를 operation 멱등성 키 길이에 맞게 정규화합니다.
function normalizeEventKey(eventId: string): string {
  return eventId.length <= 191 ? eventId : `sha256:${createHash("sha256").update(eventId).digest("hex")}`;
}

// MariaDB JSON 값을 강제제명 결과로 복원합니다.
function parseResult(value: string | GuildForceExpelResult): GuildForceExpelResult {
  return typeof value === "string" ? JSON.parse(value) as GuildForceExpelResult : value;
}

// 강제제명 Repository 계약을 MariaDB 잠금·원장·outbox 쿼리로 구현합니다.
export class MariaGuildForceExpelRepository implements GuildForceExpelRepository {
  constructor(private readonly database: DatabaseClient) {}

  async runInTransaction<T>(work: (transaction: GuildForceExpelTransaction) => Promise<T>): Promise<T> {
    return this.database.withTransaction(async (transaction) => work(this.bind(transaction)));
  }

  // 한 DB 트랜잭션에 종속된 강제제명 저장 동작을 구성합니다.
  private bind(transaction: DatabaseTransaction): GuildForceExpelTransaction {
    return {
      lockActor: async (externalUserId) => this.lockActor(transaction, externalUserId),
      readPriorResult: async (eventId, playerId) => this.readPriorResult(transaction, eventId, playerId),
      lockTarget: async (targetName) => this.lockTarget(transaction, targetName),
      startCommand: async (eventId, playerId, guildId) => this.startCommand(transaction, eventId, playerId, guildId),
      removeMembership: async (guildId, playerId) => this.removeMembership(transaction, guildId, playerId),
      completeCommand: async (operationId, record) => this.complete(transaction, operationId, record)
    };
  }

  // 카카오 외부 식별자에 연결된 활성 최고관리자를 잠급니다.
  private async lockActor(transaction: DatabaseTransaction, externalUserId: string): Promise<GuildForceExpelActor | null> {
    const rows = await transaction.query<Array<{ player_id: bigint; can_force_expel: bigint | number }>>(
      `SELECT identity.player_id,
        EXISTS(SELECT 1 FROM admin_operator_external_identities mapping
          JOIN admin_operators operator ON operator.id = mapping.operator_id AND operator.status = 'active'
          JOIN admin_operator_roles operator_role ON operator_role.operator_id = operator.id
          JOIN admin_roles role ON role.id = operator_role.role_id AND role.code = 'super_admin' AND role.active = TRUE
          WHERE mapping.external_identity_id = identity.id) AS can_force_expel
       FROM external_identities identity
       WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ?
         AND identity.status = 'linked' AND identity.player_id IS NOT NULL FOR UPDATE`,
      [externalUserId]
    );
    const row = rows[0];
    return row === undefined ? null : { playerId: row.player_id.toString(), canForceExpel: Number(row.can_force_expel) === 1 };
  }

  // 동일 이벤트의 완료 결과를 잠그고 재사용합니다.
  private async readPriorResult(transaction: DatabaseTransaction, eventId: string, playerId: string): Promise<GuildForceExpelResult | null> {
    const rows = await transaction.query<Array<{ result_json: string | GuildForceExpelResult | null }>>(
      "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE",
      [`guild.force-expel:${playerId}`, normalizeEventKey(eventId)]
    );
    return rows[0]?.result_json == null ? null : parseResult(rows[0].result_json);
  }

  // 닉네임 대상과 현재 길드 회원 관계를 함께 잠급니다.
  private async lockTarget(transaction: DatabaseTransaction, targetName: string): Promise<GuildForceExpelTarget | null> {
    const rows = await transaction.query<Array<{
      player_id: bigint; display_name: string; guild_id: bigint | null; guild_name: string | null; guild_mark: string | null; role_code: string | null;
    }>>(
      `SELECT profile.player_id, profile.current_display_name AS display_name,
        member.guild_id, guild.display_name AS guild_name, guild.mark AS guild_mark, member.role_code
       FROM player_profiles profile
       LEFT JOIN guild_members member ON member.player_id = profile.player_id
       LEFT JOIN guilds guild ON guild.id = member.guild_id AND guild.status = 'active'
       WHERE profile.current_display_name = ? FOR UPDATE`,
      [targetName]
    );
    const row = rows[0];
    if (row === undefined) return null;
    return {
      playerId: row.player_id.toString(), displayName: row.display_name,
      guildId: row.guild_id?.toString() ?? null, guildName: row.guild_name,
      guildMark: row.guild_mark ?? "", roleCode: row.role_code
    };
  }

  // 강제제명 operation을 처리 중 상태로 시작합니다.
  private async startCommand(transaction: DatabaseTransaction, eventId: string, playerId: string, guildId: string): Promise<string> {
    const result = await transaction.execute(
      `INSERT INTO operations (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, created_at)
       VALUES (?, ?, ?, 'player', ?, 'iris', 'processing', UTC_TIMESTAMP(3))`,
      [randomUUID(), `guild.force-expel:${playerId}`, normalizeEventKey(eventId), playerId]
    );
    void guildId;
    return result.insertId.toString();
  }

  // 확인한 길드 회원 관계 한 건만 삭제합니다.
  private async removeMembership(transaction: DatabaseTransaction, guildId: string, playerId: string): Promise<void> {
    const result = await transaction.execute("DELETE FROM guild_members WHERE guild_id = ? AND player_id = ?", [guildId, playerId]);
    if (result.affectedRows !== 1n) throw new Error("Guild membership disappeared during force-expel.");
  }

  // 실행·감사·outbox와 operation 결과를 같은 트랜잭션에서 완료합니다.
  private async complete(transaction: DatabaseTransaction, operationId: string, record: GuildForceExpelRecord): Promise<GuildForceExpelResult> {
    const outbox = await transaction.execute(
      `INSERT INTO outbox_messages (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at)
       VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [operationId, record.channelId, JSON.stringify({ data: record.data })]
    );
    await transaction.execute(
      `INSERT INTO command_executions (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at)
       VALUES (?, 'guild_force_expel', ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [record.eventId, operationId]
    );
    const audit = await transaction.execute(
      `INSERT INTO command_audit (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at)
       VALUES (?, 'player', ?, 'player', ?, 'guild.force-expel.completed', 'success', 'Iris 길드 강제제명', ?, UTC_TIMESTAMP(3))`,
      [operationId, record.actorPlayerId, record.targetPlayerId, JSON.stringify({ guildId: record.guildId, targetName: record.targetName })]
    );
    const completed: GuildForceExpelResult = {
      status: "completed", data: record.data, guildId: record.guildId,
      auditId: audit.insertId.toString(), outboxId: outbox.insertId.toString()
    };
    await transaction.execute(
      "UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?",
      [JSON.stringify(completed), operationId]
    );
    return completed;
  }
}
