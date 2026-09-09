import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import mariadb from "mariadb";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { createObjectAuditValues } from "../src/identity/object-identity-audit-provider.js";
import {
  buildElementalGradeBridgeManifest,
  ELEMENTAL_GRADE_BRIDGE_IDENTITY_NAMESPACE,
  ELEMENTAL_GRADE_BRIDGE_SOURCE_NAMESPACE,
  MariaElementalGradeDefinitionBridgeProvider,
  type ElementalGradeBridgeManifest,
  type ElementalGradeBridgeStagingRecord
} from "../src/data-migration/elemental-grade-definition-bridge-provider.js";
import { calculateEquipmentGradeCommonStagingPayloadFingerprint } from "../src/data-migration/equipment-grade-definition-adapter.js";

const integration=process.env.RUN_ELEMENTAL_GRADE_BRIDGE_MARIADB_INTEGRATION==="true"?describe:describe.skip;
const sha256=(value:string):string=>createHash("sha256").update(value,"utf8").digest("hex");
interface LegacyNumericRow {
  grade_order:number|string|bigint; success_rate:string; drop_rate:string; item_cost:string; point_cost:string; max_level:string;
  battle_exp:string; battle_upgrade_exp:string; raid_exp:string; raid_upgrade_exp:string; castle_exp:string; castle_upgrade_exp:string;
}
function numeric(value:unknown):number { return Number(String(value)); }
interface BridgeState { bridges:bigint; crosswalks:bigint; identities:bigint; }
function bridgeState(database:DatabaseClient):Promise<BridgeState[]> {
  return database.query("SELECT (SELECT COUNT(*) FROM canonical_elemental_grade_definition_bridges) bridges,(SELECT COUNT(*) FROM object_identity_crosswalks WHERE source_system='CATALOG_MANIFEST' AND source_namespace=?) crosswalks,(SELECT COUNT(*) FROM object_identities WHERE object_type='ELEMENTAL_GRADE_DEFINITION_BRIDGE') identities",[ELEMENTAL_GRADE_BRIDGE_IDENTITY_NAMESPACE]);
}
async function rollbackSnapshot(database:DatabaseClient):Promise<{schemaSha256:string;dataSha256:string;tableCount:bigint;migrationCount:bigint}> {
  const ddl=await database.query<Array<Record<string,unknown>>>("SHOW CREATE TABLE canonical_elemental_grade_definition_bridges");
  const data=await database.query<Array<Record<string,unknown>>>("SELECT 'bridge' source_kind,elemental_grade_definition_bridge_id identity_value,binding_fingerprint detail_value FROM canonical_elemental_grade_definition_bridges UNION ALL SELECT 'crosswalk',object_identity_id,source_identifier FROM object_identity_crosswalks WHERE source_system='CATALOG_MANIFEST' AND source_namespace='elemental-grade-definition.bridge.v1' UNION ALL SELECT 'identity',object_identity_id,object_type FROM object_identities WHERE object_type='ELEMENTAL_GRADE_DEFINITION_BRIDGE' ORDER BY source_kind,identity_value");
  const counts=await database.query<Array<{table_count:bigint;migration_count:bigint}>>("SELECT (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canonical_elemental_grade_definition_bridges') table_count,(SELECT COUNT(*) FROM schema_migrations WHERE version='477_elemental_grade_definition_bridge.sql') migration_count");
  const serializable=data.map((row)=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,typeof value==="bigint"?value.toString():value])));
  return {schemaSha256:sha256(JSON.stringify(ddl)),dataSha256:sha256(JSON.stringify(serializable)),tableCount:counts[0]!.table_count,migrationCount:counts[0]!.migration_count};
}

