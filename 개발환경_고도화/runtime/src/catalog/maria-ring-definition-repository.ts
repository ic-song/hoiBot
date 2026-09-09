import type { DatabaseClient } from "../database.js";
import type { RingDefinitionRecord } from "./ring-definition-catalog.js";
interface RingDefinitionRow {
  grade_code: string; object_key: string; item_code: string; source_key: string;
  grade_display_name: string; item_display_name: string; grade_order: number; emoji: string;
  names_json: string | string[]; success_rate: string; drop_rate: string; item_cost: bigint;
  point_cost: string; max_level: bigint; battle_exp: bigint; battle_upgrade_exp: bigint;
  raid_exp: bigint; raid_upgrade_exp: bigint; castle_exp: bigint; castle_upgrade_exp: bigint;
  source_hash: string; catalog_version: string;
}
const SELECT_COLUMNS =
  "SELECT ring.grade_code,registry.object_key,item.code item_code,ring.source_key," +
  "ring.grade_display_name,ring.item_display_name,ring.grade_order,ring.emoji,ring.names_json," +
  "ring.success_rate,ring.drop_rate,ring.item_cost,ring.point_cost,ring.max_level," +
  "ring.battle_exp,ring.battle_upgrade_exp,ring.raid_exp,ring.raid_upgrade_exp," +
  "ring.castle_exp,ring.castle_upgrade_exp,ring.source_hash,ring.catalog_version " +
  "FROM ring_grade_definitions ring JOIN object_registry registry ON registry.id=ring.object_id " +
  "AND registry.object_type='ITEM' AND registry.active=TRUE JOIN item_definitions item ON item.id=ring.item_id " +
  "AND item.active=TRUE WHERE ring.active=TRUE";
function mapRow(row: RingDefinitionRow): RingDefinitionRecord {
  return { gradeCode: row.grade_code, objectKey: row.object_key, itemCode: row.item_code, sourceKey: row.source_key,
    gradeDisplayName: row.grade_display_name, itemDisplayName: row.item_display_name, gradeOrder: Number(row.grade_order),
    emoji: row.emoji, names: typeof row.names_json === "string" ? JSON.parse(row.names_json) : row.names_json,
    successRate: row.success_rate, dropRate: row.drop_rate, itemCost: row.item_cost, pointCost: row.point_cost,
    maxLevel: row.max_level, battleExp: row.battle_exp, battleUpgradeExp: row.battle_upgrade_exp,
    raidExp: row.raid_exp, raidUpgradeExp: row.raid_upgrade_exp, castleExp: row.castle_exp,
    castleUpgradeExp: row.castle_upgrade_exp, sourceHash: row.source_hash, catalogVersion: row.catalog_version };
}
export class MariaRingDefinitionRepository {
  constructor(private readonly database: DatabaseClient) {}
  async listActive(): Promise<RingDefinitionRecord[]> {
    const rows = await this.database.query<RingDefinitionRow[]>(SELECT_COLUMNS + " ORDER BY ring.grade_order");
    return rows.map(mapRow);
  }
  async findBySourceKey(sourceKey: string): Promise<RingDefinitionRecord | undefined> {
    const rows = await this.database.query<RingDefinitionRow[]>(SELECT_COLUMNS + " AND ring.source_key=? LIMIT 1", [sourceKey]);
    return rows[0] === undefined ? undefined : mapRow(rows[0]);
  }
}