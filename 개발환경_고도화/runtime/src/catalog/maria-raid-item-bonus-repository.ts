import type { DatabaseClient } from "../database.js";
import type { RaidItemBonusRecord } from "./raid-item-bonus-catalog.js";
interface Row { bonus_code:string;object_key:string;item_code:string;department_code:string;source_item_key:string;display_name:string;raid_exp_bonus:bigint;display_order:number;source_hash:string;catalog_version:string; }
const SELECT="SELECT bonus.bonus_code,registry.object_key,item.code item_code,bonus.department_code,bonus.source_item_key,bonus.display_name,bonus.raid_exp_bonus,bonus.display_order,bonus.source_hash,bonus.catalog_version FROM raid_item_bonus_definitions bonus JOIN object_registry registry ON registry.id=bonus.object_id AND registry.object_type='ITEM' AND registry.active=TRUE JOIN item_definitions item ON item.id=bonus.item_id AND item.active=TRUE WHERE bonus.active=TRUE";
function map(row:Row):RaidItemBonusRecord{return{bonusCode:row.bonus_code,objectKey:row.object_key,itemCode:row.item_code,department:row.department_code,sourceKey:row.source_item_key,displayName:row.display_name,raidExpBonus:row.raid_exp_bonus,displayOrder:Number(row.display_order),sourceHash:row.source_hash,catalogVersion:row.catalog_version,reusedCanonical:row.item_code==="ITEM-RWD-043"};}
export class MariaRaidItemBonusRepository {
 constructor(private readonly database:DatabaseClient){}
 async listActive():Promise<RaidItemBonusRecord[]>{const rows=await this.database.query<Row[]>(SELECT+" ORDER BY bonus.display_order");return rows.map(map);}
 async findBySource(department:string,sourceKey:string):Promise<RaidItemBonusRecord|undefined>{const rows=await this.database.query<Row[]>(SELECT+" AND bonus.department_code=? AND bonus.source_item_key=? LIMIT 1",[department,sourceKey]);return rows[0]===undefined?undefined:map(rows[0]);}
}