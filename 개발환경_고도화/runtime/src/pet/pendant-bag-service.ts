import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";

const ALL_SEE = "\u200b".repeat(500);
const BAG_LIMIT = 50;
const GRADE_ORDER = ["창조", "창세", "초월", "신화", "최상급+", "최상급", "상급+", "상급", "중급+", "중급", "하급+", "하급", "최하급"];

export interface PendantBagCommand { targetName: string | null; }
export interface PendantBagEntry {
  instanceId: string;
  name: string;
  icon: string;
  grade: string;
  durability: bigint;
  maxDurability: bigint;
  upgrade: bigint;
}
export interface PendantBagResult { status: "replied" | "silent"; data?: string; outboxId?: string; rowCount: number; }

// 레거시 무인자와 하나의 자유 형식 대상 인자 guard만 허용합니다.
export function parsePendantBagCommand(message: string | undefined): PendantBagCommand | null {
  if (message === "/펜던트가방") return { targetName: null };
  if (message === undefined) return null;
  const match = message.match(/^\/펜던트가방\s+(.+)$/);
  return match === null ? null : { targetName: match[1]!.trim() };
}

// partial dispatch 후보를 전체 명령 형식으로 제한합니다.
export function isPendantBagCommandCandidate(message: string | undefined): boolean {
  return parsePendantBagCommand(message) !== null;
}

// 펜던트 이름과 아이콘을 중복 없이 결합합니다.
function displayName(entry: PendantBagEntry): string {
  return entry.icon !== "" && entry.name.endsWith(entry.icon) ? entry.name : `${entry.name}${entry.icon}`;
}

// 레거시 등급·이름 정렬과 6번째 행 앞 allsee 경계를 안정 instance ID로 재현합니다.
export function formatPendantBagMessage(rankDisplay: string, source: PendantBagEntry[]): string {
  const rank = (grade: string) => { const index = GRADE_ORDER.indexOf(grade); return index < 0 ? GRADE_ORDER.length : index; };
  const rows = source.slice().sort((a, b) => {
    const gradeDiff = rank(a.grade) - rank(b.grade);
    if (gradeDiff !== 0) return gradeDiff;
    if (a.name < b.name) return -1;
    if (a.name > b.name) return 1;
    return BigInt(a.instanceId) < BigInt(b.instanceId) ? -1 : BigInt(a.instanceId) > BigInt(b.instanceId) ? 1 : 0;
  });
  let out = `[${rankDisplay}] 보유 펜던트가방💎[${rows.length}/${BAG_LIMIT}]\n`;
  out += "━━━━━━━━━━━━━\n";
  out += "※ 펜던트 장착: /펜던트장착 [펜던트가방번호]\n";
  out += "※ 펜던트 판매: /펜던트판매 [번호]\n";
  out += "※ 펜던트 정보: /펜던트정보 [번호]\n";
  out += "※ 펜던트 강화: /펜던트강화 [펜던트가방번호] (장착 펜던트는 0)\n";
  out += "※ 펜던트 정리: /펜던트가방정리 [번호~번호]\n";
  out += "※ 펜던트 해제: /펜던트해제 (귀속권 필요)\n";
  out += "━━━━━━━━━━━━━\n";
  if (rows.length === 0) return `${out}보유한 펜던트가 없습니다.`;
  rows.forEach((entry, index) => {
    if (index === 5) out += `${ALL_SEE}\n`;
    out += `${index + 1}. ${displayName(entry)}[${entry.grade}][⚒️${entry.durability}/${entry.maxDurability}](+${entry.upgrade})\n`;
  });
  return out.trim();
}

// 긴 이벤트 ID를 operations 멱등 키 길이에 맞게 정규화합니다.
function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// MariaDB JSON 결과를 멱등 재실행 응답으로 복원합니다.
function stored(value: string | PendantBagResult): PendantBagResult {
  return typeof value === "string" ? JSON.parse(value) as PendantBagResult : value;
}

// 펜던트 가방 projection을 권한·멱등·감사·outbox transaction으로 조회합니다.
export class PendantBagService {
  constructor(private readonly database: DatabaseClient) {}

