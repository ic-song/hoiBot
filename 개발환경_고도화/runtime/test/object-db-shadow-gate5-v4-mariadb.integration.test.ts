import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync,readFileSync } from "node:fs";
import { after,describe,it } from "node:test";
import { createDatabaseClient,type CapableDatabaseClient } from "../src/database.js";
import { applyObjectDomainImportProfileV2,applyObjectDomainImportProfileV4,parseObjectDomainImportProfileV2,parseObjectDomainImportTargetSchemaV4 } from "../src/data-migration/object-domain-import-profile.js";
import { OBJECT_DB_SHADOW_TABLE_PLAN,ObjectDbShadowValidationProvider,type ShadowRow,type ShadowValue } from "../src/data-migration/object-db-shadow-validation-provider.js";

type SchemaColumn={table:string;column:string;sqlType:string;nullable:boolean};
type BaseSchema={columns:SchemaColumn[]};
type ObjectModel={registeredMigrations:string[];tables:Array<{table:string}>};
type FixtureRow={canonical:ShadowRow;legacy:ShadowRow};
type Fixture={cases:Array<{rowsByTable:Record<string,FixtureRow[]>}>};
type IdentityRow={current_identity:string;session_identity:string;database_name:string;server_port:number};
type ReceiptPayload={migrationCount:number;registeredMigrationCount:number;registeredTableCount:number;effectiveColumnCount:number;directTargetCount:number;shadowTargetCount:number;schemaFingerprint:string;rowFingerprint:string;projectionFingerprint:string;sideEffectFingerprint:string};
type Receipt={format:"hoibot-object-db-shadow-gate5-v4-receipt-v1";payload:ReceiptPayload;payloadSha256:string};

const enabled=process.env.WBS782_SHADOW_V4_MARIADB_TEST==="true",phase=process.env.WBS782_SHADOW_V4_MARIADB_PHASE??"disabled",integration=enabled?describe:describe.skip;
const contractRoot=new URL("../../migration-control/contracts/",import.meta.url),migrationRoot=new URL("../migrations/",import.meta.url);
const readJson=<T>(url:URL):T=>JSON.parse(readFileSync(url,"utf8")) as T;
const fixture=readJson<Fixture>(new URL("../../migration-control/fixtures/synthetic-relational/object-db-shadow-validation-v1.json",import.meta.url));
const objectModel=readJson<ObjectModel>(new URL("object-data-model-standard.v1.json",contractRoot));
const baseSchema=readJson<BaseSchema>(new URL("object-domain-import-target-schema.v1.json",contractRoot));
const profileV2=parseObjectDomainImportProfileV2(readFileSync(new URL("object-domain-import-profile.v2.json",contractRoot),"utf8"));
const schemaV4=parseObjectDomainImportTargetSchemaV4(readFileSync(new URL("object-domain-import-target-schema.v4.json",contractRoot),"utf8"));
const effective=applyObjectDomainImportProfileV4(applyObjectDomainImportProfileV2({columns:baseSchema.columns,generatedBindings:[],foreignKeys:[],definitionTargets:[],directTargets:[...new Set(baseSchema.columns.map(column=>column.table))],domainTargets:{}},profileV2),schemaV4);
const migrationFiles=readdirSync(migrationRoot).filter(file=>/^\d+_[a-z0-9_]+\.sql$/i.test(file)).sort();
const config=(user:string,password:string)=>({enabled:true,host:process.env.DATABASE_HOST!,port:Number(process.env.DATABASE_PORT!),user,password,name:process.env.DATABASE_NAME!,connectionLimit:5,connectTimeoutMs:10_000});
const adminConfig=()=>config(process.env.WBS782_ADMIN_DATABASE_USER!,process.env.WBS782_ADMIN_DATABASE_PASSWORD!);
const shadowConfig=()=>config(process.env.WBS782_SHADOW_DATABASE_USER!,process.env.WBS782_SHADOW_DATABASE_PASSWORD!);
const sha=(value:string)=>createHash("sha256").update(value,"utf8").digest("hex");
const stable=(value:unknown):string=>{if(value===null||typeof value!=="object")return JSON.stringify(typeof value==="bigint"?value.toString():value);if(Array.isArray(value))return`[${value.map(stable).join(",")}]`;return`{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b,"en")).map(([key,entry])=>`${JSON.stringify(key)}:${stable(entry)}`).join(",")}}`;};
const seal=(payload:ReceiptPayload):Receipt=>({format:"hoibot-object-db-shadow-gate5-v4-receipt-v1",payload,payloadSha256:sha(stable(payload))});
const assertReceipt=(receipt:Receipt):void=>{assert.equal(receipt.format,"hoibot-object-db-shadow-gate5-v4-receipt-v1");assert.match(receipt.payloadSha256,/^[0-9a-f]{64}$/);assert.equal(receipt.payloadSha256,sha(stable(receipt.payload)),"WBS782_RECEIPT_TAMPERED");};
const dbValue=(value:ShadowValue):unknown=>{if(value&&typeof value==="object"&&!Array.isArray(value)){if(Object.keys(value).length===1&&Object.hasOwn(value,"$bigint"))return BigInt((value as {$bigint:string}).$bigint);return JSON.stringify(value);}if(Array.isArray(value))return JSON.stringify(value);return value;};
const legacyRows=():Record<string,readonly ShadowRow[]>=>Object.fromEntries(fixture.cases.flatMap(entry=>Object.entries(entry.rowsByTable).map(([table,rows])=>[table,rows.map(row=>row.legacy)])));
const required:Readonly<Record<string,Readonly<ShadowRow>>>={canonical_item_definitions:{item_kind:"synthetic",stackable_flag:true},canonical_equipment_definitions:{equipment_slot:"pendant"},canonical_mini_pet_definitions:{mini_pet_emoji:"🐣",mini_pet_grade:"synthetic"},canonical_mini_pet_enhancement_rules:{castle_charm_gain:0,raid_charm_gain:0,success_probability:"0.5",point_cost:0,stone_quantity:0},canonical_owned_member_title_instances:{acquired_time:"2026-06-22 23:30:00"},canonical_owned_pet_title_instances:{acquired_time:"2026-06-22 23:30:00"},canonical_owned_mini_pet_title_instances:{acquired_time:"2026-06-22 23:30:00"},canonical_pet_skill_definitions:{options_json:{}},canonical_currency_operations:{request_key:"wbs782-synthetic",operation_kind:"synthetic_credit",reason_key:"WBS782",payload_fingerprint:"a".repeat(64),operation_status:"completed"},canonical_package_reward_quarantines:{source_reward_identifier:"synthetic-reward",target_kind:"package",target_source_identifier:"synthetic-package",target_display_name:"가상 패키지🎁"},canonical_craft_recipe_definitions:{craft_recipe_kind:"item_exchange"}};
const normalizedType=(value:string):string=>value.trim().toLowerCase().replace(/\s+/g," ").replace(/^boolean$/,"tinyint(1)").replace(/^json$/,"longtext").replace(/\b(int|bigint|smallint|mediumint)\(\d+\)/g,"$1").replace(/\btinyint\((?!1\))\d+\)/g,"tinyint");

