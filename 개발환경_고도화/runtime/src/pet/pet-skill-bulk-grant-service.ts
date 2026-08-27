import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";

const BAG_LIMIT = 100n;
const UINT64_MAX = 18446744073709551615n;
const SINGLE_USAGE = "사용법: /펫스킬가방추가 [아이디], [펫스킬이름] [갯수]\n예: /펫스킬가방추가 호이 남, 장미칼 1";
const BULK_USAGE = "사용법: /펫스킬일괄지급\n닉네임, 펫스킬이름 개수\n닉네임, 펫스킬이름 개수\n...\n\n예시:\n/펫스킬일괄지급\n마라 여, 만렙헌터 1\n마라 여, 무소유 2\n째째 남, 건물주 5";

interface Operator { operator_id: bigint; }
interface SkillDefinition { id: bigint; display_name: string; }
interface TargetRow { player_id: bigint; player_pet_id: bigint; current_display_name: string; rank_emoji: string | null; }
interface InventoryRow { skill_id: bigint; quantity: bigint; }
interface ParsedLine { targetName: string; skillName: string; count: bigint; }
interface TargetState extends TargetRow { bagQuantity: bigint; }
interface LineEvidence { lineNumber: number; rawLine: string; status: "success" | "failure"; reasonCode: string; target?: TargetState; skill?: SkillDefinition; count?: bigint; before?: bigint; after?: bigint; }

export interface PetSkillBulkGrantResult {
  status: "completed" | "usage" | "silent";
  reply?: string;
  outboxId?: string;
  successCount?: number;
  failureCount?: number;
}

// 레거시의 단일 지급과 줄바꿈 일괄 지급 후보를 서로 침범하지 않게 분류합니다.
export function isPetSkillBulkGrantCandidate(message: string | undefined): boolean {
  return message !== undefined && (message.startsWith("/펫스킬가방추가 ") || message.startsWith("/펫스킬일괄지급"));
}

// 두 운영 명령을 각각의 DB 대표 별칭으로 정규화합니다.
export function normalizePetSkillBulkGrantDispatchMessage(message: string): string {
  if (message.startsWith("/펫스킬가방추가 ")) return "/펫스킬가방추가";
  if (message.startsWith("/펫스킬일괄지급")) return "/펫스킬일괄지급";
  return message;
}

// 쉼표 뒤의 스킬명과 마지막 uint64 수량을 레거시 형식대로 해석합니다.
export function parsePetSkillGrantLine(rawLine: string): ParsedLine | null {
  const match = /^(.+?),\s*(.+?)\s+(\d+)\s*$/.exec(rawLine.trim());
  if (match === null) return null;
  const count = BigInt(match[3]!);
  if (count > UINT64_MAX) return null;
  return { targetName: match[1]!.trim(), skillName: match[2]!.trim(), count };
}

function eventKey(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function commas(value: bigint): string { return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function lookupKey(value: string): string { return value.replace(/^\[펫스킬북\]/, "").replace(/[📙✨]/g, "").replace(/[^\p{L}\p{N}]/gu, "").toLocaleLowerCase("ko"); }
function formattedSkill(name: string): string { return name.endsWith("📙") ? name : `${name}📙`; }
function stored(value: string | PetSkillBulkGrantResult): PetSkillBulkGrantResult { return typeof value === "string" ? JSON.parse(value) as PetSkillBulkGrantResult : value; }

async function finish(transaction: DatabaseTransaction, input: { operationId: bigint; eventId: string; destinationId: string; operatorId: bigint; commandCode: string; reply: string; result: PetSkillBulkGrantResult; summary: Record<string, unknown>; }): Promise<PetSkillBulkGrantResult> {
  const outbox = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.operationId, input.destinationId, JSON.stringify({ data: input.reply })]);
  await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, input.commandCode, input.operationId]);
  await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'pet_skill_inventory',NULL,'pet.skill.bulk_grant','success','Iris 총괄 운영자 펫스킬 지급',?,UTC_TIMESTAMP(3))", [input.operationId, input.operatorId, JSON.stringify(input.summary)]);
  const result = { ...input.result, reply: input.reply, outboxId: outbox.insertId.toString() };
  await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), input.operationId]);
  return result;
}

// 운영자 지급 요청을 행별 판정하고 성공한 펫스킬 적재와 모든 증적을 한 DB 트랜잭션으로 처리합니다.
export class PetSkillBulkGrantService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<PetSkillBulkGrantResult> {
    if (!isPetSkillBulkGrantCandidate(input.message)) return { status: "silent" };
    const operator = (await this.database.query<Operator[]>(`SELECT operator.id operator_id FROM external_identities identity JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active' JOIN admin_operator_roles role_link ON role_link.operator_id=operator.id JOIN admin_role_permissions permission ON permission.role_id=role_link.role_id WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' AND permission.permission_code='pet.skill.grant' LIMIT 1`, [input.externalUserId]))[0];
    if (operator === undefined) return { status: "silent" };

