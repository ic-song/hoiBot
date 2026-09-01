import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { planMiniPetBulkCleanup, type MiniPetBulkCleanupCandidate } from "../mini-pet/mini-pet-bulk-cleanup-service.js";
import { sortPendantBagEntries, type PendantBagEntry } from "../pet/pendant-bag-service.js";

const ALL_SEE = "\u200b".repeat(500);
const PENDANT_LIMIT = 50;
type Numeric = bigint | number | string;

interface Operator { operatorId: bigint; }
interface MiniRow extends MiniPetBulkCleanupCandidate { rankDisplay: string; }
interface FurnitureRow { id: bigint; playerId: bigint; displayName: string; rankDisplay: string; furnitureName: string; charm: bigint; grade: string; version: bigint; premium: boolean; }
interface PendantRow { id: bigint; playerId: bigint; itemId: bigint; displayName: string; rankDisplay: string; itemName: string; name: string; icon: string; grade: string; durability: bigint; maxDurability: bigint; upgrade: bigint; version: bigint; }
export interface AdminStorageLimitCleanupResult { status: "cleaned" | "no_target" | "silent"; miniPetRemovedCount: number; furnitureRemovedCount: number; pendantRemovedCount: number; data?: string; outboxId?: string; }

// 레거시 관리자 전체 정리 명령을 정확히 식별합니다.
export function isAdminStorageLimitCleanupCommand(message: string | undefined): boolean { return message === "/글자수전체정리"; }

// 긴 이벤트 ID를 operations 멱등 키 길이에 맞게 정규화합니다.
function eventKey(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }

// MariaDB 수치 값을 bigint로 정규화합니다.
function integer(value: Numeric | null): bigint { return value === null ? 0n : BigInt(String(value).split(".")[0] ?? "0"); }

