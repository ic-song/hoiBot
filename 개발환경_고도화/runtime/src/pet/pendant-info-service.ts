import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { formatPendantMarketInfo } from "../market/pendant-market-info-service.js";
import { sortPendantBagEntries, type PendantBagEntry } from "./pendant-bag-service.js";

type Parsed = { kind: "usage" } | { kind: "lookup"; index: bigint };
export interface PendantInfoRow {
  instance_id: bigint; item_name: string | null; name_value: string | null; icon_value: string | null;
  grade_value: string | null; durability_value: string | null; max_durability_value: string | null; upgrade_value: string | null;
}
export interface PendantInfoResult { status: "usage" | "not_found" | "found" | "silent"; data?: string; outboxId?: string; instanceId?: string; }

// 레거시 outer guard와 숫자 전용 inner guard를 분리해 사용법 응답을 보존합니다.
export function parsePendantInfoCommand(message: string | undefined): Parsed | undefined {
  if (message === "/펜던트정보") return { kind: "usage" };
  if (message === undefined || !/^\/펜던트정보\s+.+$/.test(message)) return undefined;
  const match = /^\/펜던트정보\s+(\d+)$/.exec(message);
  return match === null ? { kind: "usage" } : { kind: "lookup", index: BigInt(match[1]!) };
}

// outer guard에 진입하는 요청만 partial dispatch 후보로 제한합니다.
export function isPendantInfoCommandCandidate(message: string | undefined): boolean { return parsePendantInfoCommand(message) !== undefined; }

// 숫자 인자 요청을 대표 alias로 정규화합니다.
export function normalizePendantInfoDispatchMessage(message: string): string { return isPendantInfoCommandCandidate(message) ? "/펜던트정보" : message; }

// stable 가방 정렬 번호를 원본 DB 행으로 되돌립니다.
export function selectPendantInfoRow(rows: PendantInfoRow[], index: bigint): PendantInfoRow | undefined {
  if (index < 1n || index > BigInt(rows.length)) return undefined;
  const entries: PendantBagEntry[] = rows.map((row) => ({ instanceId: row.instance_id.toString(), name: row.name_value ?? row.item_name ?? "",
    icon: row.icon_value ?? "", grade: row.grade_value ?? "", durability: BigInt(row.durability_value ?? "5"),
    maxDurability: BigInt(row.max_durability_value ?? "5"), upgrade: BigInt(row.upgrade_value ?? "0") }));
  const selected = sortPendantBagEntries(entries)[Number(index - 1n)];
  return selected === undefined ? undefined : rows.find((row) => row.instance_id.toString() === selected.instanceId);
}

// 공용 상세 formatter의 제목만 자기 펜던트 조회 문구로 투영합니다.
export function formatPendantInfo(row: PendantInfoRow): string {
  return formatPendantMarketInfo({ listing_id: 0n, asset_type_code: "ITEM", inventory_instance_id: row.instance_id,
    object_type: "pendant", ...row }).replace(/^펜던트 거래정보:/, "펜던트 정보:");
}

function eventKey(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function stored(value: string | PendantInfoResult): PendantInfoResult { return typeof value === "string" ? JSON.parse(value) as PendantInfoResult : value; }

// 펜던트 장착 projection 또는 stable 가방 번호를 읽기 전용 operation으로 조회합니다.
export class PendantInfoService {
  constructor(private readonly database: DatabaseClient) {}
  async handle(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<PendantInfoResult> {
    const parsed = parsePendantInfoCommand(input.message); if (parsed === undefined) return { status: "silent" };
    return this.database.withTransaction(async (transaction) => {
      const actors = await transaction.query<Array<{ identity_id: bigint; player_id: bigint; pet_id: bigint | null; rank_display: string }>>(`SELECT identity.id identity_id,profile.player_id,pet.id pet_id,CONCAT(COALESCE(rank_profile.rank_emoji,''),profile.current_display_name) rank_display
        FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active'
        JOIN player_profiles profile ON profile.player_id=player.id LEFT JOIN player_pets pet ON pet.player_id=player.id
        LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=player.id
        WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1 FOR UPDATE`, [input.externalUserId]);
      const actor = actors[0]; if (actor === undefined) return { status: "silent" };
      const key = eventKey(input.eventId);
      const prior = await transaction.query<Array<{ result_json: string | PendantInfoResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope='pendant.info.read' AND idempotency_key=? FOR UPDATE", [key]);
      if (prior[0]?.result_json != null) return stored(prior[0].result_json);
      const operation = await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'pendant.info.read',?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), key, actor.identity_id]);
      let result: PendantInfoResult; let data: string;
      if (parsed.kind === "usage") { result = { status: "usage" }; data = "예) /펜던트정보 [펜던트가방번호]\n혹은 장착 펜던트는 숫자 0을 입력해주세요."; }
      else {
        let selected: PendantInfoRow | undefined;
        if (actor.pet_id !== null && parsed.index === 0n) {
          const rows = await this.rows(transaction, actor.player_id, "equipped", actor.pet_id); selected = rows[0];
        } else if (actor.pet_id !== null && parsed.index > 0n) {
          selected = selectPendantInfoRow(await this.rows(transaction, actor.player_id, "owned", null), parsed.index);
        }
        if (selected === undefined) { result = { status: "not_found" }; data = `[${actor.rank_display}] 님\n해당 번호의 펜던트가 존재하지 않습니다.`; }
        else { result = { status: "found", instanceId: selected.instance_id.toString() }; data = formatPendantInfo(selected); }
      }
      const outbox = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operation.insertId, input.destinationId, JSON.stringify({ data })]);
      await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'PENDANT_INFO_READ',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, operation.insertId, result.status]);
      await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,'pendant.info.read',?,'Iris /펜던트정보',?,UTC_TIMESTAMP(3))", [operation.insertId, actor.identity_id, actor.player_id, result.status, JSON.stringify({ index: parsed.kind === "lookup" ? parsed.index.toString() : null, instanceId: result.instanceId ?? null, readOnly: true })]);
      result = { ...result, data, outboxId: outbox.insertId.toString() };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]); return result;
    });
  }

  // 장착 projection 또는 보유 가방의 펜던트 DB 행을 잠가 반환합니다.
  private async rows(transaction: DatabaseTransaction, playerId: bigint, status: "owned" | "equipped", petId: bigint | null): Promise<PendantInfoRow[]> {
    const projection = status === "equipped" ? "JOIN player_pet_pendants projection ON projection.inventory_instance_id=instance.id AND projection.player_pet_id=?" : "";
    const params = status === "equipped" ? [petId, playerId, status] : [playerId, status];
    return transaction.query<PendantInfoRow[]>(`SELECT instance.id instance_id,item.display_name item_name,
      JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.name')) name_value,JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.icon')) icon_value,
      JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.grade')) grade_value,JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.durability')) durability_value,
      JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.maxDurability')) max_durability_value,JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.upgrade')) upgrade_value
      FROM inventory_instances instance ${projection} JOIN item_definitions item ON item.id=instance.item_id AND item.active=TRUE
      WHERE instance.player_id=? AND instance.status=? AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.objectType')),JSON_UNQUOTE(JSON_EXTRACT(item.metadata_json,'$.objectType')))='pendant' FOR UPDATE`, params);
  }
}