    return this.database.withTransaction(async (transaction) => {
      const key = eventKey(input.eventId);
      const prior = await transaction.query<Array<{ result_json: string | PetSkillBulkGrantResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope='pet.skill.bulk_grant' AND idempotency_key=? FOR UPDATE", [key]);
      if (prior[0]?.result_json != null) return stored(prior[0].result_json);
      const operation = await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'pet.skill.bulk_grant',?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), key, operator.operator_id]);
      const single = input.message.startsWith("/펫스킬가방추가 ");
      const commandCode = single ? "PET_SKILL_BAG_GRANT" : "PET_SKILL_BULK_GRANT";
      const lines = single ? [input.message.substring("/펫스킬가방추가".length).trim()] : input.message.split("\n").slice(1).filter((line) => line.trim().length > 0).map((line) => line.trim());
      if (lines.length === 0) {
        await transaction.execute("INSERT INTO pet_skill_bulk_grant_operations(operation_id,command_mode,requested_count,success_count,failure_count) VALUES (?,'bulk',0,0,0)", [operation.insertId]);
        return finish(transaction, { operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, operatorId: operator.operator_id, commandCode, reply: BULK_USAGE, result: { status: "usage", successCount: 0, failureCount: 0 }, summary: { mutation: false, requestedCount: 0 } });
      }

      const definitions = await transaction.query<SkillDefinition[]>("SELECT id,display_name FROM skill_definitions WHERE active=TRUE AND JSON_EXTRACT(rules_json,'$.grade') IS NOT NULL ORDER BY id FOR UPDATE");
      const skills = new Map(definitions.map((row) => [lookupKey(row.display_name), row]));
      const targets = new Map<string, TargetState | null>();
      const evidence: LineEvidence[] = [];
      const successDetails: string[] = [];
      const failureDetails: string[] = [];
      let successCount = 0;
      let failureCount = 0;
      let ledgerSequence = 0;

      for (let index = 0; index < lines.length; index += 1) {
        const rawLine = lines[index]!;
        const parsed = parsePetSkillGrantLine(rawLine);
        if (parsed === null) {
          failureCount += 1;
          failureDetails.push(`${index + 1}줄: 형식 오류 — ${rawLine}`);
          evidence.push({ lineNumber: index + 1, rawLine, status: "failure", reasonCode: "invalid_format" });
          continue;
        }
        if (parsed.count < 1n) {
          failureCount += 1;
          failureDetails.push(`${index + 1}줄: 개수 오류 — ${parsed.count}`);
          evidence.push({ lineNumber: index + 1, rawLine, status: "failure", reasonCode: "invalid_quantity", count: parsed.count });
          continue;
        }
        let target = targets.get(parsed.targetName);
        if (target === undefined) {
          const row = (await transaction.query<TargetRow[]>(`SELECT profile.player_id,pet.id player_pet_id,profile.current_display_name,rank_profile.rank_emoji FROM player_profiles profile JOIN players player ON player.id=profile.player_id AND player.status='active' AND player.deleted_at IS NULL JOIN player_pets pet ON pet.player_id=player.id LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=player.id WHERE profile.current_display_name=? ORDER BY pet.id LIMIT 1 FOR UPDATE`, [parsed.targetName]))[0];
          if (row === undefined) target = null;
          else {
            const inventory = await transaction.query<InventoryRow[]>("SELECT skill_id,quantity FROM pet_skill_inventory WHERE player_pet_id=? ORDER BY skill_id FOR UPDATE", [row.player_pet_id]);
            target = { ...row, bagQuantity: inventory.reduce((sum, item) => sum + BigInt(item.quantity), 0n) };
          }
          targets.set(parsed.targetName, target);
        }
        if (target === null) {
          failureCount += 1;
          failureDetails.push(`${index + 1}줄: 유저 없음 — ${parsed.targetName}`);
          evidence.push({ lineNumber: index + 1, rawLine, status: "failure", reasonCode: "target_not_found", count: parsed.count });
          continue;
        }
        const skill = skills.get(lookupKey(parsed.skillName));
        if (skill === undefined) {
          failureCount += 1;
          failureDetails.push(`${index + 1}줄: 펫스킬 없음 — ${parsed.skillName}`);
          evidence.push({ lineNumber: index + 1, rawLine, status: "failure", reasonCode: "skill_not_found", target, count: parsed.count });
          continue;
        }
        const remaining = BAG_LIMIT - target.bagQuantity;
        if (remaining < parsed.count) {
          failureCount += 1;
          failureDetails.push(`${index + 1}줄: ${parsed.targetName} 가방 공간 부족 (남은 공간 ${remaining < 0n ? 0n : remaining}개)`);
          evidence.push({ lineNumber: index + 1, rawLine, status: "failure", reasonCode: "bag_capacity", target, skill, count: parsed.count, before: target.bagQuantity, after: target.bagQuantity });
          continue;
        }
        const before = target.bagQuantity;
        target.bagQuantity += parsed.count;
        await transaction.execute("INSERT INTO pet_skill_inventory(player_pet_id,skill_id,quantity,version,updated_at) VALUES (?,?,?,1,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE quantity=quantity+VALUES(quantity),version=version+1,updated_at=VALUES(updated_at)", [target.player_pet_id, skill.id, parsed.count]);
        ledgerSequence += 1;
        await transaction.execute("INSERT INTO pet_skill_inventory_ledger(operation_id,sequence_no,player_id,player_pet_id,skill_id,quantity_delta,reason_code) VALUES (?,?,?,?,?,?,'PET_SKILL_ADMIN_GRANT')", [operation.insertId, ledgerSequence, target.player_id, target.player_pet_id, skill.id, parsed.count]);
        successCount += 1;
        successDetails.push(`${parsed.targetName}: ${formattedSkill(skill.display_name)} x${commas(parsed.count)}`);
        evidence.push({ lineNumber: index + 1, rawLine, status: "success", reasonCode: "granted", target, skill, count: parsed.count, before, after: target.bagQuantity });
      }