async function identity(database:CapableDatabaseClient):Promise<IdentityRow>{return(await database.query<IdentityRow[]>("SELECT CURRENT_USER() AS current_identity,USER() AS session_identity,DATABASE() AS database_name,@@port AS server_port"))[0]!;}
async function state(database:CapableDatabaseClient):Promise<{schemaFingerprint:string;rowFingerprint:string;sideEffectFingerprint:string}>{
  const schema=await database.query<Array<Record<string,unknown>>>("SELECT TABLE_NAME,COLUMN_NAME,ORDINAL_POSITION,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,ORDINAL_POSITION");
  const tables=(await database.query<Array<{TABLE_NAME:string}>>("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME")).map(row=>row.TABLE_NAME);
  const rows:Record<string,string>={},checksums:Record<string,string|null>={},side:Record<string,string>={};
  for(const table of tables){assert.match(table,/^[a-z][a-z0-9_]*$/);rows[table]=(await database.query<Array<{row_count:bigint}>>(`SELECT COUNT(*) row_count FROM ${table}`))[0]!.row_count.toString();const checksum=(await database.query<Array<{Checksum:bigint|null}>>(`CHECKSUM TABLE ${table}`))[0]!.Checksum;checksums[table]=checksum===null?null:checksum.toString();if(/outbox|receipt|audit|import|quarantine|ledger/.test(table))side[table]=rows[table]!;}
  return{schemaFingerprint:sha(stable(schema)),rowFingerprint:sha(stable({rows,checksums})),sideEffectFingerprint:sha(stable(side))};
}

