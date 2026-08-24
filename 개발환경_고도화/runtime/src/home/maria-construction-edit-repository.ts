import { createHash, randomUUID } from "node:crypto";
import { readAuthorization } from "../admin/auth-service.js";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import type { ConstructionEditRepository, ConstructionEditRequest, ConstructionEditResult } from "./construction-edit.js";
import { buildConstructionEditCompletedMessage } from "./construction-edit-policy.js";

// 긴 event ID를 operations 멱등 키 길이에 맞게 정규화합니다.
function normalizeEventKey(eventId: string): string {
  return eventId.length <= 191 ? eventId : `sha256:${createHash("sha256").update(eventId).digest("hex")}`;
}

// MariaDB JSON 결과를 건설 수정 결과로 복원합니다.
function parseStoredResult(value: string | ConstructionEditResult): ConstructionEditResult {
  return typeof value === "string" ? JSON.parse(value) as ConstructionEditResult : value;
}

// 동시 멱등 operation 생성 경합인지 판별합니다.
function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null
    && (("errno" in error && error.errno === 1062) || ("code" in error && error.code === "ER_DUP_ENTRY"));
}

// 기존 player_homes와 공용 원장으로 건설 수정을 원자적으로 저장합니다.
export class MariaConstructionEditRepository implements ConstructionEditRepository {
  constructor(private readonly database: DatabaseClient) {}

  async findAuthorizedOperator(externalUserId: string): Promise<string | null> {
    const rows = await this.database.query<Array<{ operator_id: bigint }>>(
      `SELECT mapping.operator_id
         FROM external_identities identity
         JOIN admin_operator_external_identities mapping ON mapping.external_identity_id = identity.id
         JOIN admin_operators operator ON operator.id = mapping.operator_id
        WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ?
          AND identity.status = 'linked' AND operator.status = 'active'
        LIMIT 1`,
      [externalUserId]
    );
    const operatorId = rows[0]?.operator_id.toString();
    if (operatorId === undefined) return null;
    const authorization = await readAuthorization(this.database, operatorId);
    return authorization.permissions.includes("game.home.moderate") ? operatorId : null;
  }

  async adjust(input: ConstructionEditRequest): Promise<ConstructionEditResult> {
    const scope = `home.construction-edit:${input.operatorId}`;
    const eventKey = normalizeEventKey(input.eventId);
    try {
      return await this.database.withTransaction(async (transaction) => {
        const prior = await transaction.query<Array<{ result_json: string | ConstructionEditResult | null }>>(
          "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE",
          [scope, eventKey]
        );
        if (prior[0]?.result_json != null) return parseStoredResult(prior[0].result_json);

        const targets = await transaction.query<Array<{ player_id: bigint; current_display_name: string }>>(
          `SELECT player_id, current_display_name FROM player_profiles
            WHERE current_display_name = ? ORDER BY player_id LIMIT 2 FOR UPDATE`,
          [input.targetName]
        );
        if (targets.length === 0) return { status: "player_not_found", data: `❌ 대상 유저 [${input.targetName}]님이 존재하지 않습니다.` };
        if (targets.length > 1) throw new ApplicationError("PLAYER_NAME_AMBIGUOUS", "동일 표시명의 회원이 여러 명이므로 관리자 화면에서 player ID로 변경해야 합니다.", 409);
        const target = targets[0]!;
        const homes = await transaction.query<Array<{
          display_name: string | null; base_experience: bigint; floor_area: bigint; version: bigint;
        }>>(
          "SELECT display_name, base_experience, floor_area, version FROM player_homes WHERE player_id = ? FOR UPDATE",
          [target.player_id]
        );
        const previous = homes[0];
        const operation = await transaction.execute(
          `INSERT INTO operations
            (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, created_at)
           VALUES (?, ?, ?, 'admin_operator', ?, 'iris', 'processing', UTC_TIMESTAMP(3))`,
          [randomUUID(), scope, eventKey, input.operatorId]
        );
        let baseExperience = previous?.base_experience ?? 0n;
        if (previous === undefined) {
          await transaction.execute(
            `INSERT INTO player_homes (player_id, display_name, base_experience, like_count, floor_area, version)
             VALUES (?, ?, 0, 0, ?, 1)`,
            [target.player_id, input.homeName, input.floorArea]
          );
        } else {
          const updated = await transaction.execute(
            `UPDATE player_homes SET display_name = ?, floor_area = ?, version = version + 1
              WHERE player_id = ? AND version = ?`,
            [input.homeName, input.floorArea, target.player_id, previous.version]
          );
          if (updated.affectedRows !== 1n) throw new Error("Construction edit home version conflict.");
        }
        const data = buildConstructionEditCompletedMessage({
          targetName: target.current_display_name,
          floorArea: input.floorArea,
          homeName: input.homeName,
          baseExperience: baseExperience.toString()
        });
        const outbox = await transaction.execute(
          `INSERT INTO outbox_messages
            (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at)
           VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          [operation.insertId, input.channelId, JSON.stringify({ data })]
        );
        await transaction.execute(
          `INSERT INTO command_executions
            (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at)
           VALUES (?, 'construction_edit', ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          [input.eventId, operation.insertId]
        );
        const audit = await transaction.execute(
          `INSERT INTO command_audit
            (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at)
           VALUES (?, 'admin_operator', ?, 'player_home', ?, 'home.construction-edit', 'success', 'Iris /건설수정', ?, UTC_TIMESTAMP(3))`,
          [operation.insertId, input.operatorId, target.player_id, JSON.stringify({
            previousFloorArea: previous?.floor_area.toString() ?? "0",
            previousHomeName: previous?.display_name ?? "서울역 4번출구🚉",
            floorArea: input.floorArea,
            homeName: input.homeName,
            furnitureRelationsPreserved: true
          })]
        );
        const result: ConstructionEditResult = {
          status: "completed", data, playerId: target.player_id.toString(), floorArea: input.floorArea,
          homeName: input.homeName, baseExperience: baseExperience.toString(),
          auditId: audit.insertId.toString(), outboxId: outbox.insertId.toString()
        };
        await transaction.execute(
          "UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?",
          [JSON.stringify(result), operation.insertId]
        );
        return result;
      });
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const prior = await this.database.query<Array<{ result_json: string | ConstructionEditResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ?",
        [scope, eventKey]
      );
      if (prior[0]?.result_json == null) throw error;
      return parseStoredResult(prior[0].result_json);
    }
  }
}