      await transaction.execute("INSERT INTO pet_skill_bulk_grant_operations(operation_id,command_mode,requested_count,success_count,failure_count) VALUES (?,?,?,?,?)", [operation.insertId, single ? "single" : "bulk", lines.length, successCount, failureCount]);
      for (const row of evidence) {
        await transaction.execute(`INSERT INTO pet_skill_bulk_grant_lines(operation_id,line_no,raw_line,line_status,reason_code,target_player_id,target_pet_id,skill_id,requested_quantity,bag_quantity_before,bag_quantity_after) VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [operation.insertId, row.lineNumber, row.rawLine, row.status, row.reasonCode, row.target?.player_id ?? null, row.target?.player_pet_id ?? null, row.skill?.id ?? null, row.count ?? null, row.before ?? null, row.after ?? null]);
      }

      let reply: string;
      if (single) {
        const row = evidence[0]!;
        const parsed = parsePetSkillGrantLine(lines[0]!);
        if (row.status === "success") reply = `✅ 펫스킬가방 추가 완료\n[${row.target!.rank_emoji ?? ""}${row.target!.current_display_name}] 님에게\n${formattedSkill(row.skill!.display_name)} x${commas(row.count!)} 지급\n\n/펫스킬가방에서 확인하세요.`;
        else if (row.reasonCode === "target_not_found") reply = `❌ 해당 유저가 없습니다: ${parsed?.targetName ?? ""}`;
        else if (row.reasonCode === "skill_not_found") reply = `❌ 등록되지 않은 펫스킬입니다: ${parsed?.skillName ?? ""}\n/펫스킬확률에서 목록을 확인해주세요.`;
        else if (row.reasonCode === "invalid_quantity") reply = "❌ 추가 갯수는 1개 이상이어야 합니다.";
        else if (row.reasonCode === "bag_capacity") reply = `❌ [${row.target!.rank_emoji ?? ""}${row.target!.current_display_name}] 님의 스킬가방 공간이 부족합니다.\n현재: ${commas(row.before!)}/${BAG_LIMIT}\n남은 공간: ${commas(BAG_LIMIT - row.before!)}개`;
        else reply = SINGLE_USAGE;
      } else {
        reply = `🔧 펫스킬 일괄 지급 결과\n━━━━━━━━━━━━━\n✅ 성공: ${successCount}건\n❌ 실패: ${failureCount}건`;
        if (successDetails.length > 0) reply += `\n\n[성공 내역]\n${successDetails.join("\n")}`;
        if (failureDetails.length > 0) reply += `\n\n[실패 내역]\n${failureDetails.join("\n")}`;
      }
      return finish(transaction, { operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, operatorId: operator.operator_id, commandCode, reply, result: { status: "completed", successCount, failureCount }, summary: { mode: single ? "single" : "bulk", requestedCount: lines.length, successCount, failureCount } });
    });
  }
}
