import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { MariaCommandDispatchRepository, type RolloutState } from "../dispatch/command-dispatcher.js";

const COMMAND_CODE = "SPIRIT_ATTRIBUTE_EDIT";
const HANDLER_KEY = "spirit_attribute_edit";
const USAGE = "올바른 명령어 형식을 사용해주세요. 예: /정령속성 [유저명] [강화수]";
const MAX_UNSIGNED_BIGINT = 18446744073709551615n;

export interface SpiritAttributeCommand {
  targetName: string;
  level: bigint;
}

export interface SpiritAttributeEditResult {
  status: "changed" | "missing_target" | "missing_elemental";
  targetPlayerId: string | null;
  previousLevel: string | null;
  level: string | null;
  auditId: string;
}

interface UsageResult {
  status: "usage";
  data: string;
  outboxId: string;
  auditId: string;
}

// 레거시 startsWith 외부 guard를 유지해 잘못된 형식도 Master 사용법 응답 대상으로 분류합니다.
export function isSpiritAttributeCommandCandidate(message: string | undefined): boolean {
  return message !== undefined && message.startsWith("/정령속성");
}

// 숫자가 없는 대상명과 마지막 unsigned 강화 수치의 전체 형식만 파싱합니다.
export function parseSpiritAttributeCommand(message: string): SpiritAttributeCommand | null {
  const match = message.match(/^\/정령속성\s+([^\d]+?)\s+(\d+)$/);
  if (match === null) return null;
  const level = BigInt(match[2]!);
  if (level > MAX_UNSIGNED_BIGINT) return null;
  return { targetName: match[1]!.trim(), level };
}

// 긴 이벤트 ID를 operations 멱등 키 길이에 맞게 정규화합니다.
function normalizeEventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// MariaDB JSON 결과를 멱등 재실행 응답으로 복원합니다.
function parseStored<T>(value: string | T): T {
  return typeof value === "string" ? JSON.parse(value) as T : value;
}

// Master 전용 정령 강화 수치 변경을 안정 player/elemental 키로 원자 처리합니다.
export class SpiritAttributeService {
  constructor(private readonly database: DatabaseClient) {}

  async handleIris(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<
    { status: "changed"; data: string; outboxId: string } | { status: "shadow" | "legacy_fallback" | "handled_no_reply" }
  > {
    const rollout = await this.database.query<Array<{ rollout_state: RolloutState; enabled: number }>>(
      "SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1", [COMMAND_CODE]);
    const definition = rollout[0];
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
    const operators = await this.database.query<Array<{ operator_id: bigint; identity_id: bigint }>>(
      `SELECT operator.id operator_id,identity.id identity_id FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator ON operator.id=mapping.operator_id
       JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
       JOIN admin_roles role ON role.id=operator_role.role_id
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
         AND operator.status='active' AND role.code='super_admin' AND role.active=TRUE LIMIT 1`, [input.externalUserId]);
    const operator = operators[0];
    if (operator === undefined) return { status: "handled_no_reply" };
    await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
      { route: "MODERN", reasonCode: "MODERN_ROUTE_ALLOWED", commandCode: COMMAND_CODE, handlerKey: HANDLER_KEY });
    const parsed = parseSpiritAttributeCommand(input.message);
    if (parsed === null) {
      const usage = await this.replyUsage({ operatorId: operator.operator_id.toString(), identityId: operator.identity_id.toString(),
        destinationId: input.channelId, sourceEventId: input.eventId, idempotencyKey: input.eventId });
      return { status: "changed", data: usage.data, outboxId: usage.outboxId };
    }
    await this.setLevel({ operatorId: operator.operator_id.toString(), identityId: operator.identity_id.toString(), sourceEventId: input.eventId,
      idempotencyKey: input.eventId, targetName: parsed.targetName, level: parsed.level });
    return { status: "handled_no_reply" };
  }

