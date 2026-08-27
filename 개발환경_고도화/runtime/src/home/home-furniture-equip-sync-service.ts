import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND_CODE = "HOME_FURNITURE_EQUIP_SYNC";
const BACKUP_KEY = "before_legacy_split";

type Operator = { operator_id: bigint };
type LegacySource = { owned_furniture_id: bigint; player_id: bigint; furniture_definition_id: bigint; quantity: bigint; charm_value: bigint; has_home: bigint };
type LegacyPlacement = { id: bigint; owned_furniture_id: bigint };
type LegacyLink = { owned_furniture_id: bigint; source_ordinal: bigint; furniture_instance_id: bigint; legacy_placement_id: bigint | null; instance_status: string };
type Summary = { player_id: bigint; placed_count: bigint; total_charm: bigint; royal_lumiere_count: bigint; grade_counts_json: unknown };

// DB 드라이버별 JSON 반환 형식을 동일한 문자열로 정규화한다.
function normalizeJsonText(value: unknown): string {
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value));
    } catch (_error) {
      return value;
    }
  }
  return JSON.stringify(value ?? {});
}

// DECIMAL의 0 소수부만 허용해 정수 값으로 변환한다.
function toIntegralBigInt(value: unknown): bigint {
  const text = String(value);
  if (!/^-?\d+(?:\.0+)?$/.test(text)) {
    throw new Error("Expected an integral database value: " + text);
  }
  return BigInt(text.split(".")[0]!);
}

export interface LegacyFurnitureSourcePlan {
  createCount: bigint;
  placementLinkCount: bigint;
}

export interface HomeFurnitureEquipSyncResult {
  status: "synced";
  reply: string;
  outboxId: string;
  replayed: boolean;
  userCount: string;
  furnitureCount: string;
  mergedCount: string;
  summaryChangedCount: string;
  bagDuplicateRemovedCount: string;
  orphanUserCount: string;
  placementPromotedCount: string;
  backupStatus: "생성 완료" | "기존 백업 유지";
}

// 레거시 source 수량이 줄거나 배치 수가 보유 수량을 넘는 경우 파괴적 추정을 막습니다.
export function planLegacyFurnitureSource(quantity: bigint, linkedCount: bigint, placementCount: bigint): LegacyFurnitureSourcePlan {
  if (quantity < 0n || linkedCount < 0n || placementCount < 0n) throw new Error("가구 수량은 음수일 수 없습니다.");
  if (placementCount > quantity) throw new Error("장착 가구 수가 레거시 보유 수량을 초과했습니다.");
  if (linkedCount > quantity) throw new Error("레거시 가구 수량이 기존 동기화 이력보다 감소했습니다.");
  return { createCount: quantity - linkedCount, placementLinkCount: placementCount };
}

function commas(value: bigint): string { return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function eventKey(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function stored(value: string | HomeFurnitureEquipSyncResult): HomeFurnitureEquipSyncResult { return typeof value === "string" ? JSON.parse(value) as HomeFurnitureEquipSyncResult : value; }

export function buildHomeFurnitureEquipSyncReply(input: Omit<HomeFurnitureEquipSyncResult,"status"|"reply"|"outboxId"|"replayed">): string {
  const mode = input.backupStatus === "생성 완료" ? "최초 분리" : "상시 동기화";
  let reply = `✅ 장착 가구 ${mode} 완료\n━━━━━━━━━━━━━━━\n`;
  reply += `동기화 유저: ${commas(BigInt(input.userCount))}명\n`;
  reply += `장착 가구: ${commas(BigInt(input.furnitureCount))}개\n`;
  reply += `기존 목록 병합: ${commas(BigInt(input.mergedCount))}개\n`;
  reply += `요약값 수정: ${commas(BigInt(input.summaryChangedCount))}명\n`;
  reply += `가방 중복 제거: ${commas(BigInt(input.bagDuplicateRemovedCount))}개\n`;
  reply += `상세만 남은 유저: ${commas(BigInt(input.orphanUserCount))}명`;
  if (input.backupStatus === "생성 완료") reply += "\n최초 백업: 생성 완료\n백업 파일: DB home_furniture_sync_backup_rows";
  return reply;
}

async function complete(transaction: DatabaseTransaction, input: { operationId: bigint; eventId: string; destinationId: string; operatorId: bigint; result: Omit<HomeFurnitureEquipSyncResult,"reply"|"outboxId"|"replayed">; summary: Record<string,unknown> }): Promise<HomeFurnitureEquipSyncResult> {
  const reply = buildHomeFurnitureEquipSyncReply(input.result);
  const outbox = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.operationId,input.destinationId,JSON.stringify({data:reply})]);
  await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed','synced',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId,COMMAND_CODE,input.operationId]);
  await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'furniture_inventory',NULL,'home.furniture_equip_sync','synced','Iris /장착가구동기화',?,UTC_TIMESTAMP(3))", [input.operationId,input.operatorId,JSON.stringify(input.summary)]);
  const result: HomeFurnitureEquipSyncResult = {...input.result,reply,outboxId:outbox.insertId.toString(),replayed:false};
  await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result),input.operationId]);
  return result;
}

