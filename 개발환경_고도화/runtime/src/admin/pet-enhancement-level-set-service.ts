import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { MariaCommandDispatchRepository, type RolloutState } from "../dispatch/command-dispatcher.js";

const COMMAND_CODE = "ADMIN_PET_ENHANCEMENT_SET";
const HANDLER_KEY = "admin_pet_enhancement_set";
const MAX_UNSIGNED_BIGINT = 18446744073709551615n;
const USAGE = "올바른 명령어 형식을 사용해주세요. 예: /펫강화속성 [유저명] [강화수]";

export interface PetEnhancementLevelSetCommand {
  targetName: string;
  level: bigint;
}

export interface PetEnhancementLevelSetResult {
  status: "changed" | "missing_pet" | "ambiguous_target" | "usage";
  data: string;
  targetPlayerId: string | null;
  targetPetId: string | null;
  previousLevel: string | null;
  level: string | null;
  previousVersion: string | null;
  version: string | null;
  operationId: string;
  executionId: string;
  auditId: string;
  outboxId: string;
}

export function isPetEnhancementLevelSetCommandCandidate(message: string | undefined): boolean {
  return message !== undefined && message.startsWith("/펫강화속성");
}

export function parsePetEnhancementLevelSetCommand(message: string): PetEnhancementLevelSetCommand | null {
  const match = message.match(/^\/펫강화속성\s+([^\d]+?)\s+(\d+)$/);
  if (match === null) return null;
  const level = BigInt(match[2]!);
  if (level > MAX_UNSIGNED_BIGINT) return null;
  return { targetName: match[1]!.trim(), level };
}

function normalizeEventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function parseStored<T>(value: string | T): T {
  return typeof value === "string" ? JSON.parse(value) as T : value;
}

// 총괄 운영자의 펫 강화 수치 절대값 변경을 versioned transaction으로 처리합니다.
export class PetEnhancementLevelSetService {
  constructor(private readonly database: DatabaseClient) {}

  async handleIris(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<
    { status: "changed"; data: string; outboxId: string } | { status: "shadow" | "legacy_fallback" | "handled_no_reply" }
  > {
    const definitions = await this.database.query<Array<{ rollout_state: RolloutState; enabled: number }>>(
      "SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1", [COMMAND_CODE]);
    const definition = definitions[0];
    const dispatch = new MariaCommandDispatchRepository(this.database);
    if (definition === undefined || definition.enabled !== 1 || definition.rollout_state === "LEGACY_ONLY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "LEGACY_FALLBACK", reasonCode: "ROLLOUT_LEGACY_ONLY", commandCode: COMMAND_CODE, handlerKey: HANDLER_KEY });
      return { status: "legacy_fallback" };
    }
    if (definition.rollout_state === "SHADOW" || definition.rollout_state === "CANARY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "SHADOW", reasonCode: "ROLLOUT_SHADOW", commandCode: COMMAND_CODE, handlerKey: HANDLER_KEY });
      return { status: "shadow" };
    }
    const operators = await this.database.query<Array<{ operator_id: bigint }>>(
      `SELECT operator.id operator_id FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator ON operator.id=mapping.operator_id
       JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
       JOIN admin_roles role ON role.id=operator_role.role_id
       JOIN admin_role_permissions permission ON permission.role_id=role.id
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
         AND operator.status='active' AND role.code='super_admin' AND role.active=TRUE
         AND permission.permission_code='pet.enhancement.set' LIMIT 1`, [input.externalUserId]);
    const operator = operators[0];
    if (operator === undefined) return { status: "handled_no_reply" };
    await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
      { route: "MODERN", reasonCode: "MODERN_ROUTE_ALLOWED", commandCode: COMMAND_CODE, handlerKey: HANDLER_KEY });
    const result = await this.set({ message: input.message, idempotencyKey: input.eventId, sourceEventId: input.eventId,
      destinationId: input.channelId, operatorId: operator.operator_id.toString() });
    return { status: "changed", data: result.data, outboxId: result.outboxId };
  }

  async set(input: { message: string; idempotencyKey: string; sourceEventId: string; destinationId: string; operatorId: string }): Promise<PetEnhancementLevelSetResult> {
    return this.database.withTransaction(async transaction => {
      const scope = `admin.pet_enhancement.set:${input.operatorId}`;
      const key = normalizeEventKey(input.idempotencyKey);
      await transaction.execute(
        `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`, [randomUUID(),scope,key,input.operatorId]);
      const operations = await transaction.query<Array<{ id: bigint; result_json: string | PetEnhancementLevelSetResult | null }>>(
        "SELECT id,result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope,key]);
      const operation = operations[0];
      if (operation === undefined) throw new Error("Pet enhancement operation claim failed.");
      if (operation.result_json !== null) return parseStored(operation.result_json);

      const command = parsePetEnhancementLevelSetCommand(input.message);
      const targets = command === null ? [] : await transaction.query<Array<{
        player_id: bigint; pet_id: bigint | null; enhancement_level: bigint | null; version: bigint | null;
      }>>(
        `SELECT profile.player_id,pet.id pet_id,pet.enhancement_level,pet.version
         FROM player_profiles profile
         JOIN players player ON player.id=profile.player_id AND player.status='active'
         LEFT JOIN player_pets pet ON pet.player_id=player.id
         WHERE profile.current_display_name=? ORDER BY profile.player_id LIMIT 2 FOR UPDATE`, [command.targetName]);

      let status: PetEnhancementLevelSetResult["status"] = command === null ? "usage" : "missing_pet";
      let data = command === null ? USAGE : "펫이 없습니다.";
      const target = targets.length === 1 ? targets[0] : undefined;
      if (targets.length > 1) status = "ambiguous_target";
      if (command !== null && target?.pet_id !== null && target?.pet_id !== undefined && target.enhancement_level !== null && target.version !== null) {
        status = "changed";
        data = "펫강화속성 완료";
        const update = await transaction.execute(
          "UPDATE player_pets SET enhancement_level=?,version=version+1 WHERE id=? AND version=?",
          [command.level,target.pet_id,target.version]);
        if (update.affectedRows !== 1n) throw new Error("Pet enhancement level version conflict.");
      }

      const execution = await transaction.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'ADMIN_PET_ENHANCEMENT_SET',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [input.sourceEventId,operation.id,status]);
      const previousLevel = target?.enhancement_level?.toString() ?? null;
      const previousVersion = target?.version?.toString() ?? null;
      const nextVersion = status === "changed" && target?.version !== null && target?.version !== undefined ? (target.version + 1n).toString() : previousVersion;
      const audit = await transaction.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'player_pet',?,'pet.enhancement_level.set',?,'Iris /펫강화속성',?,UTC_TIMESTAMP(3))",
        [operation.id,input.operatorId,target?.pet_id ?? null,status,JSON.stringify({ targetName:command?.targetName ?? null,
          playerId:target?.player_id.toString() ?? null,petId:target?.pet_id?.toString() ?? null,previousLevel,
          level:command?.level.toString() ?? null,previousVersion,version:nextVersion })]);
      const outbox = await transaction.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operation.id,input.destinationId,JSON.stringify({ data })]);
      const result: PetEnhancementLevelSetResult = {
        status,data,targetPlayerId:target?.player_id.toString() ?? null,targetPetId:target?.pet_id?.toString() ?? null,
        previousLevel,level:command?.level.toString() ?? null,previousVersion,version:nextVersion,
        operationId:operation.id.toString(),executionId:execution.insertId.toString(),auditId:audit.insertId.toString(),outboxId:outbox.insertId.toString()
      };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
        [JSON.stringify(result),operation.id]);
      return result;
    });
  }
}