// 정수를 세 자리 쉼표 형식으로 표시합니다.
function commas(value: number): string { return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

// 세 자산 영역의 레거시 결과 메시지를 동일한 요약 구조로 생성합니다.
export function formatAdminStorageLimitCleanupMessage(input: { miniPetRemovedCount: number; furnitureRemovedCount: number; pendantRemovedCount: number; miniLogs: string[]; furnitureLogs: string[]; pendantLogs: string[] }): string {
  let message = "[관리자 정리 시스템🧹]\n글자수 전체 정리가 완료되었습니다.\n\n정리 결과\n";
  message += `- 미니펫 정리: ${commas(input.miniPetRemovedCount)}마리 삭제\n`;
  message += `- 가구 정리: ${commas(input.furnitureRemovedCount)}개 삭제\n`;
  message += `- 펜던트 정리: ${commas(input.pendantRemovedCount)}개 삭제\n`;
  if (input.miniPetRemovedCount + input.furnitureRemovedCount + input.pendantRemovedCount === 0) return `${message}\n정리할 초과 데이터가 없습니다.`;
  message += "\n데이터 저장이 완료되었습니다.\n\n상세 결과" + ALL_SEE + "\n";
  message += "[미니펫]\n" + (input.miniLogs.length === 0 ? "정리 대상 없음" : input.miniLogs.join("\n")) + "\n\n";
  message += "[가구]\n" + (input.furnitureLogs.length === 0 ? "정리 대상 없음" : input.furnitureLogs.join("\n")) + "\n\n";
  message += "[펜던트]\n" + (input.pendantLogs.length === 0 ? "정리 대상 없음" : input.pendantLogs.join("\n"));
  return message;
}

// 관리자 가방 한도 초과분을 세 canonical 보유 모델에서 한 트랜잭션으로 정리합니다.
export class AdminStorageLimitCleanupService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<AdminStorageLimitCleanupResult> {
    if (!isAdminStorageLimitCleanupCommand(input.message)) return { status: "silent", miniPetRemovedCount: 0, furnitureRemovedCount: 0, pendantRemovedCount: 0 };
    return this.database.withTransaction(async (transaction) => {
      const operator = await this.resolveOperator(transaction, input.externalUserId);
      if (operator === undefined) return { status: "silent", miniPetRemovedCount: 0, furnitureRemovedCount: 0, pendantRemovedCount: 0 };
      const key = eventKey(input.eventId);
      const prior = (await transaction.query<Array<{ result_json: string | AdminStorageLimitCleanupResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope='admin.storage_limit_cleanup' AND idempotency_key=? FOR UPDATE", [key]))[0];
      if (prior?.result_json != null) return typeof prior.result_json === "string" ? JSON.parse(prior.result_json) as AdminStorageLimitCleanupResult : prior.result_json;
      const operation = await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'admin.storage_limit_cleanup',?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), key, operator.operatorId]);

      const miniRows = await this.loadMiniPets(transaction);
      const miniPlan = planMiniPetBulkCleanup(miniRows);
      const furnitureRows = await this.loadFurniture(transaction);
      const policy = (await transaction.query<Array<{ base_bag_limit: Numeric; premium_bag_bonus: Numeric }>>("SELECT base_bag_limit,premium_bag_bonus FROM home_furniture_bag_policy WHERE policy_key='default' FOR UPDATE"))[0];
      const furnitureBase = integer(policy?.base_bag_limit ?? 10);
      const furnitureBonus = integer(policy?.premium_bag_bonus ?? 5);
      const furnitureRemoved: FurnitureRow[] = [];
      const furnitureGroups = new Map<string, FurnitureRow[]>();
      for (const row of furnitureRows) { const group = furnitureGroups.get(row.playerId.toString()) ?? []; group.push(row); furnitureGroups.set(row.playerId.toString(), group); }
      for (const group of furnitureGroups.values()) { const keep = furnitureBase + (group[0]?.premium === true ? furnitureBonus : 0n); furnitureRemoved.push(...group.slice(Number(keep))); }
      const pendantRows = await this.loadPendants(transaction);
      const pendantRemoved: PendantRow[] = [];
      const pendantGroups = new Map<string, PendantRow[]>();
      for (const row of pendantRows) { const group = pendantGroups.get(row.playerId.toString()) ?? []; group.push(row); pendantGroups.set(row.playerId.toString(), group); }
      for (const group of pendantGroups.values()) {
        const byId = new Map(group.map((row) => [row.id.toString(), row]));
        const sorted = sortPendantBagEntries(group.map((row) => ({ instanceId: row.id.toString(), name: row.name, icon: row.icon, grade: row.grade, durability: row.durability, maxDurability: row.maxDurability, upgrade: row.upgrade })));
        for (const entry of sorted.slice(PENDANT_LIMIT)) pendantRemoved.push(byId.get(entry.instanceId)!);
      }

      await transaction.execute("INSERT INTO admin_storage_limit_cleanup_runs(operation_id,operator_id,mini_pet_removed_count,furniture_removed_count,pendant_removed_count) VALUES (?,?,?,?,?)", [operation.insertId, operator.operatorId, miniPlan.removed.length, furnitureRemoved.length, pendantRemoved.length]);
      let itemSequence = 0;
      for (const row of miniPlan.removed) {
        itemSequence++;
        const detail = miniRows.find((candidate) => candidate.ownedMiniPetId === row.ownedMiniPetId)!;
        await transaction.execute("INSERT INTO admin_storage_limit_cleanup_items(operation_id,sequence_no,asset_type,player_id,asset_id,asset_version_before,snapshot_json) VALUES (?,?,'mini_pet',?,?,?,?)", [operation.insertId, itemSequence, row.playerId, row.ownedMiniPetId, row.ownedVersion, JSON.stringify({ displayName: row.displayName, bagSequence: row.bagSequence?.toString() ?? null, keepCount: row.keepCount.toString(), rankDisplay: detail.rankDisplay })]);
      }
      for (const row of furnitureRemoved) {
        itemSequence++;
        await transaction.execute("INSERT INTO admin_storage_limit_cleanup_items(operation_id,sequence_no,asset_type,player_id,asset_id,asset_version_before,snapshot_json) VALUES (?,?,'furniture',?,?,?,?)", [operation.insertId, itemSequence, row.playerId, row.id, row.version, JSON.stringify({ displayName: row.furnitureName, charm: row.charm.toString(), grade: row.grade })]);
      }
      for (const row of pendantRemoved) {
        itemSequence++;
        await transaction.execute("INSERT INTO admin_storage_limit_cleanup_items(operation_id,sequence_no,asset_type,player_id,asset_id,asset_version_before,snapshot_json) VALUES (?,?,'pendant',?,?,?,?)", [operation.insertId, itemSequence, row.playerId, row.id, row.version, JSON.stringify({ name: row.name, icon: row.icon, grade: row.grade, durability: row.durability.toString(), maxDurability: row.maxDurability.toString(), upgrade: row.upgrade.toString() })]);
      }

      await this.removeMiniPets(transaction, miniPlan.removed);
      let furnitureLedgerSequence = 0;
      for (const row of furnitureRemoved) {
        const changed = await transaction.execute("UPDATE furniture_inventory_instances SET status='removed',version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND player_id=? AND status='bag' AND version=?", [row.id, row.playerId, row.version]);
        if (changed.affectedRows !== 1n) throw new Error("가구 가방이 먼저 변경되었습니다.");
        await transaction.execute("INSERT INTO furniture_inventory_ledger(operation_id,sequence_no,player_id,furniture_instance_id,status_before,status_after,reason_code) VALUES (?,?,?,?,'bag','removed','ADMIN_STORAGE_LIMIT_CLEANUP')", [operation.insertId, ++furnitureLedgerSequence, row.playerId, row.id]);
      }
      let pendantLedgerSequence = 0;
      for (const row of pendantRemoved) {
        const changed = await transaction.execute("UPDATE inventory_instances SET status='consumed',version=version+1 WHERE id=? AND player_id=? AND status='owned' AND version=?", [row.id, row.playerId, row.version]);
        if (changed.affectedRows !== 1n) throw new Error("펜던트 가방이 먼저 변경되었습니다.");
        await transaction.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,instance_id,quantity_delta,reason_code) VALUES (?,?,?,?,?,-1,'ADMIN_STORAGE_LIMIT_CLEANUP')", [operation.insertId, ++pendantLedgerSequence, row.playerId, row.itemId, row.id]);
      }

      const miniLogs = this.miniLogs(miniRows, miniPlan.removed);
      const furnitureLogs = this.furnitureLogs(furnitureRows, furnitureRemoved, furnitureBase, furnitureBonus);
      const pendantLogs = this.pendantLogs(pendantRemoved);
      const data = formatAdminStorageLimitCleanupMessage({ miniPetRemovedCount: miniPlan.removed.length, furnitureRemovedCount: furnitureRemoved.length, pendantRemovedCount: pendantRemoved.length, miniLogs, furnitureLogs, pendantLogs });
      const status = itemSequence === 0 ? "no_target" : "cleaned";
      const outbox = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operation.insertId, input.destinationId, JSON.stringify({ data })]);
      await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'ADMIN_STORAGE_LIMIT_CLEANUP',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, operation.insertId, status]);
      await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'multi_asset_inventory',NULL,'admin.storage_limit_cleanup',?,'Iris /글자수전체정리',?,UTC_TIMESTAMP(3))", [operation.insertId, operator.operatorId, status, JSON.stringify({ mutation: itemSequence > 0, miniPetRemovedCount: miniPlan.removed.length, furnitureRemovedCount: furnitureRemoved.length, pendantRemovedCount: pendantRemoved.length })]);
      const result: AdminStorageLimitCleanupResult = { status, miniPetRemovedCount: miniPlan.removed.length, furnitureRemovedCount: furnitureRemoved.length, pendantRemovedCount: pendantRemoved.length, data, outboxId: outbox.insertId.toString() };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }

  private async resolveOperator(transaction: DatabaseTransaction, externalUserId: string): Promise<Operator | undefined> {
    const rows = await transaction.query<Array<{ operator_id: bigint }>>(`SELECT operator.id operator_id FROM external_identities identity JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active' JOIN admin_operator_roles assignment ON assignment.operator_id=operator.id JOIN admin_roles role ON role.id=assignment.role_id AND role.active=TRUE JOIN admin_role_permissions permission ON permission.role_id=role.id AND permission.permission_code='admin.storage_limit_cleanup' WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' ORDER BY role.code='super_admin' DESC,operator.id LIMIT 1 FOR UPDATE`, [externalUserId]);
    return rows[0] === undefined ? undefined : { operatorId: rows[0].operator_id };
  }

  private async loadMiniPets(transaction: DatabaseTransaction): Promise<MiniRow[]> {
    const rows = await transaction.query<Array<{ player_id: Numeric; player_name: string; rank_display: string; pet_id: Numeric; pet_version: Numeric; definition_id: Numeric; display_name: string; bag_sequence: Numeric | null; keep_count: Numeric; equipped: number; reserved: number; manual_protected: number; pending_equip: number }>>(`SELECT pet.player_id,COALESCE(profile.current_display_name,CONCAT('player-',pet.player_id)) player_name,CONCAT(COALESCE(rank.rank_emoji,''),COALESCE(profile.current_display_name,CONCAT('player-',pet.player_id))) rank_display,pet.id pet_id,pet.version pet_version,pet.mini_pet_definition_id definition_id,definition.display_name,pet.bag_sequence,COALESCE(capacity.keep_count,100) keep_count,pet.equipped,EXISTS(SELECT 1 FROM market_mini_pet_reservations reservation WHERE reservation.owned_mini_pet_id=pet.id) reserved,EXISTS(SELECT 1 FROM mini_pet_protected_refs protected WHERE protected.owned_mini_pet_id=pet.id AND protected.active=TRUE) manual_protected,EXISTS(SELECT 1 FROM mini_pet_equip_confirmations confirmation WHERE confirmation.consumed_at IS NULL AND confirmation.cancelled_at IS NULL AND confirmation.expires_at>=UTC_TIMESTAMP(3) AND (confirmation.selected_owned_mini_pet_id=pet.id OR confirmation.previous_owned_mini_pet_id=pet.id)) pending_equip FROM owned_mini_pets pet JOIN mini_pet_definitions definition ON definition.id=pet.mini_pet_definition_id LEFT JOIN player_profiles profile ON profile.player_id=pet.player_id LEFT JOIN player_legacy_rank_profiles rank ON rank.player_id=pet.player_id LEFT JOIN mini_pet_inventory_limits capacity ON capacity.player_id=pet.player_id ORDER BY pet.player_id,pet.equipped DESC,COALESCE(pet.bag_sequence,pet.id),pet.id FOR UPDATE`);
    return rows.map((row) => ({ playerId: String(row.player_id), playerName: row.player_name, rankDisplay: row.rank_display, ownedMiniPetId: String(row.pet_id), ownedVersion: String(row.pet_version), definitionId: String(row.definition_id), displayName: row.display_name, bagSequence: row.bag_sequence === null ? null : integer(row.bag_sequence), keepCount: integer(row.keep_count), equipped: Number(row.equipped) === 1, reserved: Number(row.reserved) === 1, manualProtected: Number(row.manual_protected) === 1, pendingEquip: Number(row.pending_equip) === 1 }));
  }

  private async loadFurniture(transaction: DatabaseTransaction): Promise<FurnitureRow[]> {
    const rows = await transaction.query<Array<{ id: Numeric; player_id: Numeric; display_name: string; rank_display: string; furniture_name: string; charm_snapshot: Numeric; grade_display_name: string | null; version: Numeric; premium: Numeric }>>(`SELECT instance.id,instance.player_id,profile.current_display_name display_name,CONCAT(COALESCE(rank.rank_emoji,''),profile.current_display_name) rank_display,definition.display_name furniture_name,instance.charm_snapshot,instance.grade_display_name,instance.version,EXISTS(SELECT 1 FROM player_passes pass WHERE pass.player_id=instance.player_id AND pass.pass_code='premium' AND pass.enabled=TRUE AND (pass.permanent=TRUE OR pass.ends_at>=UTC_TIMESTAMP(3))) premium FROM furniture_inventory_instances instance JOIN furniture_definitions definition ON definition.id=instance.furniture_definition_id JOIN players player ON player.id=instance.player_id AND player.status='active' AND player.deleted_at IS NULL JOIN player_profiles profile ON profile.player_id=player.id LEFT JOIN player_legacy_rank_profiles rank ON rank.player_id=player.id WHERE instance.status='bag' ORDER BY instance.player_id,instance.charm_snapshot DESC,definition.display_name COLLATE utf8mb4_unicode_ci,instance.id FOR UPDATE`);
    return rows.map((row) => ({ id: integer(row.id), playerId: integer(row.player_id), displayName: row.display_name, rankDisplay: row.rank_display, furnitureName: row.furniture_name, charm: integer(row.charm_snapshot), grade: row.grade_display_name ?? "", version: integer(row.version), premium: integer(row.premium) > 0n }));
  }

  private async loadPendants(transaction: DatabaseTransaction): Promise<PendantRow[]> {
    const rows = await transaction.query<Array<{ instance_id: Numeric; player_id: Numeric; item_id: Numeric; display_name: string; rank_display: string; item_name: string; name_value: string | null; icon_value: string | null; grade_value: string | null; durability_value: string | null; max_durability_value: string | null; upgrade_value: string | null; version: Numeric }>>(`SELECT instance.id instance_id,instance.player_id,instance.item_id,profile.current_display_name display_name,CONCAT(COALESCE(rank.rank_emoji,''),profile.current_display_name) rank_display,item.display_name item_name,JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.name')) name_value,JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.icon')) icon_value,JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.grade')) grade_value,JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.durability')) durability_value,JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.maxDurability')) max_durability_value,JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.upgrade')) upgrade_value,instance.version FROM inventory_instances instance JOIN item_definitions item ON item.id=instance.item_id AND item.active=TRUE JOIN players player ON player.id=instance.player_id AND player.status='active' AND player.deleted_at IS NULL JOIN player_profiles profile ON profile.player_id=player.id LEFT JOIN player_legacy_rank_profiles rank ON rank.player_id=player.id WHERE instance.status='owned' AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.objectType')),JSON_UNQUOTE(JSON_EXTRACT(item.metadata_json,'$.objectType')))='pendant' ORDER BY instance.player_id,instance.id FOR UPDATE`);
    return rows.map((row) => ({ id: integer(row.instance_id), playerId: integer(row.player_id), itemId: integer(row.item_id), displayName: row.display_name, rankDisplay: row.rank_display, itemName: row.item_name, name: row.name_value ?? row.item_name, icon: row.icon_value ?? "", grade: row.grade_value ?? "", durability: BigInt(row.durability_value ?? "5"), maxDurability: BigInt(row.max_durability_value ?? "5"), upgrade: BigInt(row.upgrade_value ?? "0"), version: integer(row.version) }));
  }

  private async removeMiniPets(transaction: DatabaseTransaction, removed: MiniPetBulkCleanupCandidate[]): Promise<void> {
    const affected = [...new Set(removed.map((row) => row.playerId))];
    for (let offset = 0; offset < removed.length; offset += 200) { const ids = removed.slice(offset, offset + 200).map((row) => row.ownedMiniPetId); if (ids.length === 0) continue; const placeholders = ids.map(() => "?").join(","); await transaction.execute(`DELETE FROM mini_pet_title_assignments WHERE owned_mini_pet_id IN (${placeholders})`, ids); const deleted = await transaction.execute(`DELETE FROM owned_mini_pets WHERE id IN (${placeholders})`, ids); if (deleted.affectedRows !== BigInt(ids.length)) throw new Error("미니펫 가방이 먼저 변경되었습니다."); }
    for (const playerId of affected) { const remaining = await transaction.query<Array<{ id: Numeric }>>("SELECT id FROM owned_mini_pets WHERE player_id=? AND equipped=FALSE ORDER BY COALESCE(bag_sequence,id),id FOR UPDATE", [playerId]); for (let index = 0; index < remaining.length; index++) await transaction.execute("UPDATE owned_mini_pets SET bag_sequence=?,version=version+1 WHERE id=?", [index + 1, remaining[index]!.id]); }
  }

  private miniLogs(all: MiniRow[], removed: MiniPetBulkCleanupCandidate[]): string[] { const groups = new Map<string, MiniRow[]>(); for (const row of all.filter((candidate) => !candidate.equipped)) { const group = groups.get(row.playerId) ?? []; group.push(row); groups.set(row.playerId, group); } return [...new Set(removed.map((row) => row.playerId))].map((playerId) => { const group = groups.get(playerId) ?? []; const count = removed.filter((row) => row.playerId === playerId).length; const first = group[0]!; return `[${first.rankDisplay}] ${group.length}마리 → ${group.length - count}마리 (삭제: ${count}마리)`; }); }
  private furnitureLogs(all: FurnitureRow[], removed: FurnitureRow[], base: bigint, bonus: bigint): string[] { const playerIds = [...new Set(removed.map((row) => row.playerId.toString()))]; return playerIds.map((playerId) => { const group = all.filter((row) => row.playerId.toString() === playerId); const count = removed.filter((row) => row.playerId.toString() === playerId).length; const keep = base + (group[0]?.premium === true ? bonus : 0n); return `[${group[0]!.rankDisplay}] ${group.length}개 → ${keep}개 (삭제: ${count}개)`; }); }
  private pendantLogs(removed: PendantRow[]): string[] { const playerIds = [...new Set(removed.map((row) => row.playerId.toString()))]; return playerIds.map((playerId) => { const group = removed.filter((row) => row.playerId.toString() === playerId); return `- [${group[0]!.rankDisplay}] ${group.length}개 삭제`; }); }
}
