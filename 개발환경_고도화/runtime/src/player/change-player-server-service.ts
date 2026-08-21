import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

export interface ChangePlayerServerCommand {
  playerId: string;
  serverCode: string;
  expectedVersion: string;
  reason: string;
  idempotencyKey: string;
  actorId: string;
  sourceCode: "admin_api" | "iris";
  irisReply?: { destinationId: string; data: string };
  sourceEventId?: string;
}

export interface ChangePlayerServerResult {
  serverCode: string;
  profileVersion: string;
  auditId: string;
  replyOutboxId?: string;
}

// 관리자 API와 Iris 명령이 공유하는 서버 배정 변경 유스케이스입니다.
export class ChangePlayerServerService {
  constructor(private readonly database: DatabaseClient) {}

  async execute(command: ChangePlayerServerCommand): Promise<ChangePlayerServerResult> {
    return this.database.withTransaction(async (transaction) => {
      const scope = `player.server.change:${command.playerId}`;
      const prior = await transaction.query<Array<{ result_json: string | ChangePlayerServerResult }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE",
        [scope, command.idempotencyKey]
      );
      if (prior[0]?.result_json !== undefined) {
        return typeof prior[0].result_json === "string" ? JSON.parse(prior[0].result_json) : prior[0].result_json;
      }

      const server = await transaction.query<Array<{ id: bigint; code: string }>>(
        "SELECT id, code FROM game_servers WHERE code = ? AND active = TRUE",
        [command.serverCode]
      );
      if (server[0] === undefined) {
        throw new ApplicationError("INVALID_SERVER", "활성화된 서버 코드를 입력해야 합니다.", 422);
      }
      const operation = await transaction.execute(
        `INSERT INTO operations
           (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, created_at)
         VALUES (?, ?, ?, 'admin_operator', ?, ?, 'processing', UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, command.idempotencyKey, command.actorId, command.sourceCode]
      );
      const update = await transaction.execute(
        `UPDATE player_profiles SET game_server_id = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3)
         WHERE player_id = ? AND version = ?`,
        [server[0].id, command.playerId, command.expectedVersion]
      );
      if (update.affectedRows !== 1n) {
        throw new ApplicationError("PROFILE_VERSION_CONFLICT", "회원 정보가 먼저 변경되었습니다.", 409);
      }
      const version = (BigInt(command.expectedVersion) + 1n).toString();
      const audit = await transaction.execute(
        `INSERT INTO command_audit
           (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at)
         VALUES (?, 'admin_operator', ?, 'player', ?, 'player.server.change', 'success', ?, ?, UTC_TIMESTAMP(3))`,
        [operation.insertId, command.actorId, command.playerId, command.reason,
          JSON.stringify({ serverCode: server[0].code, profileVersion: version })]
      );
      if (command.sourceEventId !== undefined) {
        await transaction.execute(
          `INSERT INTO command_executions
            (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at)
           VALUES (?, 'change_player_server', ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          [command.sourceEventId, operation.insertId]
        );
      }
      const result: ChangePlayerServerResult = { serverCode: server[0].code, profileVersion: version, auditId: audit.insertId.toString() };
      await transaction.execute(
        `INSERT INTO outbox_messages
          (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at)
         VALUES (?, 'internal', ?, 'player.server.changed', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [operation.insertId, command.playerId, JSON.stringify(result)]
      );
      if (command.irisReply !== undefined) {
        const replyOutbox = await transaction.execute(
          `INSERT INTO outbox_messages
            (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at)
           VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          [operation.insertId, command.irisReply.destinationId, JSON.stringify({ data: command.irisReply.data })]
        );
        result.replyOutboxId = replyOutbox.insertId.toString();
      }
      await transaction.execute(
        "UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?",
        [JSON.stringify(result), operation.insertId]
      );
      return result;
    });
  }
}
