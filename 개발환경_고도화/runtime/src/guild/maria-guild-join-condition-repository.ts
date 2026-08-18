import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import type {
  GuildJoinConditionActor,
  GuildJoinConditionCommandRecord,
  GuildJoinConditionRepository,
  GuildJoinConditionResult,
  GuildJoinConditionTransaction
} from "./guild-join-condition-repository.js";

// 긴 이벤트 ID를 operation 멱등성 키 길이에 맞게 정규화합니다.
function normalizeEventKey(eventId: string): string {
  return eventId.length <= 191 ? eventId : `sha256:${createHash("sha256").update(eventId).digest("hex")}`;
}

// MariaDB JSON 값을 길드가입조건 결과로 복원합니다.
function parseResult(value: string | GuildJoinConditionResult): GuildJoinConditionResult {
  return typeof value === "string" ? JSON.parse(value) as GuildJoinConditionResult : value;
}

// 길드가입조건 Repository 계약을 MariaDB 잠금·원장·outbox 쿼리로 구현합니다.
export class MariaGuildJoinConditionRepository implements GuildJoinConditionRepository {
  constructor(private readonly database: DatabaseClient) {}

  async runInTransaction<T>(work: (transaction: GuildJoinConditionTransaction) => Promise<T>): Promise<T> {
    return this.database.withTransaction(async (transaction) => work(this.bind(transaction)));
  }

  // 한 DB 트랜잭션에 종속된 길드가입조건 저장 동작을 구성합니다.
  private bind(transaction: DatabaseTransaction): GuildJoinConditionTransaction {
    return {
      lockActor: async (externalUserId) => this.lockActor(transaction, externalUserId),
      readPriorResult: async (eventId, playerId) => this.readPriorResult(transaction, eventId, playerId),
      startCommand: async (eventId, playerId, guildId) => this.startCommand(transaction, eventId, playerId, guildId),
      updateJoinRequirement: async (guildId, experience) => this.updateJoinRequirement(transaction, guildId, experience),
      completeCommand: async (operationId, record) => this.complete(transaction, operationId, record)
    };
  }

  // 외부 사용자와 소속 길드·역할을 함께 잠급니다.
  private async lockActor(transaction: DatabaseTransaction, externalUserId: string): Promise<GuildJoinConditionActor | null> {
    const rows = await transaction.query<Array<{ player_id: bigint; guild_id: bigint; role_code: string }>>(
      `SELECT identity.player_id, member.guild_id, member.role_code
       FROM external_identities identity
       JOIN guild_members member ON member.player_id = identity.player_id
       JOIN guilds guild ON guild.id = member.guild_id AND guild.status = 'active'
       WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ?
         AND identity.status = 'linked' AND identity.player_id IS NOT NULL FOR UPDATE`,
      [externalUserId]
    );
    const row = rows[0];
    if (row === undefined) return null;
    const roleCode = row.role_code.toLowerCase();
    return {
      playerId: row.player_id.toString(),
      guildId: row.guild_id.toString(),
      canManageJoinCondition: roleCode === "leader" || roleCode === "master" || roleCode === "submaster" || roleCode === "sub_master"
    };
  }

  // 동일 이벤트의 완료 결과를 잠그고 재사용합니다.
  private async readPriorResult(transaction: DatabaseTransaction, eventId: string, playerId: string): Promise<GuildJoinConditionResult | null> {
    const rows = await transaction.query<Array<{ result_json: string | GuildJoinConditionResult | null }>>(
      "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE",
      [`guild.join-condition:${playerId}`, normalizeEventKey(eventId)]
    );
    return rows[0]?.result_json == null ? null : parseResult(rows[0].result_json);
  }

  // 길드가입조건 operation을 처리 중 상태로 시작합니다.
  private async startCommand(transaction: DatabaseTransaction, eventId: string, playerId: string, guildId: string): Promise<string> {
    const result = await transaction.execute(
      `INSERT INTO operations (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, created_at)
       VALUES (?, ?, ?, 'player', ?, 'iris', 'processing', UTC_TIMESTAMP(3))`,
      [randomUUID(), `guild.join-condition:${playerId}`, normalizeEventKey(eventId), playerId]
    );
    void guildId;
    return result.insertId.toString();
  }

  // 길드의 현재 가입조건을 반환하고 새 조건과 version을 원자적으로 저장합니다.
  private async updateJoinRequirement(transaction: DatabaseTransaction, guildId: string, experience: bigint): Promise<bigint> {
    const rows = await transaction.query<Array<{ join_requirement_experience: bigint; version: bigint }>>(
      "SELECT join_requirement_experience, version FROM guilds WHERE id = ? AND status = 'active' FOR UPDATE", [guildId]
    );
    const guild = rows[0];
    if (guild === undefined) throw new Error("Active guild disappeared during join-condition update.");
    const updated = await transaction.execute(
      "UPDATE guilds SET join_requirement_experience = ?, version = version + 1 WHERE id = ? AND version = ?",
      [experience, guildId, guild.version]
    );
    if (updated.affectedRows !== 1n) throw new Error("Guild join-condition update conflict.");
    return guild.join_requirement_experience;
  }

  // 실행·감사·outbox와 operation 결과를 같은 트랜잭션에서 완료합니다.
  private async complete(transaction: DatabaseTransaction, operationId: string, record: GuildJoinConditionCommandRecord): Promise<GuildJoinConditionResult> {
    const outbox = await transaction.execute(
      `INSERT INTO outbox_messages (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at)
       VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [operationId, record.channelId, JSON.stringify({ data: record.data })]
    );
    await transaction.execute(
      `INSERT INTO command_executions (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at)
       VALUES (?, 'guild_join_condition', ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [record.eventId, operationId]
    );
    const audit = await transaction.execute(
      `INSERT INTO command_audit (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at)
       VALUES (?, 'player', ?, 'guild', ?, 'guild.join-condition.changed', 'success', 'Iris 길드가입조건 변경', ?, UTC_TIMESTAMP(3))`,
      [operationId, record.playerId, record.guildId, JSON.stringify({ previousExperience: record.previousExperience.toString(), experience: record.experience.toString() })]
    );
    const completed: GuildJoinConditionResult = {
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
