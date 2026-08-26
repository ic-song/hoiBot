import { randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { sortPendantBagEntries, type PendantBagEntry } from "./pendant-bag-service.js";

interface Operator { operator_id: bigint; }
interface PendantRow {
  instance_id: bigint; player_id: bigint; pet_id: bigint; version: bigint; status: string; item_name: string;
  name_value: string | null; icon_value: string | null; grade_value: string | null;
  durability_value: string | null; max_durability_value: string | null; upgrade_value: string | null;
}
interface Target { row: PendantRow; entry: PendantBagEntry; }
export interface PendantDurabilityCorrectionResult {
  status: "changed" | "usage" | "not_found" | "silent";
  data?: string; outboxId?: string; instanceId?: string; beforeDurability?: number; afterDurability?: number;
}

// 레거시 outer guard처럼 인자가 있는 내구도수정 후보만 허용합니다.
export function isPendantDurabilityCorrectionCommandCandidate(message: string | undefined): boolean {
  return message !== undefined && /^\/펜던트내구도수정\s+.+$/.test(message);
}

// 인자형 후보를 DB command alias의 대표 명령으로 정규화합니다.
export function normalizePendantDurabilityCorrectionDispatchMessage(message: string): string {
  return isPendantDurabilityCorrectionCommandCandidate(message) ? "/펜던트내구도수정" : message;
}

// 레거시 쉼표 형식의 대상, 가방번호, 내구도를 bigint 안전하게 해석합니다.
export function parsePendantDurabilityCorrectionCommand(message: string): { targetName: string; index: bigint; durability: bigint } | undefined {
  const match = /^\/펜던트내구도수정\s+(.+),\s*(\d+),\s*(\d+)$/.exec(message);
  if (match === null) return undefined;
  const targetName = match[1]!.trim();
  if (targetName.length === 0) return undefined;
  return { targetName, index: BigInt(match[2]!), durability: BigInt(match[3]!) };
}

// 펜던트 표시 문자열을 레거시 형식으로 생성합니다.
function display(target: Target, durability: number): string {
  const icon = target.entry.icon !== "" && target.entry.name.endsWith(target.entry.icon) ? "" : target.entry.icon;
  return `${target.entry.name}${icon}[${target.entry.grade}][⚒️${durability}/${target.entry.maxDurability}](+${target.entry.upgrade})`;
}

// 응답·감사·execution·operation을 동일 트랜잭션에 완료합니다.
async function complete(transaction: DatabaseTransaction, input: {
  operationId: bigint; eventId: string; destinationId: string; operatorId: bigint; targetId: string | null;
  resultCode: string; data: string; result: PendantDurabilityCorrectionResult; summary: Record<string, unknown>;
}): Promise<PendantDurabilityCorrectionResult> {
  const outbox = await transaction.execute(
    "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [input.operationId, input.destinationId, JSON.stringify({ data: input.data })]
  );
  await transaction.execute(
    "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'PENDANT_DURABILITY_CORRECTION',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [input.eventId, input.operationId, input.resultCode]
  );
  await transaction.execute(
    "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'inventory_instance',?,'pet.pendant.durability.correct',?,'Iris 총괄 운영자 /펜던트내구도수정',?,UTC_TIMESTAMP(3))",
    [input.operationId, input.operatorId, input.targetId, input.resultCode, JSON.stringify(input.summary)]
  );
  const result = { ...input.result, data: input.data, outboxId: outbox.insertId.toString() };
  await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), input.operationId]);
  return result;
}