integration("WBS782 V4 Shadow isolated MariaDB Gate5",()=>{
  let admin:CapableDatabaseClient|undefined,shadow:CapableDatabaseClient|undefined;
  after(async()=>{await shadow?.close();await admin?.close();});
  it("seals the exact V4 schema and proves SELECT-only repeat/restart invariance",async()=>{
    assert.equal(migrationFiles.length,478);assert.equal(objectModel.registeredMigrations.length,39);assert.equal(objectModel.tables.length,119);assert.equal(effective.columns.length,263);assert.equal(effective.directTargets.length,47);assert.equal(OBJECT_DB_SHADOW_TABLE_PLAN.length,45);
    assert.notEqual(Number(process.env.DATABASE_PORT),3306);admin=createDatabaseClient(adminConfig());const adminIdentity=await identity(admin);assert.equal(adminIdentity.database_name,process.env.DATABASE_NAME);assert.match(adminIdentity.current_identity,/^wbs782_admin@/);assert.match(adminIdentity.session_identity,/^wbs782_admin@/);assert.equal(Number(adminIdentity.server_port),3306);
    const applied=await admin.query<Array<{version:string;checksum:string}>>("SELECT version,checksum FROM schema_migrations ORDER BY version");assert.deepEqual(applied.map(row=>row.version),migrationFiles);for(const row of applied)assert.equal(row.checksum,sha(readFileSync(new URL(row.version,migrationRoot),"utf8")));
    const registered=new Set(applied.map(row=>row.version));for(const migration of objectModel.registeredMigrations)assert.equal(registered.has(migration),true,`registered migration missing: ${migration}`);
    const actualTables=new Set((await admin.query<Array<{TABLE_NAME:string}>>("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE'")).map(row=>row.TABLE_NAME));for(const table of objectModel.tables)assert.equal(actualTables.has(table.table),true,`registered table missing: ${table.table}`);
    const actualColumns=await admin.query<Array<{TABLE_NAME:string;COLUMN_NAME:string;COLUMN_TYPE:string;IS_NULLABLE:string}>>("SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()");const columnMap=new Map(actualColumns.map(column=>[`${column.TABLE_NAME}.${column.COLUMN_NAME}`,column]));
    for(const column of effective.columns){const actual=columnMap.get(`${column.table}.${column.column}`);assert.ok(actual,`effective column missing: ${column.table}.${column.column}`);assert.equal(normalizedType(actual.COLUMN_TYPE),normalizedType(column.sqlType),`effective type mismatch: ${column.table}.${column.column}`);assert.equal(actual.IS_NULLABLE==="YES",column.nullable,`effective nullability mismatch: ${column.table}.${column.column}`);}
    if(phase==="prepare"){await admin.withTransaction(async transaction=>{await transaction.execute("SET FOREIGN_KEY_CHECKS=0");for(const plan of [...OBJECT_DB_SHADOW_TABLE_PLAN].reverse())await transaction.execute(`DELETE FROM ${plan.table}`);await transaction.execute("SET FOREIGN_KEY_CHECKS=1");for(const entry of fixture.cases)for(const [table,rows] of Object.entries(entry.rowsByTable))for(const {canonical} of rows){const row={...(required[table]??{}),...canonical};const columns=[...Object.keys(row),"INSERT_USER","INSERT_TIME","UPDATE_USER","UPDATE_TIME"],values=[...Object.values(row).map(dbValue),"WBS782","2026-06-22 23:30:00","WBS782","2026-06-22 23:30:00"];await transaction.execute(`INSERT INTO ${table}(${columns.join(",")}) VALUES (${columns.map(()=>"?").join(",")})`,values);}});}else assert.equal(phase,"restart");
    const before=await state(admin);shadow=createDatabaseClient(shadowConfig());const shadowIdentity=await identity(shadow);assert.equal(shadowIdentity.database_name,process.env.DATABASE_NAME);assert.match(shadowIdentity.current_identity,/^wbs782_shadow@/);assert.match(shadowIdentity.session_identity,/^wbs782_shadow@/);assert.equal(Number(shadowIdentity.server_port),3306);
    await assert.rejects(shadow.execute("UPDATE canonical_players SET source_system='MUTATED' WHERE player_id='player01'"),error=>/denied|command denied/i.test(String(error)));
    const provider=new ObjectDbShadowValidationProvider(),first=await shadow.withReadOnlySnapshot(transaction=>provider.compare(transaction,{legacyRowsByTable:legacyRows()})),second=await shadow.withReadOnlySnapshot(transaction=>provider.compare(transaction,{legacyRowsByTable:legacyRows(),previousRunFingerprint:first.projectionFingerprint}));assert.equal(first.comparedTableCount,45);assert.equal(first.mismatchCount,0,JSON.stringify(first.mismatches));assert.equal(first.promotionAllowed,true);assert.equal(second.projectionFingerprint,first.projectionFingerprint);assert.equal(second.mismatchCount,0);
    await shadow.close();shadow=undefined;const afterState=await state(admin);assert.deepEqual(afterState,before);
    const receipt=seal({migrationCount:migrationFiles.length,registeredMigrationCount:objectModel.registeredMigrations.length,registeredTableCount:objectModel.tables.length,effectiveColumnCount:effective.columns.length,directTargetCount:effective.directTargets.length,shadowTargetCount:OBJECT_DB_SHADOW_TABLE_PLAN.length,...afterState,projectionFingerprint:first.projectionFingerprint});assertReceipt(receipt);const tampered=structuredClone(receipt);tampered.payload.effectiveColumnCount=262;assert.throws(()=>assertReceipt(tampered),/WBS782_RECEIPT_TAMPERED/);const resealedWrong=seal({...receipt.payload,directTargetCount:46});assert.throws(()=>{assertReceipt(resealedWrong);assert.equal(resealedWrong.payload.directTargetCount,47,"WBS782_RECEIPT_CONTRACT_DRIFT");},/WBS782_RECEIPT_CONTRACT_DRIFT/);
    process.stdout.write(`WBS782_GATE5_V4_RECEIPT ${JSON.stringify(receipt)}\n`);
  });
});
