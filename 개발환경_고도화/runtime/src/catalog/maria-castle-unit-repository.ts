import type { DatabaseClient } from "../database.js";
import type { CastleUnitRecord } from "./castle-unit-catalog.js";

interface Row {
  unit_code: string;
  object_key: string;
  item_code: string;
  source_key: string;
  display_name: string;
  charm_per_unit: string;
  display_order: number;
  source_hash: string;
  catalog_version: string;
}

const REUSED = new Set(["ITEM-RWD-CASTLE-ADVANCED","ITEM-RWD-CASTLE-UNIQUE","ITEM-RWD-CASTLE-RARE","ITEM-RWD-CASTLE-HERO","ITEM-RWD-CASTLE-LEGEND","ITEM-RWD-CASTLE-MYTH","ITEM-RWD-CASTLE-IMMORTAL"]);
const SELECT = "SELECT JSON_UNQUOTE(JSON_EXTRACT(registry.metadata_json,'$.unitCode')) unit_code,registry.object_key,item.code item_code,binding.source_key,item.display_name,CAST(bonus.charm_per_unit AS CHAR) charm_per_unit,CAST(JSON_UNQUOTE(JSON_EXTRACT(registry.metadata_json,'$.displayOrder')) AS UNSIGNED) display_order,JSON_UNQUOTE(JSON_EXTRACT(item.metadata_json,'$.sourceHash')) source_hash,JSON_UNQUOTE(JSON_EXTRACT(item.metadata_json,'$.catalogVersion')) catalog_version FROM castle_battle_item_bonus_definitions bonus JOIN item_definitions item ON item.id=bonus.item_id AND item.active=TRUE JOIN object_aliases alias ON alias.object_type='ITEM' AND alias.alias_type='item_code' AND alias.alias_value=item.code JOIN object_registry registry ON registry.id=alias.object_id AND registry.object_type='ITEM' AND registry.active=TRUE JOIN object_source_bindings binding ON binding.object_id=registry.id AND binding.object_type='ITEM' AND binding.source_system='legacy-json' AND binding.source_table='data/itemInfo.json#castleItem' WHERE bonus.active=TRUE";

// MariaDB 캐슬 유닛 행을 공용 카탈로그 형태로 변환한다.
function map(row: Row): CastleUnitRecord {
  return { unitCode:row.unit_code,objectKey:row.object_key,itemCode:row.item_code,sourceKey:row.source_key,displayName:row.display_name,charmPerUnit:row.charm_per_unit,displayOrder:Number(row.display_order),sourceHash:row.source_hash,catalogVersion:row.catalog_version,reusedCanonical:REUSED.has(row.item_code) };
}

export class MariaCastleUnitRepository {
  constructor(private readonly database: DatabaseClient) {}

  async listActive(): Promise<CastleUnitRecord[]> {
    const rows=await this.database.query<Row[]>(`${SELECT} ORDER BY display_order`);
    return rows.map(map);
  }

  async findBySource(sourceKey: string): Promise<CastleUnitRecord | undefined> {
    const rows=await this.database.query<Row[]>(`${SELECT} AND binding.source_key=? LIMIT 1`,[sourceKey]);
    return rows[0]===undefined?undefined:map(rows[0]);
  }
}
