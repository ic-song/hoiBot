import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { CommandDispatcher, MariaCommandDispatchRepository } from "../dispatch/command-dispatcher.js";

export type DataStatusEnvironment = "prod" | "dev";
export type DataStatusTarget = "member" | "member_pet" | "petSkillData" | "petHomeActivityData";
export type DataStatusSlot = "original" | "backup1" | "backup2";

export interface DataStatusObject {
  target: DataStatusTarget;
  slot: DataStatusSlot;
  exists: boolean;
  validJson: boolean;
  modifiedAt: string | null;
  errorCode: string | null;
}

export interface DataStatusSnapshot {
  environment: DataStatusEnvironment;
  revisionKey: string | null;
  capturedAt: string | null;
  objects: DataStatusObject[];
}

export interface DataStatusResult extends DataStatusSnapshot {
  data: string;
  outboxId: string;
}

const TARGETS: readonly DataStatusTarget[] = ["member", "member_pet", "petSkillData", "petHomeActivityData"];
const SLOTS: readonly DataStatusSlot[] = ["original", "backup1", "backup2"];
const TARGET_LABEL: Record<DataStatusTarget, string> = { member: "member", member_pet: "member_pet", petSkillData: "petSkillData", petHomeActivityData: "petHomeActivityData" };
const SLOT_LABEL: Record<DataStatusSlot, string> = { original: "원본", backup1: "1차", backup2: "2차" };

// 운영과 DEV의 정확한 데이터 상태 명령만 현대화 dispatch 후보로 허용합니다.
export function parseDataStatusCommand(message: string | undefined): DataStatusEnvironment | null {
  if (message === "/데이터상태") return "prod";
  if (message === "dev/데이터상태") return "dev";
  return null;
}

export function isDataStatusCommand(message: string | undefined): boolean {
  return parseDataStatusCommand(message) !== null;
}

// 한 revision의 4개 대상과 3개 슬롯을 고정 순서로 표시하고 내부 오류 상세는 노출하지 않습니다.
export function formatDataStatus(snapshot: DataStatusSnapshot): string {
  const environmentLabel = snapshot.environment === "dev" ? "DEV" : "운영";
  if (snapshot.revisionKey === null) {
    return `📦 데이터 상태 [${environmentLabel}]\n상태 스냅샷이 없습니다.\n백업 생성 후 다시 확인해주세요.`;
  }
  const lines = [`📦 데이터 상태 [${environmentLabel}]`, `revision: ${snapshot.revisionKey}`, `확인시각: ${snapshot.capturedAt ?? "-"}`];
  for (const target of TARGETS) {
    lines.push("", `◼ ${TARGET_LABEL[target]}`);
    for (const slot of SLOTS) {
      const object = snapshot.objects.find((candidate) => candidate.target === target && candidate.slot === slot);
      const state = object === undefined || !object.exists ? "누락" : object.validJson ? "정상" : "손상";
      lines.push(`- ${SLOT_LABEL[slot]}: ${state} (${object?.modifiedAt ?? "-"})`);
    }
  }
  lines.push("", "복구 전 /데이터상태를 확인하고 /데이터복구 [파일] [1|2]를 사용하세요.");
  return lines.join("\n");
}

// 권한 확인 후 immutable backup revision을 조회하고 접근 감사와 응답 outbox를 원자 기록합니다.
export class DataStatusService {
  constructor(private readonly database: DatabaseClient) {}