// 총괄 운영자의 펜던트 내구도를 stable instance와 장착 projection에 원자 반영합니다.
export class PendantDurabilityCorrectionService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<PendantDurabilityCorrectionResult> {
    if (!isPendantDurabilityCorrectionCommandCandidate(input.message)) return { status: "silent" };
    const operators = await this.database.query<Operator[]>(
      `SELECT operator.id operator_id FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active'
       JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
       JOIN admin_role_permissions permission ON permission.role_id=operator_role.role_id
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
         AND permission.permission_code='pet.pendant.durability.correct' LIMIT 1`, [input.externalUserId]
    );
    const operator = operators[0];
    if (operator === undefined) return { status: "silent" };
    return this.database.withTransaction(async (transaction) => {
      const prior = await transaction.query<Array<{ result_json: string | PendantDurabilityCorrectionResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope='pendant.durability.correct' AND idempotency_key=? FOR UPDATE", [input.eventId]
      );
      if (prior[0]?.result_json != null) return typeof prior[0].result_json === "string" ? JSON.parse(prior[0].result_json) : prior[0].result_json;
      const operation = await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'pendant.durability.correct',?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), input.eventId, operator.operator_id]
      );
      const parsed = parsePendantDurabilityCorrectionCommand(input.message);
      if (parsed === undefined) return complete(transaction, {
        operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, operatorId: operator.operator_id,
        targetId: null, resultCode: "usage", data: "사용법: /펜던트내구도수정 아이디, 펜던트가방번호, 내구",
        result: { status: "usage" }, summary: { mutation: false }
      });
      const target = await this.resolveTarget(transaction, parsed.targetName, parsed.index);
      if (target === undefined) return complete(transaction, {
        operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, operatorId: operator.operator_id,
        targetId: null, resultCode: "not_found", data: "대상 펫 데이터가 없습니다.", result: { status: "not_found" },
        summary: { targetName: parsed.targetName, sourceIndex: parsed.index.toString(), mutation: false }
      });
      const maxDurability = target.entry.maxDurability > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(target.entry.maxDurability);
      const beforeDurability = Math.max(0, Math.min(maxDurability, Number(target.entry.durability)));
      const afterDurability = parsed.durability > BigInt(maxDurability) ? maxDurability : Number(parsed.durability);
      const update = await transaction.execute(
        "UPDATE inventory_instances SET attributes_json=JSON_SET(COALESCE(attributes_json,JSON_OBJECT()),'$.durability',?),version=version+1 WHERE id=? AND player_id=? AND version=?",
        [afterDurability, target.row.instance_id, target.row.player_id, target.row.version]
      );
      if (update.affectedRows !== 1n) throw new Error("PENDANT_DURABILITY_CORRECTION_CONFLICT");
      if (target.row.status === "equipped") {
        await transaction.execute(
          "UPDATE player_pet_pendants SET durability=?,version=version+1 WHERE player_pet_id=? AND inventory_instance_id=?",
          [afterDurability, target.row.pet_id, target.row.instance_id]
        );
      }
      await transaction.execute(
        "INSERT INTO pendant_durability_corrections(operation_id,player_id,inventory_instance_id,source_index,durability_before,durability_after,max_durability,instance_version_before,instance_version_after) VALUES (?,?,?,?,?,?,?,?,?)",
        [operation.insertId, target.row.player_id, target.row.instance_id, parsed.index, beforeDurability, afterDurability, maxDurability, target.row.version, target.row.version + 1n]
      );
      const data = `펜던트 내구도수정 완료\n${display(target, afterDurability)}`;
      return complete(transaction, {
        operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, operatorId: operator.operator_id,
        targetId: target.row.instance_id.toString(), resultCode: "changed", data,
        result: { status: "changed", instanceId: target.row.instance_id.toString(), beforeDurability, afterDurability },
        summary: { targetName: parsed.targetName, sourceIndex: parsed.index.toString(), beforeDurability, afterDurability, maxDurability,
          instanceVersionAfter: (target.row.version + 1n).toString() }
      });
    });
  }

  // 표시명과 정렬 순번으로 장착 또는 가방 stable instance를 잠급니다.
  private async resolveTarget(transaction: DatabaseTransaction, targetName: string, index: bigint): Promise<Target | undefined> {
    const rows = await transaction.query<PendantRow[]>(
      `SELECT instance.id instance_id,instance.player_id,pet.id pet_id,instance.version,instance.status,item.display_name item_name,
              JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.name')) name_value,
              JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.icon')) icon_value,
              JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.grade')) grade_value,
              JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.durability')) durability_value,
              JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.maxDurability')) max_durability_value,
              JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.upgrade')) upgrade_value
         FROM player_profiles profile JOIN players player ON player.id=profile.player_id AND player.status='active'
         JOIN player_pets pet ON pet.player_id=player.id
         JOIN inventory_instances instance ON instance.player_id=player.id AND instance.status IN ('owned','equipped')
         JOIN item_definitions item ON item.id=instance.item_id AND item.active=TRUE
        WHERE profile.current_display_name=?
          AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.objectType')),JSON_UNQUOTE(JSON_EXTRACT(item.metadata_json,'$.objectType')))='pendant'
        FOR UPDATE`, [targetName]
    );
    if (rows.length === 0) return undefined;
    const targets = rows.map((value) => this.toTarget(value));
    if (index === 0n) return targets.filter((value) => value.row.status === "equipped").sort((a, b) => a.row.instance_id < b.row.instance_id ? -1 : 1)[0];
    const owned = sortPendantBagEntries(targets.filter((value) => value.row.status === "owned").map((value) => value.entry));
    const selected = index > BigInt(owned.length) ? undefined : owned[Number(index - 1n)];
    return selected === undefined ? undefined : targets.find((value) => value.entry.instanceId === selected.instanceId);
  }

  // SQL 결과를 공용 펜던트 가방 정렬 형식으로 변환합니다.
  private toTarget(row: PendantRow): Target {
    return { row, entry: { instanceId: row.instance_id.toString(), name: row.name_value ?? row.item_name, icon: row.icon_value ?? "",
      grade: row.grade_value ?? "", durability: BigInt(row.durability_value ?? "5"), maxDurability: BigInt(row.max_durability_value ?? "5"),
      upgrade: BigInt(row.upgrade_value ?? "0") } };
  }
}