  async setLevel(input: { operatorId: string; identityId: string; sourceEventId: string; idempotencyKey: string; targetName: string; level: bigint }): Promise<SpiritAttributeEditResult> {
    return this.database.withTransaction(async (transaction) => {
      const scope = `admin.spirit_attribute:${input.operatorId}`;
      const key = normalizeEventKey(input.idempotencyKey);
      const prior = await transaction.query<Array<{ result_json: string | SpiritAttributeEditResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope,key]);
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) return parseStored(prior[0].result_json);
      const targets = await transaction.query<Array<{ player_id: bigint; pet_id: bigint | null; elemental_level: bigint | null; elemental_version: bigint | null }>>(
        `SELECT profile.player_id,pet.id pet_id,elemental.enhancement_level elemental_level,elemental.version elemental_version
         FROM player_profiles profile LEFT JOIN player_pets pet ON pet.player_id=profile.player_id
         LEFT JOIN player_pet_elementals elemental ON elemental.player_pet_id=pet.id
         WHERE profile.current_display_name=? ORDER BY profile.player_id LIMIT 2 FOR UPDATE`, [input.targetName]);
      let status: SpiritAttributeEditResult["status"] = "missing_target";
      let targetPlayerId: string | null = null, previousLevel: string | null = null, level: string | null = null;
      const target = targets.length === 1 ? targets[0] : undefined;
      if (target !== undefined) {
        targetPlayerId = target.player_id.toString();
        if (target.pet_id !== null && target.elemental_level !== null && target.elemental_version !== null) {
          status = "changed"; previousLevel = BigInt(target.elemental_level).toString(); level = input.level.toString();
        } else status = "missing_elemental";
      }
      const operation = await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(),scope,key,input.operatorId]);
      if (status === "changed" && target !== undefined) {
        const update = await transaction.execute("UPDATE player_pet_elementals SET enhancement_level=?,version=version+1 WHERE player_pet_id=? AND version=?",
          [input.level,target.pet_id,target.elemental_version]);
        if (update.affectedRows !== 1n) throw new Error("Spirit attribute elemental version conflict.");
      }
      await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'spirit_attribute_edit',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [input.sourceEventId,operation.insertId,status]);
      const audit = await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'player',?,'pet.spirit_attribute.edit',?,'Iris /정령속성',?,UTC_TIMESTAMP(3))",
        [operation.insertId,input.operatorId,targetPlayerId,status,JSON.stringify({ targetName:input.targetName,previousLevel,level })]);
      const result: SpiritAttributeEditResult={status,targetPlayerId,previousLevel,level,auditId:audit.insertId.toString()};
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),operation.insertId]);
      return result;
    });
  }

  private async replyUsage(input: { operatorId: string; identityId: string; destinationId: string; sourceEventId: string; idempotencyKey: string }): Promise<UsageResult> {
    return this.database.withTransaction(async (transaction) => {
      const scope=`admin.spirit_attribute.usage:${input.operatorId}`,key=normalizeEventKey(input.idempotencyKey);
      const prior=await transaction.query<Array<{result_json:string|UsageResult|null}>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",[scope,key]);
      if(prior[0]?.result_json!==undefined&&prior[0].result_json!==null)return parseStored(prior[0].result_json);
      const operation=await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))",[randomUUID(),scope,key,input.operatorId]);
      const outbox=await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[operation.insertId,input.destinationId,JSON.stringify({data:USAGE})]);
      await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'spirit_attribute_edit',?,'completed','usage',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.sourceEventId,operation.insertId]);
      const audit=await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'command',NULL,'pet.spirit_attribute.edit','usage','Iris /정령속성 형식 오류',JSON_OBJECT(),UTC_TIMESTAMP(3))",[operation.insertId,input.operatorId]);
      const result:UsageResult={status:"usage",data:USAGE,outboxId:outbox.insertId.toString(),auditId:audit.insertId.toString()};
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),operation.insertId]);return result;
    });
  }
}
