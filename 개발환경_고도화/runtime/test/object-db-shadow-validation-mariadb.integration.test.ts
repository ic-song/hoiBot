import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { after,describe,it } from "node:test";
import { createDatabaseClient,type CapableDatabaseClient } from "../src/database.js";
import { OBJECT_DB_SHADOW_TABLE_PLAN,ObjectDbShadowValidationProvider,type ShadowRow,type ShadowValue } from "../src/data-migration/object-db-shadow-validation-provider.js";

type FixtureRow={canonical:ShadowRow;legacy:ShadowRow};type Fixture={cases:Array<{rowsByTable:Record<string,FixtureRow[]>}>};
const fixture=JSON.parse(readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/object-db-shadow-validation-v1.json",import.meta.url),"utf8")) as Fixture;
const enabled=process.env.WBS744_SHADOW_MARIADB_TEST==="true",phase=process.env.WBS744_SHADOW_MARIADB_PHASE??"disabled",integration=enabled?describe:describe.skip;
const rootConfig=()=>({enabled:true,host:process.env.DATABASE_HOST!,port:Number(process.env.DATABASE_PORT!),user:process.env.DATABASE_USER!,password:process.env.DATABASE_PASSWORD!,name:process.env.DATABASE_NAME!,connectionLimit:5,connectTimeoutMs:5_000});
const shadowConfig=()=>({...rootConfig(),user:process.env.WBS744_SHADOW_DATABASE_USER!,password:process.env.WBS744_SHADOW_DATABASE_PASSWORD!});
const REQUIRED_DATABASE_VALUES:Readonly<Record<string,Readonly<ShadowRow>>>={
  canonical_item_definitions:{item_kind:"synthetic",stackable_flag:true},
  canonical_equipment_definitions:{equipment_slot:"pendant"},
  canonical_mini_pet_definitions:{mini_pet_emoji:"🐣",mini_pet_grade:"synthetic"},
  canonical_mini_pet_enhancement_rules:{castle_charm_gain:0,raid_charm_gain:0,success_probability:"0.5",point_cost:0,stone_quantity:0},
  canonical_owned_member_title_instances:{acquired_time:"2026-06-22 23:30:00"},
  canonical_owned_pet_title_instances:{acquired_time:"2026-06-22 23:30:00"},
  canonical_owned_mini_pet_title_instances:{acquired_time:"2026-06-22 23:30:00"},
  canonical_pet_skill_definitions:{options_json:{}},
  canonical_currency_operations:{request_key:"wbs744-synthetic",operation_kind:"synthetic_credit",reason_key:"WBS744",payload_fingerprint:"a".repeat(64),operation_status:"completed"},
  canonical_package_reward_quarantines:{source_reward_identifier:"synthetic-reward",target_kind:"package",target_source_identifier:"synthetic-package",target_display_name:"가상 패키지🎁"},
  canonical_craft_recipe_definitions:{craft_recipe_kind:"item_exchange"}
};
function dbValue(value:ShadowValue):unknown{if(value&&typeof value==="object"&&!Array.isArray(value)){if(Object.keys(value).length===1&&Object.hasOwn(value,"$bigint"))return BigInt((value as {$bigint:string}).$bigint);return JSON.stringify(value);}if(Array.isArray(value))return JSON.stringify(value);return value;}
function legacyRows():Record<string,readonly ShadowRow[]>{return Object.fromEntries(fixture.cases.flatMap(entry=>Object.entries(entry.rowsByTable).map(([table,rows])=>[table,rows.map(row=>row.legacy)])));}
async function databaseFingerprint(database:CapableDatabaseClient):Promise<{fingerprint:string;sideCounts:Record<string,string>}>{
  const schema=await database.query<Array<Record<string,unknown>>>("SELECT TABLE_NAME,COLUMN_NAME,ORDINAL_POSITION,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,ORDINAL_POSITION");
  const tables=(await database.query<Array<{TABLE_NAME:string}>>("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME")).map(row=>row.TABLE_NAME);
  const counts:Record<string,string>={},checksums:Record<string,string|null>={},sideCounts:Record<string,string>={};
  for(const table of tables){assert.match(table,/^[a-z][a-z0-9_]*$/);counts[table]=(await database.query<Array<{count:bigint}>>(`SELECT COUNT(*) count FROM ${table}`))[0]!.count.toString();const checksum=(await database.query<Array<{Checksum:bigint|null}>>(`CHECKSUM TABLE ${table}`))[0]!.Checksum;checksums[table]=checksum===null?null:checksum.toString();if(/outbox|receipt|audit|import|quarantine|ledger/.test(table))sideCounts[table]=counts[table]!;}
  return {fingerprint:createHash("sha256").update(JSON.stringify({schema,counts,checksums},(_,value)=>typeof value==="bigint"?value.toString():value)).digest("hex"),sideCounts};
}

integration("WBS744 Shadow isolated MariaDB Gate5",()=>{
  let root:CapableDatabaseClient|undefined,shadow:CapableDatabaseClient|undefined;
  after(async()=>{await shadow?.close();await root?.close();});
  it("proves a read-only principal, all-table zero mutation, parity, and restart",async()=>{
    root=createDatabaseClient(rootConfig());
    if(phase==="prepare"){
      await root.execute("SET FOREIGN_KEY_CHECKS=0");for(const plan of [...OBJECT_DB_SHADOW_TABLE_PLAN].reverse())await root.execute(`DELETE FROM ${plan.table}`);await root.execute("SET FOREIGN_KEY_CHECKS=1");
      for(const entry of fixture.cases)for(const [table,rows] of Object.entries(entry.rowsByTable))for(const {canonical} of rows){const databaseRow={...(REQUIRED_DATABASE_VALUES[table]??{}),...canonical};const columns=[...Object.keys(databaseRow),"INSERT_USER","INSERT_TIME","UPDATE_USER","UPDATE_TIME"];const values=[...Object.values(databaseRow).map(dbValue),"WBS744","2026-06-22 23:30:00","WBS744","2026-06-22 23:30:00"];await root.execute(`INSERT INTO ${table}(${columns.join(",")}) VALUES (${columns.map(()=>"?").join(",")})`,values);}
    }else assert.equal(phase,"restart");
    const before=await databaseFingerprint(root);shadow=createDatabaseClient(shadowConfig());await assert.rejects(shadow.execute("UPDATE canonical_players SET source_system='MUTATED' WHERE player_id='player01'"));
    const provider=new ObjectDbShadowValidationProvider();const result=await shadow.withReadOnlySnapshot(transaction=>provider.compare(transaction,{legacyRowsByTable:legacyRows()}));
    assert.equal(result.comparedTableCount,45);assert.equal(result.mismatchCount,0,JSON.stringify(result.mismatches));assert.equal(result.promotionAllowed,true);
    const second=await shadow.withReadOnlySnapshot(transaction=>provider.compare(transaction,{legacyRowsByTable:legacyRows(),previousRunFingerprint:result.projectionFingerprint}));
    assert.equal(second.mismatchCount,0);assert.equal(second.projectionFingerprint,result.projectionFingerprint);
    await shadow.close();shadow=undefined;const afterState=await databaseFingerprint(root);assert.deepEqual(afterState.sideCounts,before.sideCounts);assert.equal(afterState.fingerprint,before.fingerprint);
  });
});