  async read(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<PendantBagResult> {
    const command = parsePendantBagCommand(input.message);
    if (command === null) return { status: "silent", rowCount: 0 };
    return this.database.withTransaction(async (transaction) => {
      const actors = await transaction.query<Array<{ identity_id: bigint; player_id: bigint; current_display_name: string }>>(`SELECT identity.id identity_id,profile.player_id,profile.current_display_name
        FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active'
        JOIN player_profiles profile ON profile.player_id=player.id
        WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1 FOR UPDATE`, [input.externalUserId]);
      const actor = actors[0];
      if (actor === undefined) return { status: "silent", rowCount: 0 };
      if (command.targetName !== null) {
        const roles = await transaction.query<Array<{ allowed: bigint }>>(`SELECT COUNT(*) allowed FROM admin_operator_external_identities link
          JOIN admin_operators operator_row ON operator_row.id=link.operator_id AND operator_row.status='active'
          JOIN admin_operator_roles assignment ON assignment.operator_id=operator_row.id
          JOIN admin_roles role ON role.id=assignment.role_id AND role.code='super_admin' AND role.active=TRUE
          WHERE link.external_identity_id=?`, [actor.identity_id]);
        if (BigInt(roles[0]?.allowed ?? 0n) === 0n) return { status: "silent", rowCount: 0 };
      }

      const targets = command.targetName === null
        ? await transaction.query<Array<{ player_id: bigint; rank_display: string; pet_id: bigint | null }>>(`SELECT profile.player_id,CONCAT(COALESCE(rank_profile.rank_emoji,''),profile.current_display_name) rank_display,pet.id pet_id
            FROM player_profiles profile LEFT JOIN player_pets pet ON pet.player_id=profile.player_id
            LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=profile.player_id
            WHERE profile.player_id=? LIMIT 1 FOR UPDATE`, [actor.player_id])
        : await transaction.query<Array<{ player_id: bigint; rank_display: string; pet_id: bigint | null }>>(`SELECT profile.player_id,CONCAT(COALESCE(rank_profile.rank_emoji,''),profile.current_display_name) rank_display,pet.id pet_id
            FROM player_profiles profile JOIN players player ON player.id=profile.player_id AND player.status='active'
            LEFT JOIN player_pets pet ON pet.player_id=profile.player_id
            LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=profile.player_id
            WHERE profile.current_display_name=? LIMIT 1 FOR UPDATE`, [command.targetName]);
      const target = targets[0];
      const key = eventKey(input.eventId);
      const prior = await transaction.query<Array<{ result_json: string | PendantBagResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope='pendant.bag_read' AND idempotency_key=? FOR UPDATE", [key]);
      if (prior[0]?.result_json != null) return stored(prior[0].result_json);
      const operation = await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'pendant.bag_read',?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), key, actor.identity_id]);
      let entries: PendantBagEntry[] = [];
      let data = "펫 데이터가 없습니다.";
      if (target !== undefined && target.pet_id !== null) {
        const rows = await transaction.query<Array<{ instance_id: bigint; item_name: string; name_value: string | null; icon_value: string | null; grade_value: string | null; durability_value: string | null; max_durability_value: string | null; upgrade_value: string | null }>>(`SELECT instance.id instance_id,item.display_name item_name,
            JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.name')) name_value,
            JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.icon')) icon_value,
            JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.grade')) grade_value,
            JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.durability')) durability_value,
            JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.maxDurability')) max_durability_value,
            JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.upgrade')) upgrade_value
          FROM inventory_instances instance JOIN item_definitions item ON item.id=instance.item_id AND item.active=TRUE
          WHERE instance.player_id=? AND instance.status='owned'
            AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.objectType')),JSON_UNQUOTE(JSON_EXTRACT(item.metadata_json,'$.objectType')))='pendant'
          FOR UPDATE`, [target.player_id]);
        entries = rows.map((row) => ({ instanceId: row.instance_id.toString(), name: row.name_value ?? row.item_name,
          icon: row.icon_value ?? "", grade: row.grade_value ?? "", durability: BigInt(row.durability_value ?? "5"),
          maxDurability: BigInt(row.max_durability_value ?? "5"), upgrade: BigInt(row.upgrade_value ?? "0") }));
        data = formatPendantBagMessage(target.rank_display, entries);
      }
      const outbox = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operation.insertId, input.destinationId, JSON.stringify({ data })]);
      await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'PENDANT_BAG_READ',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, operation.insertId]);
      await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,'pendant.bag_read','success','Iris /펜던트가방',?,UTC_TIMESTAMP(3))",
        [operation.insertId, actor.identity_id, target?.player_id ?? null, JSON.stringify({ targetName: command.targetName, rowCount: entries.length, readOnly: true })]);
      const result: PendantBagResult = { status: "replied", data, outboxId: outbox.insertId.toString(), rowCount: entries.length };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}
