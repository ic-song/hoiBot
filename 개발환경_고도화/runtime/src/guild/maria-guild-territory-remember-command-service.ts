import { randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import {
  handleGuildTerritoryRememberCommand,
  type GuildTerritoryRememberCommandResult
} from "./guild-territory-remember-command-adapter.js";
import type { GuildTerritoryRememberPreference } from "./guild-territory-read-model-repository.js";

const TERRITORY_SCOPE = "world-active";
const COMMAND_CODE = "guild_territory_remember_control";

interface ActorProjection {
  external_identity_id: bigint;
  player_id: bigint | null;
  identity_status: string;
  is_master: number;
  is_admin: number;
}

export interface GuildTerritoryRememberIrisCommand {
  eventId: string;
  externalUserId: string;
  channelId: string;
  sender: string;
  message: string;
}

export interface GuildTerritoryRememberIrisResult {
  status: "updated" | "forbidden";
  desiredState?: boolean;
  duplicate: boolean;
  outboxId: string;
  room: string;
  data: string;
}

// identity, preference, execution, audit와 outbox를 하나의 멱등 transaction으로 처리합니다.
export class MariaGuildTerritoryRememberCommandService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(command: GuildTerritoryRememberIrisCommand): Promise<GuildTerritoryRememberIrisResult> {
    return this.database.withTransaction(async (transaction) => {
      const replay = await this.readReplay(transaction, command);
      if (replay !== null) return replay;

      const actor = await this.readActor(transaction, command.externalUserId);
      const result = await handleGuildTerritoryRememberCommand(
        { message: command.message, sender: command.sender },
        {
          isMaster: () => Boolean(actor?.is_master),
          isAdmin: () => Boolean(actor?.is_admin),
          resolveIdentity: async () => actor === undefined || actor.player_id === null || actor.identity_status !== "linked"
            ? null
            : {
              territoryScope: TERRITORY_SCOPE,
              operatorPlayerId: actor.player_id.toString(),
              playerId: actor.player_id.toString()
            },
          setRememberPreference: (preference) => this.setPreference(transaction, preference)
        }
      );
      if (result.status === "ignored") throw new Error("Remember command service received a non-command message.");
      return this.persistResult(transaction, command, actor, result);
    });
  }

  // 동일 event/command의 저장 결과를 preference 재변경 없이 반환합니다.
  private async readReplay(
    transaction: DatabaseTransaction,
    command: GuildTerritoryRememberIrisCommand
  ): Promise<GuildTerritoryRememberIrisResult | null> {
    const rows = await transaction.query<Array<{
      result_code: string;
      payload_json: string | { data: string };
      outbox_id: bigint;
    }>>(
      `SELECT execution.result_code, outbox.id AS outbox_id, outbox.payload_json
       FROM command_executions execution
       JOIN outbox_messages outbox ON outbox.operation_id = execution.operation_id
       WHERE execution.event_id = ? AND execution.command_code = ? LIMIT 1`,
      [command.eventId, COMMAND_CODE]
    );
    const row = rows[0];
    if (row === undefined) return null;
    const payload = typeof row.payload_json === "string" ? JSON.parse(row.payload_json) as { data: string } : row.payload_json;
    const desiredState = row.result_code === "remember_on" ? true : row.result_code === "remember_off" ? false : undefined;
    return {
      status: row.result_code === "forbidden" ? "forbidden" : "updated",
      ...(desiredState === undefined ? {} : { desiredState }),
      duplicate: true,
      outboxId: row.outbox_id.toString(),
      room: command.channelId,
      data: payload.data
    };
  }

  // Kakao identity와 연결된 활성 운영자 역할을 한 projection으로 읽습니다.
  private async readActor(transaction: DatabaseTransaction, externalUserId: string): Promise<ActorProjection | undefined> {
    const rows = await transaction.query<ActorProjection[]>(
      `SELECT identity.id AS external_identity_id, identity.player_id, identity.status AS identity_status,
         MAX(CASE WHEN role.code = 'super_admin' THEN 1 ELSE 0 END) AS is_master,
         MAX(CASE WHEN role.id IS NOT NULL THEN 1 ELSE 0 END) AS is_admin
       FROM external_identities identity
       LEFT JOIN admin_operator_external_identities operator_identity
         ON operator_identity.external_identity_id = identity.id
       LEFT JOIN admin_operators operator
         ON operator.id = operator_identity.operator_id AND operator.status = 'active'
       LEFT JOIN admin_operator_roles operator_role ON operator_role.operator_id = operator.id
       LEFT JOIN admin_roles role ON role.id = operator_role.role_id AND role.active = TRUE
       WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ?
       GROUP BY identity.id, identity.player_id, identity.status
       LIMIT 1`,
      [externalUserId]
    );
    return rows[0];
  }

  // transaction에 주입되는 preference provider로 ON/OFF 상태를 upsert합니다.
  private async setPreference(
    transaction: DatabaseTransaction,
    command: { territoryScope: string; operatorPlayerId: string; playerId: string; desiredState: boolean }
  ): Promise<GuildTerritoryRememberPreference> {
    await transaction.execute(
      `INSERT INTO guild_territory_remember_preferences
        (territory_scope_code, operator_player_id, player_id, desired_state, version, updated_at)
       VALUES (?, ?, ?, ?, 1, UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE desired_state = VALUES(desired_state), version = version + 1,
         updated_at = UTC_TIMESTAMP(3)`,
      [command.territoryScope, command.operatorPlayerId, command.playerId, command.desiredState]
    );
    const rows = await transaction.query<Array<{ desired_state: number; version: bigint }>>(
      `SELECT desired_state, version FROM guild_territory_remember_preferences
       WHERE territory_scope_code = ? AND operator_player_id = ? AND player_id = ?`,
      [command.territoryScope, command.operatorPlayerId, command.playerId]
    );
    const row = rows[0];
    if (row === undefined) throw new Error("Remember preference was not persisted.");
    return { ...command, desiredState: Boolean(row.desired_state), version: row.version };
  }

  // adapter 결과와 변경 상태를 operation/execution/audit/outbox에 함께 기록합니다.
  private async persistResult(
    transaction: DatabaseTransaction,
    command: GuildTerritoryRememberIrisCommand,
    actor: ActorProjection | undefined,
    result: Exclude<GuildTerritoryRememberCommandResult, { status: "ignored" }>
  ): Promise<GuildTerritoryRememberIrisResult> {
    const resultCode = result.status === "forbidden" ? "forbidden" : result.desiredState ? "remember_on" : "remember_off";
    const operation = await transaction.execute(
      `INSERT INTO operations
        (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code,
         status, result_json, created_at, completed_at)
       VALUES (?, 'guild_territory_remember', ?, 'external_identity', ?, 'iris', 'completed', ?,
         UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [randomUUID(), command.eventId, actor?.external_identity_id ?? null,
        JSON.stringify({ resultCode, desiredState: result.status === "updated" ? result.desiredState : null })]
    );
    await transaction.execute(
      `INSERT INTO command_executions
        (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at)
       VALUES (?, ?, ?, 'completed', ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [command.eventId, COMMAND_CODE, operation.insertId, resultCode]
    );
    await transaction.execute(
      `INSERT INTO command_audit
        (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code,
         reason, change_summary_json, created_at)
       VALUES (?, 'external_identity', ?, 'guild_territory_remember_preference', ?,
         'guild_territory_remember.set', ?, ?, ?, UTC_TIMESTAMP(3))`,
      [operation.insertId, actor?.external_identity_id ?? null, actor?.player_id ?? null, resultCode,
        result.status === "forbidden" ? "administrator role required" : null,
        JSON.stringify({ desiredState: result.status === "updated" ? result.desiredState : null })]
    );
    const outbox = await transaction.execute(
      `INSERT INTO outbox_messages
        (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at)
       VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [operation.insertId, command.channelId, JSON.stringify({ data: result.reply })]
    );
    return {
      status: result.status,
      ...(result.status === "updated" ? { desiredState: result.desiredState } : {}),
      duplicate: false,
      outboxId: outbox.insertId.toString(),
      room: command.channelId,
      data: result.reply
    };
  }
}
