import { randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { sortPendantBagEntries, type PendantBagEntry } from "./pendant-bag-service.js";

const CHARM_INCREMENTS = [0n, 5000n, 10000n, 15000n, 20000n, 25000n, 30000n, 250000n, 375000n, 500000n, 750000n,
  1000000n, 1250000n, 1500000n, 2000000n, 2500000n, 3000000n, 3500000n, 4000000n, 4500000n, 5000000n,
  6000000n, 7000000n, 8000000n, 9000000n, 10000000n, 12500000n, 15000000n, 17500000n, 25000000n, 30000000n] as const;

interface Operator { operator_id: bigint; }
interface PendantRow {
  instance_id: bigint; player_id: bigint; pet_id: bigint; version: bigint; status: string; item_name: string;
  name_value: string | null; icon_value: string | null; grade_value: string | null;
  durability_value: string | null; max_durability_value: string | null; upgrade_value: string | null;
  charm_value: string | null; explore_value: string | null;
}
interface Target { row: PendantRow; entry: PendantBagEntry; }
export interface PendantEnhanceCorrectionResult {
  status: "changed" | "usage" | "not_found" | "silent";
  data?: string; outboxId?: string; instanceId?: string; beforeLevel?: number; afterLevel?: number;
}

// 레거시 outer guard처럼 인자가 있는 강화수정 후보만 허용합니다.
export function isPendantEnhanceCorrectionCommandCandidate(message: string | undefined): boolean {
  return message !== undefined && /^\/펜던트강화수정\s+.+$/.test(message);
}

// 인자형 후보를 DB command alias의 대표 명령으로 정규화합니다.
export function normalizePendantEnhanceCorrectionDispatchMessage(message: string): string {
  return isPendantEnhanceCorrectionCommandCandidate(message) ? "/펜던트강화수정" : message;
}

// 레거시 쉼표 형식과 0~30 강화 보정을 bigint 안전하게 해석합니다.
export function parsePendantEnhanceCorrectionCommand(message: string): { targetName: string; index: bigint; level: number } | undefined {
  const match = /^\/펜던트강화수정\s+(.+),\s*(\d+),\s*(\d+)$/.exec(message);
  if (match === null) return undefined;
  const targetName = match[1]!.trim();
  if (targetName.length === 0) return undefined;
  const rawLevel = BigInt(match[3]!);
  return { targetName, index: BigInt(match[2]!), level: rawLevel > 30n ? 30 : Number(rawLevel) };
}

// 펜던트 표시 문자열을 레거시 형식으로 생성합니다.
function display(target: Target, level: number): string {
  const icon = target.entry.icon !== "" && target.entry.name.endsWith(target.entry.icon) ? "" : target.entry.icon;
  return `${target.entry.name}${icon}[${target.entry.grade}][⚒️${target.entry.durability}/${target.entry.maxDurability}](+${level})`;
}

// 장착 projection용 누적 강화 매력과 탐험 수치를 계산합니다.
function stats(target: Target, level: number): { charm: bigint; explore: number } {
  let charm = BigInt(target.row.charm_value ?? "0");
  for (let index = 1; index <= level; index++) charm += CHARM_INCREMENTS[index]!;
  return { charm, explore: Number(target.row.explore_value ?? "0") + (level === 0 ? 0 : level / 10) };
}

// 응답·감사·execution·operation을 동일 트랜잭션에 완료합니다.
async function complete(transaction: DatabaseTransaction, input: {
  operationId: bigint; eventId: string; destinationId: string; operatorId: bigint; targetId: string | null;
  resultCode: string; data: string; result: PendantEnhanceCorrectionResult; summary: Record<string, unknown>;
}): Promise<PendantEnhanceCorrectionResult> {
  const outbox = await transaction.execute(
    "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [input.operationId, input.destinationId, JSON.stringify({ data: input.data })]
  );
  await transaction.execute(
    "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'PENDANT_ENHANCE_CORRECTION',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [input.eventId, input.operationId, input.resultCode]
  );
  await transaction.execute(
    "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'inventory_instance',?,'pet.pendant.enhancement.correct',?,'Iris 총괄 운영자 /펜던트강화수정',?,UTC_TIMESTAMP(3))",
    [input.operationId, input.operatorId, input.targetId, input.resultCode, JSON.stringify(input.summary)]
  );
  const result = { ...input.result, data: input.data, outboxId: outbox.insertId.toString() };
  await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), input.operationId]);
  return result;
}