integration("elemental grade definition bridge actual Maria transaction",()=>{
  let database:DatabaseClient;
  let manifest:ElementalGradeBridgeManifest;
  let provider:MariaElementalGradeDefinitionBridgeProvider;
  let legacy:LegacyNumericRow[]=[];
  const audit=createObjectAuditValues("lease2554-integration",new Date("2026-09-05T10:30:00.000Z"));

  before(async()=>{
    database=createDatabaseClient({enabled:true,host:process.env.DATABASE_HOST??"127.0.0.1",port:Number(process.env.DATABASE_PORT??"3308"),user:process.env.DATABASE_USER??"lease2554_test",password:process.env.DATABASE_PASSWORD??"lease2554_local",name:process.env.DATABASE_NAME??"hoibot_rehearsal_elemental_bridge_2554",connectionLimit:4,connectTimeoutMs:5000});
    legacy=await database.query<LegacyNumericRow[]>("SELECT grade_order,CAST(success_rate AS CHAR) success_rate,CAST(drop_rate AS CHAR) drop_rate,CAST(item_cost AS CHAR) item_cost,CAST(point_cost AS CHAR) point_cost,CAST(max_level AS CHAR) max_level,CAST(battle_exp AS CHAR) battle_exp,CAST(battle_upgrade_exp AS CHAR) battle_upgrade_exp,CAST(raid_exp AS CHAR) raid_exp,CAST(raid_upgrade_exp AS CHAR) raid_upgrade_exp,CAST(castle_exp AS CHAR) castle_exp,CAST(castle_upgrade_exp AS CHAR) castle_upgrade_exp FROM elemental_enhancement_grades ORDER BY grade_order");
    assert.equal(legacy.length,61);
    const records:ElementalGradeBridgeStagingRecord[]=legacy.map((row,index)=>{
      const sourcePointer=`/elemental/sealed-synthetic-${String(index+1).padStart(3,"0")}`;
      const payloadJson=JSON.stringify({nameList:[`synthetic-alias-${index+1}`],emoji:"⚙️",upgrade:numeric(row.success_rate),drop:numeric(row.drop_rate),itemCost:numeric(row.item_cost),pointCost:numeric(row.point_cost),maxLevel:numeric(row.max_level),battleExp:numeric(row.battle_exp),battleUpgradeExp:numeric(row.battle_upgrade_exp),raidExp:numeric(row.raid_exp),raidUpgradeExp:numeric(row.raid_upgrade_exp),castleExp:numeric(row.castle_exp),castleUpgradeExp:numeric(row.castle_upgrade_exp)});
      return {gradeOrder:index+1,sourcePointer,sourceLocatorSha256:sha256(`lease2554-sealed-staging\0${sourcePointer}`),payloadFingerprint:calculateEquipmentGradeCommonStagingPayloadFingerprint(payloadJson),payloadJson,recordDomain:"pet-equipment",recordKind:"EQUIPMENT_GRADE_DEFINITION",projectionStatus:"PROJECT"};
    });
    manifest=buildElementalGradeBridgeManifest(records);
    await database.withTransaction(async(transaction)=>{
      for(let index=0;index<legacy.length;index++){
        const row=legacy[index]!,entry=manifest.entries[index]!;
        const definitionId=`e${String(index+1).padStart(7,"0")}`,crosswalkId=`x${String(index+1).padStart(7,"0")}`;
        await transaction.execute("INSERT INTO object_identities(object_identity_id,object_type,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES(?,?,?,?,?,?)",[definitionId,"CANONICAL_EQUIPMENT_GRADE_DEFINITION",audit.INSERT_USER,audit.INSERT_TIME,audit.UPDATE_USER,audit.UPDATE_TIME]);
        await transaction.execute("INSERT INTO object_identity_crosswalks(object_identity_crosswalk_id,object_identity_id,source_system,source_namespace,source_identifier,payload_fingerprint,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES(?,?,'LEGACY_JSON',?,?,?,?,?,?,?)",[crosswalkId,definitionId,ELEMENTAL_GRADE_BRIDGE_SOURCE_NAMESPACE,entry.sourceIdentifier,sha256(`canonical-payload-${index+1}`),audit.INSERT_USER,audit.INSERT_TIME,audit.UPDATE_USER,audit.UPDATE_TIME]);
        await transaction.execute("INSERT INTO canonical_equipment_grade_definitions(equipment_grade_definition_id,source_definition_pointer,equipment_family,equipment_grade_name,equipment_grade_emoji,enhancement_success_probability,enhancement_drop_probability,item_cost_quantity,point_cost_amount,maximum_enhancement_level,battle_base_experience_amount,battle_experience_per_enhancement_amount,raid_base_experience_amount,raid_experience_per_enhancement_amount,castle_base_experience_amount,castle_experience_per_enhancement_amount,active_flag,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES(?,?, 'elemental',?, '⚙️',?,?,?,?,?,?,?,?,?,?,?,TRUE,?,?,?,?)",[definitionId,records[index]!.sourcePointer,`synthetic-grade-${index+1}`,row.success_rate,row.drop_rate,row.item_cost,row.point_cost,row.max_level,row.battle_exp,row.battle_upgrade_exp,row.raid_exp,row.raid_upgrade_exp,row.castle_exp,row.castle_upgrade_exp,audit.INSERT_USER,audit.INSERT_TIME,audit.UPDATE_USER,audit.UPDATE_TIME]);
      }
    });
    let sequence=0;
    const collisionThenCuid=()=>sequence++===0?"e0000001":`b${String(sequence).padStart(7,"0")}`;
    provider=new MariaElementalGradeDefinitionBridgeProvider(database,collisionThenCuid,()=>new Date("2026-09-05T10:30:00.000Z"));
  });

  after(async()=>{
    try{
      await database.execute("DROP TRIGGER IF EXISTS lease2554_bridge_failure");
      await database.execute("DELETE FROM canonical_elemental_grade_definition_bridges");
      await database.execute("DELETE FROM object_identity_crosswalks WHERE source_system='CATALOG_MANIFEST' AND source_namespace=?",[ELEMENTAL_GRADE_BRIDGE_IDENTITY_NAMESPACE]);
      await database.execute("DELETE FROM object_identity_crosswalks WHERE source_system='LEGACY_JSON' AND source_namespace=?",[ELEMENTAL_GRADE_BRIDGE_SOURCE_NAMESPACE]);
      await database.execute("DELETE FROM canonical_equipment_grade_definitions WHERE equipment_family IN ('elemental','ring')");
      await database.execute("DELETE identity FROM object_identities identity LEFT JOIN object_identity_crosswalks crosswalk ON crosswalk.object_identity_id=identity.object_identity_id WHERE crosswalk.object_identity_id IS NULL AND identity.object_type IN ('CANONICAL_EQUIPMENT_GRADE_DEFINITION','ELEMENTAL_GRADE_DEFINITION_BRIDGE')");
    }finally{await database.close();}
  });

  it("fails closed before DML, rolls back forced failure, exact-replays, shadows, rolls back and restarts",async()=>{
    await database.execute("UPDATE canonical_equipment_grade_definitions SET equipment_family='ring',source_definition_pointer='/ring/sealed-synthetic-001' WHERE equipment_grade_definition_id='e0000001'");
    await assert.rejects(()=>provider.apply(manifest,"lease2554-ring"),/RING_FAMILY_DRIFT/);
    assert.deepEqual(await bridgeState(database),[{bridges:0n,crosswalks:0n,identities:0n}]);
    await database.execute("UPDATE canonical_equipment_grade_definitions SET equipment_family='elemental',source_definition_pointer='/elemental/sealed-synthetic-001' WHERE equipment_grade_definition_id='e0000001'");

    await database.execute("UPDATE object_identity_crosswalks SET source_namespace='drift.namespace' WHERE object_identity_id='e0000001' AND source_namespace=?",[ELEMENTAL_GRADE_BRIDGE_SOURCE_NAMESPACE]);
    await assert.rejects(()=>provider.apply(manifest,"lease2554-namespace"),/NAMESPACE_DRIFT/);
    assert.deepEqual(await bridgeState(database),[{bridges:0n,crosswalks:0n,identities:0n}]);
    await database.execute("UPDATE object_identity_crosswalks SET source_namespace=? WHERE object_identity_id='e0000001' AND source_namespace='drift.namespace'",[ELEMENTAL_GRADE_BRIDGE_SOURCE_NAMESPACE]);

    await database.execute("UPDATE canonical_equipment_grade_definitions SET battle_base_experience_amount=battle_base_experience_amount+1 WHERE equipment_grade_definition_id='e0000001'");
    await assert.rejects(()=>provider.apply(manifest,"lease2554-numeric"),/NUMERIC_TUPLE_DRIFT/);
    assert.deepEqual(await bridgeState(database),[{bridges:0n,crosswalks:0n,identities:0n}]);
    await database.execute("UPDATE canonical_equipment_grade_definitions SET battle_base_experience_amount=battle_base_experience_amount-1 WHERE equipment_grade_definition_id='e0000001'");

    await database.execute("UPDATE elemental_enhancement_grades SET grade_order=62 WHERE grade_order=61");
    await assert.rejects(()=>provider.apply(manifest,"lease2554-order"),/LEGACY_ORDER_DRIFT/);
    assert.deepEqual(await bridgeState(database),[{bridges:0n,crosswalks:0n,identities:0n}]);
    await database.execute("UPDATE elemental_enhancement_grades SET grade_order=61 WHERE grade_order=62");

    await database.execute("CREATE TRIGGER lease2554_bridge_failure BEFORE INSERT ON canonical_elemental_grade_definition_bridges FOR EACH ROW IF NEW.elemental_grade_order=2 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='LEASE2554_FORCED_FAILURE'; END IF");
    await assert.rejects(()=>provider.apply(manifest,"lease2554-forced"),/LEASE2554_FORCED_FAILURE/);
    assert.deepEqual(await bridgeState(database),[{bridges:0n,crosswalks:0n,identities:0n}]);
    await database.execute("DROP TRIGGER lease2554_bridge_failure");

    const first=await provider.apply(manifest,"lease2554-apply");
    assert.deepEqual(first,{insertedRows:61,replayed:false,manifestSha256:manifest.manifestSha256});
    const beforeReplay=await bridgeState(database);
    assert.deepEqual(beforeReplay,[{bridges:61n,crosswalks:61n,identities:61n}]);
    const replay=await provider.apply(manifest,"lease2554-replay");
    assert.deepEqual(replay,{insertedRows:0,replayed:true,manifestSha256:manifest.manifestSha256});
    assert.deepEqual(await bridgeState(database),beforeReplay);
    const shadow=await provider.shadow(manifest);
    assert.deepEqual(shadow,{exactRows:61,manifestSha256:manifest.manifestSha256});
    assert.deepEqual(await bridgeState(database),beforeReplay);

    assert.equal(await provider.rollback(manifest),61);
    assert.deepEqual(await bridgeState(database),[{bridges:0n,crosswalks:0n,identities:0n}]);
    assert.deepEqual(await database.query("SELECT (SELECT COUNT(*) FROM elemental_enhancement_grades) legacy_rows,(SELECT COUNT(*) FROM canonical_equipment_grade_definitions WHERE equipment_family='elemental') canonical_rows"),[{legacy_rows:61n,canonical_rows:61n}]);
    const restarted=await provider.apply(manifest,"lease2554-restart");
    assert.equal(restarted.insertedRows,61);
    assert.equal(await provider.rollback(manifest),61);
    assert.equal(await provider.rollback(manifest),0);
  });

  it("static rollback fails on orphan crosswalk or identity before DDL and preserves schema/data hashes",async()=>{
    const rollbackSql=readFileSync(new URL("../migrations/rollback/477_elemental_grade_definition_bridge.rollback.sql",import.meta.url),"utf8");
    const connection=await mariadb.createConnection({host:process.env.DATABASE_HOST??"127.0.0.1",port:Number(process.env.DATABASE_PORT??"3308"),user:process.env.DATABASE_USER??"lease2554_test",password:process.env.DATABASE_PASSWORD??"lease2554_local",database:process.env.DATABASE_NAME??"hoibot_rehearsal_elemental_bridge_2554",multipleStatements:true,bigIntAsNumber:false});
    try{
      await database.execute("INSERT INTO object_identities(object_identity_id,object_type,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES('o0000001','ELEMENTAL_GRADE_DEFINITION_BRIDGE',?,?,?,?)",[audit.INSERT_USER,audit.INSERT_TIME,audit.UPDATE_USER,audit.UPDATE_TIME]);
      await database.execute("INSERT INTO object_identity_crosswalks(object_identity_crosswalk_id,object_identity_id,source_system,source_namespace,source_identifier,payload_fingerprint,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES('w0000001','o0000001','CATALOG_MANIFEST',?,?,?, ?,?,?,?)",[ELEMENTAL_GRADE_BRIDGE_IDENTITY_NAMESPACE,sha256("orphan-crosswalk-source"),sha256("orphan-crosswalk-payload"),audit.INSERT_USER,audit.INSERT_TIME,audit.UPDATE_USER,audit.UPDATE_TIME]);
      assert.deepEqual(await bridgeState(database),[{bridges:0n,crosswalks:1n,identities:1n}]);
      const beforeCrosswalk=await rollbackSnapshot(database);
      await assert.rejects(()=>connection.query(rollbackSql),/Subquery returns more than 1 row|ER_SUBQUERY_NO_1_ROW/);
      const afterCrosswalk=await rollbackSnapshot(database);
      assert.deepEqual(afterCrosswalk,beforeCrosswalk);
      assert.deepEqual(afterCrosswalk,{...beforeCrosswalk,tableCount:1n,migrationCount:1n});
      await database.execute("DELETE FROM object_identity_crosswalks WHERE object_identity_crosswalk_id='w0000001'");
      await database.execute("DELETE FROM object_identities WHERE object_identity_id='o0000001'");

      await database.execute("INSERT INTO object_identities(object_identity_id,object_type,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES('o0000002','ELEMENTAL_GRADE_DEFINITION_BRIDGE',?,?,?,?)",[audit.INSERT_USER,audit.INSERT_TIME,audit.UPDATE_USER,audit.UPDATE_TIME]);
      assert.deepEqual(await bridgeState(database),[{bridges:0n,crosswalks:0n,identities:1n}]);
      const beforeIdentity=await rollbackSnapshot(database);
      await assert.rejects(()=>connection.query(rollbackSql),/Subquery returns more than 1 row|ER_SUBQUERY_NO_1_ROW/);
      const afterIdentity=await rollbackSnapshot(database);
      assert.deepEqual(afterIdentity,beforeIdentity);
      assert.deepEqual(afterIdentity,{...beforeIdentity,tableCount:1n,migrationCount:1n});
      await database.execute("DELETE FROM object_identities WHERE object_identity_id='o0000002'");
      assert.deepEqual(await bridgeState(database),[{bridges:0n,crosswalks:0n,identities:0n}]);
    }finally{await connection.end();}
  });
});
