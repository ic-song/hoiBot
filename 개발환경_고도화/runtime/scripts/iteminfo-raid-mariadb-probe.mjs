import assert from "node:assert/strict";
import fs from "node:fs";
import mariadb from "mariadb";
const fixture=JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/iteminfo-raid-definitions-v1.json",import.meta.url),"utf8"));
const c=await mariadb.createConnection({host:process.env.HOIBOT_DB_HOST||"127.0.0.1",port:Number(process.env.HOIBOT_DB_PORT||"3306"),user:process.env.HOIBOT_DB_USER||"root",password:process.env.HOIBOT_DB_PASSWORD||"",database:process.env.HOIBOT_DB_NAME});
try{
 const rows=await c.query("SELECT bonus.bonus_code,registry.object_key,item.code item_code,bonus.department_code,bonus.source_item_key,bonus.display_name,bonus.raid_exp_bonus,bonus.display_order,bonus.source_hash,bonus.catalog_version FROM raid_item_bonus_definitions bonus JOIN object_registry registry ON registry.id=bonus.object_id JOIN item_definitions item ON item.id=bonus.item_id WHERE bonus.active=TRUE ORDER BY bonus.display_order");
 const actual=rows.map((row)=>({bonusCode:row.bonus_code,objectKey:row.object_key,itemCode:row.item_code,department:row.department_code,sourceKey:row.source_item_key,sourceIdentity:row.department_code+"/"+row.source_item_key,displayName:row.display_name,raidExpBonus:Number(row.raid_exp_bonus),displayOrder:Number(row.display_order),sourceHash:row.source_hash,sourceFileHash:fixture.sourceFileHash,catalogVersion:row.catalog_version,reusedCanonical:row.item_code==="ITEM-RWD-043"}));
 assert.deepEqual(actual,fixture.rows);
 const counts=(await c.query("SELECT (SELECT COUNT(*) FROM raid_item_bonus_definitions WHERE active=TRUE) definitions,(SELECT COUNT(*) FROM object_registry WHERE object_key LIKE 'item.raid.special-%') objects,(SELECT COUNT(*) FROM object_source_bindings WHERE source_table='data/itemInfo.json#raidSpecialItem') bindings,(SELECT COUNT(*) FROM item_definitions WHERE JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.objectType'))='raid_special_item' AND active=TRUE) items"))[0];
 assert.deepEqual([Number(counts.definitions),Number(counts.objects),Number(counts.bindings),Number(counts.items)],[9,9,9,9]);
 console.log(JSON.stringify({result:"passed",checks:8,definitions:9,items:9,objects:9,bindings:9,reused:"ITEM-RWD-043"}));
}finally{await c.end();}