// 총괄 운영자의 펜던트 강화수치 보정을 stable instance에 원자 반영합니다.
export class PendantEnhanceCorrectionService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<PendantEnhanceCorrectionResult> {
    if (!isPendantEnhanceCorrectionCommandCandidate(input.message)) return { status: "silent" };
    const operators = await this.database.query<Operator[]>(
      `SELECT operator.id operator_id FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active'
       JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
       JOIN admin_role_permissions permission ON permission.role_id=operator_role.role_id
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
         AND permission.permission_code='pet.pendant.enhancement.correct' LIMIT 1`, [input.externalUserId]
    );
    const operator = operators[0];
    if (operator === undefined) return { status: "silent" };
    return this.database.withTransaction(async (transaction) => {
      const prior = await transaction.query<Array<{ result_json: string | PendantEnhanceCorrectionResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope='pendant.enhancement.correct' AND idempotency_key=? FOR UPDATE", [input.eventId]
      );
      if (prior[0]?.result_json != null) return typeof prior[0].result_json === "string" ? JSON.parse(prior[0].result_json) : prior[0].result_json;
      const operation = await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'pendant.enhancement.correct',?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), input.eventId, operator.operator_id]
      );
      const parsed = parsePendantEnhanceCorrectionCommand(input.message);
      if (parsed === undefined) return complete(transaction, {
        operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, operatorId: operator.operator_id,
        targetId: null, resultCode: "usage", data: "사용법: /펜던트강화수정 아이디, 펜던트가방번호, 강화수치",
        result: { status: "usage" }, summary: { mutation: false }
      });
      const target = await this.resolveTarget(transaction, parsed.targetName, parsed.index);
      if (target === undefined) return complete(transaction, {
        operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, operatorId: operator.operator_id,
        targetId: null, resultCode: "not_found", data: "대상 펫 데이터가 없습니다.", result: { status: "not_found" },
        summary: { targetName: parsed.targetName, sourceIndex: parsed.index.toString(), mutation: false }
      });
      const beforeLevel = Math.max(0, Math.min(30, Number(target.entry.upgrade)));
      const update = await transaction.execute(
        "UPDATE inventory_instances SET attributes_json=JSON_SET(COALESCE(attributes_json,JSON_OBJECT()),'$.upgrade',?),version=version+1 WHERE id=? AND player_id=? AND version=?",
        [parsed.level, target.row.instance_id, target.row.player_id, target.row.version]
      );
      if (update.affectedRows !== 1n) throw new Error("PENDANT_ENHANCE_CORRECTION_CONFLICT");
      const projected = stats(target, parsed.level);
      if (target.row.status === "equipped") {
        await transaction.execute(
          "UPDATE player_pet_pendants SET enhancement_level=?,raid_charm=?,castle_charm=?,version=version+1 WHERE player_pet_id=? AND inventory_instance_id=?",
          [parsed.level, projected.charm / 2n, projected.charm - projected.charm / 2n, target.row.pet_id, target.row.instance_id]
        );
      }
      await transaction.execute(
        "INSERT INTO pendant_enhancement_corrections(operation_id,player_id,inventory_instance_id,source_index,level_before,level_after,instance_version_before,instance_version_after) VALUES (?,?,?,?,?,?,?,?)",
        [operation.insertId, target.row.player_id, target.row.instance_id, parsed.index, beforeLevel, parsed.level, target.row.version, target.row.version + 1n]
      );
      const data = `펜던트 강화수정 완료\n${display(target, parsed.level)}`;
      return complete(transaction, {
        operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, operatorId: operator.operator_id,
        targetId: target.row.instance_id.toString(), resultCode: "changed", data,
        result: { status: "changed", instanceId: target.row.instance_id.toString(), beforeLevel, afterLevel: parsed.level },
        summary: { targetName: parsed.targetName, sourceIndex: parsed.index.toString(), beforeLevel, afterLevel: parsed.level, instanceVersionAfter: (target.row.version + 1n).toString() }
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
              JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.upgrade')) upgrade_value,
              JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.charm')) charm_value,
              JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.explore')) explore_value
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