// 레거시 가구 stack·배치 관계를 stable instance와 요약 projection으로 원자 동기화합니다.
export class HomeFurnitureEquipSyncService {
  public constructor(private readonly database: DatabaseClient) {}

  public async execute(input: { eventId: string; externalUserId: string; destinationId: string }): Promise<HomeFurnitureEquipSyncResult> {
    return this.database.withTransaction(async transaction => {
      const operator = (await transaction.query<Operator[]>("SELECT mapping.operator_id FROM external_identities identity JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active' WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' ORDER BY mapping.operator_id LIMIT 1 FOR UPDATE", [input.externalUserId]))[0];
      if (operator === undefined) throw new ApplicationError("HOME_FURNITURE_EQUIP_SYNC_FORBIDDEN", "권한이 없습니다.", 403);
      const prior = (await transaction.query<Array<{result_json:string|HomeFurnitureEquipSyncResult|null}>>("SELECT result_json FROM operations WHERE idempotency_scope='home.furniture_equip_sync' AND idempotency_key=? FOR UPDATE", [eventKey(input.eventId)]))[0];
      if (prior?.result_json != null) return {...stored(prior.result_json),replayed:true};
      const operationId = (await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'home.furniture_equip_sync',?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(),eventKey(input.eventId),operator.operator_id])).insertId;

      const backupWrite = await transaction.execute("INSERT IGNORE INTO home_furniture_sync_backups(backup_key,created_operation_id,created_at) VALUES (?,?,UTC_TIMESTAMP(3))", [BACKUP_KEY,operationId]);
      const backupStatus: "생성 완료"|"기존 백업 유지" = backupWrite.affectedRows === 1n ? "생성 완료" : "기존 백업 유지";
      if (backupStatus === "생성 완료") {
        await transaction.execute(`INSERT INTO home_furniture_sync_backup_rows(backup_key,player_id,legacy_owned_quantity,legacy_placement_count,inventory_bag_count,inventory_placed_count,inventory_charm_total)
          SELECT ?,scope.player_id,
            COALESCE((SELECT SUM(owned.quantity) FROM owned_furniture owned WHERE owned.player_id=scope.player_id),0),
            COALESCE((SELECT COUNT(*) FROM furniture_placements placement WHERE placement.player_id=scope.player_id),0),
            COALESCE((SELECT COUNT(*) FROM furniture_inventory_instances instance WHERE instance.player_id=scope.player_id AND instance.status='bag'),0),
            COALESCE((SELECT COUNT(*) FROM furniture_inventory_instances instance WHERE instance.player_id=scope.player_id AND instance.status='placed'),0),
            COALESCE((SELECT SUM(instance.charm_snapshot) FROM furniture_inventory_instances instance WHERE instance.player_id=scope.player_id AND instance.status IN ('bag','placed')),0)
          FROM (SELECT player_id FROM player_homes UNION SELECT player_id FROM owned_furniture UNION SELECT player_id FROM furniture_inventory_instances) scope`, [BACKUP_KEY]);
      }

      const sources = await transaction.query<LegacySource[]>(`SELECT owned.id owned_furniture_id,owned.player_id,owned.furniture_definition_id,owned.quantity,definition.charm_value,
        EXISTS(SELECT 1 FROM player_homes home WHERE home.player_id=owned.player_id) has_home
        FROM owned_furniture owned JOIN furniture_definitions definition ON definition.id=owned.furniture_definition_id
        ORDER BY owned.player_id,owned.id FOR UPDATE`);
      const placements = await transaction.query<LegacyPlacement[]>("SELECT id,owned_furniture_id FROM furniture_placements ORDER BY player_id,id FOR UPDATE");
      const links = await transaction.query<LegacyLink[]>(`SELECT link.owned_furniture_id,link.source_ordinal,link.furniture_instance_id,link.legacy_placement_id,instance.status instance_status
        FROM home_furniture_legacy_instance_links link JOIN furniture_inventory_instances instance ON instance.id=link.furniture_instance_id
        WHERE link.active=TRUE ORDER BY link.owned_furniture_id,link.source_ordinal FOR UPDATE`);
      const placementsBySource = new Map<string,LegacyPlacement[]>();
      for (const placement of placements) { const key=placement.owned_furniture_id.toString(); const rows=placementsBySource.get(key)??[]; rows.push(placement); placementsBySource.set(key,rows); }
      const linksBySource = new Map<string,LegacyLink[]>();
      for (const link of links) { const key=link.owned_furniture_id.toString(); const rows=linksBySource.get(key)??[]; rows.push(link); linksBySource.set(key,rows); }
      for (const source of sources) planLegacyFurnitureSource(BigInt(source.quantity),BigInt((linksBySource.get(source.owned_furniture_id.toString())??[]).length),BigInt((placementsBySource.get(source.owned_furniture_id.toString())??[]).length));

      let mergedCount=0n,placementPromotedCount=0n,ledgerSequence=0n;
      for (const source of sources) {
        const sourceKey=source.owned_furniture_id.toString(),sourcePlacements=placementsBySource.get(sourceKey)??[],sourceLinks=linksBySource.get(sourceKey)??[];
        const linksByOrdinal=new Map(sourceLinks.map(link=>[link.source_ordinal.toString(),link]));
        for (let ordinal=1n;ordinal<=BigInt(source.quantity);ordinal+=1n) {
          const placement=sourcePlacements[Number(ordinal-1n)],existing=linksByOrdinal.get(ordinal.toString());
          if (existing === undefined) {
            const status=placement===undefined?"bag":"placed";
            const instance=await transaction.execute("INSERT INTO furniture_inventory_instances(player_id,furniture_definition_id,charm_snapshot,grade_display_name,status,version) VALUES (?,?,?,'등급없음',?,1)", [source.player_id,source.furniture_definition_id,source.charm_value,status]);
            ledgerSequence+=1n;
            await transaction.execute("INSERT INTO furniture_inventory_ledger(operation_id,sequence_no,player_id,furniture_instance_id,status_before,status_after,reason_code) VALUES (?,?,?,?,'none',?,'HOME_FURNITURE_EQUIP_SYNC_IMPORT')", [operationId,ledgerSequence,source.player_id,instance.insertId,status]);
            await transaction.execute("INSERT INTO home_furniture_legacy_instance_links(owned_furniture_id,source_ordinal,furniture_instance_id,legacy_placement_id,created_operation_id,active,created_at,updated_at) VALUES (?,?,?,?,?,TRUE,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [source.owned_furniture_id,ordinal,instance.insertId,placement?.id??null,operationId]);
            mergedCount+=1n;
          } else if (placement !== undefined && existing.legacy_placement_id === null) {
            if (existing.instance_status !== "bag" && existing.instance_status !== "placed") throw new Error("회수된 가구에는 레거시 배치 정보를 연결할 수 없습니다.");
            if (existing.instance_status === "bag") {
              await transaction.execute("UPDATE furniture_inventory_instances SET status='placed',version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND status='bag'", [existing.furniture_instance_id]);
              ledgerSequence+=1n;
              await transaction.execute("INSERT INTO furniture_inventory_ledger(operation_id,sequence_no,player_id,furniture_instance_id,status_before,status_after,reason_code) VALUES (?,?,?,?,'bag','placed','HOME_FURNITURE_EQUIP_SYNC_PLACEMENT')", [operationId,ledgerSequence,source.player_id,existing.furniture_instance_id]);
              placementPromotedCount+=1n;
            }
            await transaction.execute("UPDATE home_furniture_legacy_instance_links SET legacy_placement_id=?,updated_at=UTC_TIMESTAMP(3) WHERE owned_furniture_id=? AND source_ordinal=?", [placement.id,source.owned_furniture_id,ordinal]);
          }
        }
      }

      const existingSummaries = await transaction.query<Summary[]>("SELECT player_id,placed_count,total_charm,royal_lumiere_count,grade_counts_json FROM home_furniture_sync_summaries ORDER BY player_id FOR UPDATE");
      const existingByPlayer=new Map(existingSummaries.map(row=>[row.player_id.toString(),row]));
      const summaries=await transaction.query<Summary[]>(`SELECT home.player_id,COUNT(instance.id) placed_count,COALESCE(SUM(instance.charm_snapshot),0) total_charm,
        COALESCE(SUM(instance.grade_display_name='로열 루미에르'),0) royal_lumiere_count,
        JSON_OBJECT() grade_counts_json
        FROM player_homes home LEFT JOIN furniture_inventory_instances instance ON instance.player_id=home.player_id AND instance.status='placed'
        GROUP BY home.player_id ORDER BY home.player_id FOR UPDATE`);
      let summaryChangedCount=0n;
      for (const summary of summaries) {
        const grades=await transaction.query<Array<{grade_name:string;count_value:bigint}>>("SELECT COALESCE(NULLIF(grade_display_name,''),'등급없음') grade_name,COUNT(*) count_value FROM furniture_inventory_instances WHERE player_id=? AND status='placed' GROUP BY COALESCE(NULLIF(grade_display_name,''),'등급없음') ORDER BY grade_name", [summary.player_id]);
        const gradeJson=JSON.stringify(Object.fromEntries(grades.map(row=>[row.grade_name,Number(row.count_value)])));
        const before=existingByPlayer.get(summary.player_id.toString());
        if (before===undefined||toIntegralBigInt(before.placed_count)!==toIntegralBigInt(summary.placed_count)||toIntegralBigInt(before.total_charm)!==toIntegralBigInt(summary.total_charm)||toIntegralBigInt(before.royal_lumiere_count)!==toIntegralBigInt(summary.royal_lumiere_count)||normalizeJsonText(before.grade_counts_json)!==gradeJson) summaryChangedCount+=1n;
        await transaction.execute("INSERT INTO home_furniture_sync_summaries(player_id,placed_count,total_charm,royal_lumiere_count,grade_counts_json,version,last_operation_id,updated_at) VALUES (?,?,?,?,?,1,?,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE placed_count=VALUES(placed_count),total_charm=VALUES(total_charm),royal_lumiere_count=VALUES(royal_lumiere_count),grade_counts_json=VALUES(grade_counts_json),version=version+1,last_operation_id=VALUES(last_operation_id),updated_at=UTC_TIMESTAMP(3)", [summary.player_id,summary.placed_count,summary.total_charm,summary.royal_lumiere_count,gradeJson,operationId]);
      }
      const furnitureCount=(await transaction.query<Array<{count_value:bigint}>>("SELECT COUNT(*) count_value FROM furniture_inventory_instances instance JOIN player_homes home ON home.player_id=instance.player_id WHERE instance.status='placed' FOR UPDATE"))[0]?.count_value??0n;
      const orphanUserCount=BigInt(new Set(sources.filter(source=>BigInt(source.has_home)===0n).map(source=>source.player_id.toString())).size);
      const result={status:"synced" as const,userCount:String(summaries.length),furnitureCount:furnitureCount.toString(),mergedCount:mergedCount.toString(),summaryChangedCount:summaryChangedCount.toString(),bagDuplicateRemovedCount:"0",orphanUserCount:orphanUserCount.toString(),placementPromotedCount:placementPromotedCount.toString(),backupStatus};
      await transaction.execute("INSERT INTO home_furniture_sync_operations(operation_id,operator_id,backup_status,user_count,furniture_count,merged_count,summary_changed_count,bag_duplicate_removed_count,orphan_user_count,placement_promoted_count,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))", [operationId,operator.operator_id,backupStatus,result.userCount,result.furnitureCount,result.mergedCount,result.summaryChangedCount,result.bagDuplicateRemovedCount,result.orphanUserCount,result.placementPromotedCount]);
      return complete(transaction,{operationId,eventId:input.eventId,destinationId:input.destinationId,operatorId:operator.operator_id,result,summary:{mutation:true,...result,sourceStackCount:sources.length,legacyPlacementCount:placements.length}});
    });
  }
}
