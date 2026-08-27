import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";

export interface PlayerLevelResetResult {
  status: "reset";
  data: string;
  resetCount: string;
  previousLevelTotal: string;
  previousAccumulatedTotal: string;
  accumulatedTotal: string;
  operationId: string;
  executionId: string;
  auditId: string;
  outboxId: string;
}

// 레거시 무인자 명령과 동일하게 정확한 `/레벨리셋`만 허용합니다.
export function isPlayerLevelResetCommand(message: string | undefined): boolean {
  return message === "/레벨리셋";
}

function boundedKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stored(value: string | PlayerLevelResetResult): PlayerLevelResetResult {
  return typeof value === "string" ? JSON.parse(value) as PlayerLevelResetResult : value;
}

// 활성 회원의 현재 레벨을 누적 레벨에 더하고 현재 레벨을 1로 원자 초기화합니다.
export class PlayerLevelResetService {
  constructor(private readonly database: DatabaseClient) {}

  async reset(input: { eventId: string; externalUserId: string; destinationId: string }): Promise<PlayerLevelResetResult | null> {
    const operators = await this.database.query<Array<{ operator_id: bigint }>>(`SELECT operator.id operator_id
      FROM external_identities identity
      JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
      JOIN admin_operators operator ON operator.id=mapping.operator_id
      JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
      JOIN admin_roles role ON role.id=operator_role.role_id
      JOIN admin_role_permissions permission ON permission.role_id=role.id
      WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
        AND operator.status='active' AND role.code='super_admin' AND role.active=TRUE
        AND permission.permission_code='game.player.level.reset_all'
      LIMIT 1`, [input.externalUserId]);
    const operator = operators[0];
    if (operator === undefined) return null;

    return this.database.withTransaction(async transaction => {
      const scope = `player.level.reset:${operator.operator_id.toString()}`;
      const idempotencyKey = boundedKey(input.eventId);
      await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)", [randomUUID(), scope, idempotencyKey, operator.operator_id]);
      const operations = await transaction.query<Array<{ id: bigint; result_json: string | PlayerLevelResetResult | null }>>("SELECT id,result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, idempotencyKey]);
      const operation = operations[0];
      if (operation === undefined) throw new Error("Player level reset operation claim failed.");
      if (operation.result_json !== null) return stored(operation.result_json);

      const profiles = await transaction.query<Array<{ player_id: bigint; level: bigint; accumulated_level_offset: bigint; version: bigint }>>(`SELECT profile.player_id,profile.level,profile.accumulated_level_offset,profile.version
        FROM player_profiles profile JOIN players player ON player.id=profile.player_id
        WHERE player.status='active' ORDER BY profile.player_id FOR UPDATE`);
      let previousLevelTotal = 0n;
      let previousAccumulatedTotal = 0n;
      for (const profile of profiles) {
        previousLevelTotal += profile.level;
        previousAccumulatedTotal += profile.accumulated_level_offset;
        const update = await transaction.execute("UPDATE player_profiles SET accumulated_level_offset=?,level=1,version=version+1 WHERE player_id=? AND version=?", [profile.accumulated_level_offset + profile.level, profile.player_id, profile.version]);
        if (update.affectedRows !== 1n) throw new Error("Player level reset version conflict.");
      }

      const accumulatedTotal = previousAccumulatedTotal + previousLevelTotal;
      const execution = await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'PLAYER_LEVEL_RESET',?,'completed','reset',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, operation.id]);
      const audit = await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'player_profiles',NULL,'player.level.reset_all','reset','Iris /레벨리셋',?,UTC_TIMESTAMP(3))", [operation.id, operator.operator_id, JSON.stringify({ resetCount: profiles.length.toString(), previousLevelTotal: previousLevelTotal.toString(), previousAccumulatedTotal: previousAccumulatedTotal.toString(), accumulatedTotal: accumulatedTotal.toString(), currentLevel: "1" })]);
      const data = "리셋완.";
      const outbox = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operation.id, input.destinationId, JSON.stringify({ data })]);
      const result: PlayerLevelResetResult = { status: "reset", data, resetCount: profiles.length.toString(), previousLevelTotal: previousLevelTotal.toString(), previousAccumulatedTotal: previousAccumulatedTotal.toString(), accumulatedTotal: accumulatedTotal.toString(), operationId: operation.id.toString(), executionId: execution.insertId.toString(), auditId: audit.insertId.toString(), outboxId: outbox.insertId.toString() };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.id]);
      return result;
    });
  }
}