  async handleIris(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<
    { status: "changed"; data: string; outboxId: string } | { status: "shadow" | "legacy_fallback" | "handled_no_reply" }
  > {
    const decision = await new CommandDispatcher(new MariaCommandDispatchRepository(this.database), { enabled: true, allowAllCanaries: false, canaryUserIds: new Set() }).resolve({
      eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true
    });
    if (decision.route === "SHADOW") return { status: "shadow" };
    if (decision.route !== "MODERN") return { status: "legacy_fallback" };
    const environment = parseDataStatusCommand(input.message);
    if (environment === null) return { status: "legacy_fallback" };
    const result = await this.read({ eventId: input.eventId, externalUserId: input.externalUserId, destinationId: input.channelId, environment });
    if (result === null) return { status: "handled_no_reply" };
    return { status: "changed", data: result.data, outboxId: result.outboxId };
  }

  async read(input: { eventId: string; externalUserId: string; destinationId: string; environment: DataStatusEnvironment }): Promise<DataStatusResult | null> {
    const operator = (await this.database.query<Array<{ id: bigint }>>(
      `SELECT operator.id FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator ON operator.id=mapping.operator_id
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' AND operator.status='active'
       AND NOT EXISTS (SELECT 1 FROM admin_operator_permission_overrides denied WHERE denied.operator_id=operator.id AND denied.permission_code='backup_status.read' AND denied.effect='deny')
       AND (EXISTS (SELECT 1 FROM admin_operator_permission_overrides allowed WHERE allowed.operator_id=operator.id AND allowed.permission_code='backup_status.read' AND allowed.effect='allow')
         OR EXISTS (SELECT 1 FROM admin_operator_roles operator_role JOIN admin_roles role ON role.id=operator_role.role_id AND role.active=TRUE JOIN admin_role_permissions permission ON permission.role_id=role.id AND permission.permission_code='backup_status.read' WHERE operator_role.operator_id=operator.id))
       LIMIT 1`, [input.externalUserId]
    ))[0];
    if (operator === undefined) return null;
    const idempotencyKey = input.eventId.length <= 191 ? input.eventId : `sha256:${createHash("sha256").update(input.eventId).digest("hex")}`;
    return withDeadlockRetry(() => this.database.withTransaction(async (transaction) => {
      const previous = (await transaction.query<Array<{ result_json: string | DataStatusResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope='backup_status.read' AND idempotency_key=? FOR UPDATE", [idempotencyKey]
      ))[0];
      if (previous?.result_json != null) return typeof previous.result_json === "string" ? JSON.parse(previous.result_json) : previous.result_json;
      const generation = (await transaction.query<Array<{ id: bigint; revision_key: string; captured_at: string }>>(
        "SELECT id,revision_key,DATE_FORMAT(completed_at,'%Y-%m-%d %H:%i:%s') captured_at FROM backup_generations WHERE environment_code=? AND generation_status='complete' ORDER BY completed_at DESC,id DESC LIMIT 1",
        [input.environment]
      ))[0];
      const rows = generation === undefined ? [] : await transaction.query<Array<{
        target_code: DataStatusTarget; slot_code: DataStatusSlot; object_exists: number; valid_json: number | null; modified_at: string | null; error_code: string | null;
      }>>(
        `SELECT object_row.target_code,object_row.slot_code,object_row.object_exists,
                health.valid_json,DATE_FORMAT(object_row.modified_at,'%Y-%m-%d %H:%i:%s') modified_at,health.error_code
           FROM backup_objects object_row LEFT JOIN backup_health_checks health ON health.backup_object_id=object_row.id
          WHERE object_row.generation_id=? ORDER BY FIELD(object_row.target_code,'member','member_pet','petSkillData','petHomeActivityData'),FIELD(object_row.slot_code,'original','backup1','backup2')`,
        [generation.id]
      );
      const objects = rows.map((row) => ({ target: row.target_code, slot: row.slot_code, exists: row.object_exists === 1, validJson: row.valid_json === 1, modifiedAt: row.modified_at, errorCode: row.error_code }));
      const snapshot: DataStatusSnapshot = { environment: input.environment, revisionKey: generation?.revision_key ?? null, capturedAt: generation?.captured_at ?? null, objects };
      const data = formatDataStatus(snapshot);
      const operation = await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'backup_status.read',?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), idempotencyKey, operator.id]);
      const outbox = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operation.insertId,input.destinationId,JSON.stringify({ data })]);
      await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'ADMIN_DATA_STATUS',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId,operation.insertId]);
      const summary = { readOnly: true, environment: input.environment, revisionKey: snapshot.revisionKey, healthy: objects.filter((object) => object.exists && object.validJson).length, missing: 12 - objects.filter((object) => object.exists).length, damaged: objects.filter((object) => object.exists && !object.validJson).length };
      await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'backup_revision',?,'backup_status.read','success','Iris /데이터상태',?,UTC_TIMESTAMP(3))", [operation.insertId,operator.id,generation?.id ?? null,JSON.stringify(summary)]);
      const result: DataStatusResult = { ...snapshot, data, outboxId: outbox.insertId.toString() };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result),operation.insertId]);
      return result;
    }));
  }
}

async function withDeadlockRetry<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt=0;attempt<3;attempt+=1) { try { return await work(); } catch (error) { const dbError=error as {code?:unknown;errno?:unknown}; if(attempt===2||(dbError.code!=="ER_LOCK_DEADLOCK"&&dbError.errno!==1213))throw error; } }
  throw new Error("Backup status read deadlock retry exhausted.");
}
