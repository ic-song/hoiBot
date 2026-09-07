import assert from "node:assert/strict";
import fs from "node:fs";
import {describe,it} from "node:test";
import {validateObjectDataModelContract,type ObjectDataModelContract} from "../src/catalog/object-data-model-contract.js";

const migration=fs.readFileSync(new URL("../migrations/486_private_chat_denial_notice.sql",import.meta.url),"utf8");
const rollback=fs.readFileSync(new URL("../migrations/rollback/486_private_chat_denial_notice.rollback.sql",import.meta.url),"utf8");
const objectManifest=JSON.parse(fs.readFileSync(new URL("../../migration-control/contracts/object-data-model-standard.v1.json",import.meta.url),"utf8")) as {registeredMigrations:string[];tables:Array<{table:string}>};
const schemaPlan=JSON.parse(fs.readFileSync(new URL("../../migration-control/contracts/object-db-consumer-additive-schema-plan.v1.json",import.meta.url),"utf8")) as {amendmentMigrations:Array<{migration:string;creates:string[]}>;supportTablesBeyondRequiredReceipts:string[];tables:Array<{table:string}>};

const tables=["private_chat_denial_counters","private_chat_denial_attempts","private_chat_denial_notification_channels"];

describe("private chat denial notice schema",()=>{
  it("uses descriptive CUID keys, exact identity/event/operation FKs, and one environment destination",()=>{
    assert.match(migration,/private_chat_denial_counter_id CHAR\(8\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL/);
    assert.match(migration,/private_chat_denial_attempt_id CHAR\(8\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL/);
    assert.match(migration,/private_chat_denial_notification_channel_id CHAR\(8\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL/);
    assert.match(migration,/FOREIGN KEY\(provider_code,external_user_id\) REFERENCES external_identities\(provider_code,external_user_id\)/);
    assert.match(migration,/UNIQUE KEY uq_private_chat_denial_counter_environment_identity\(environment_code,database_identity,provider_code,external_user_id\)/);
    assert.match(migration,/UNIQUE KEY uq_private_chat_denial_counter_environment_ref\(private_chat_denial_counter_id,environment_code,database_identity\)/);
    assert.match(migration,/FOREIGN KEY\(private_chat_denial_counter_id,environment_code,database_identity\) REFERENCES private_chat_denial_counters\(private_chat_denial_counter_id,environment_code,database_identity\)/);
    assert.match(migration,/FOREIGN KEY\(event_id\) REFERENCES event_inbox\(event_id\)/);
    assert.match(migration,/FOREIGN KEY\(app_wiring_operation_id\) REFERENCES canonical_app_wiring_operations\(app_wiring_operation_id\)/);
    assert.match(migration,/UNIQUE KEY uq_private_chat_denial_notification_environment\(environment_code,database_identity\)/);
    assert.match(migration,/FOREIGN KEY\(provider_code,external_channel_id\) REFERENCES channels\(provider_code,external_channel_id\)/);
    assert.doesNotMatch(migration,/FOREIGN KEY\([^)]*\) REFERENCES operations\(id\)/);
    assert.doesNotMatch(migration,/\n\s+id\s+/);
  });

  it("constrains counters, reasons, delivery, hashes and every audit timestamp without operational seed data",()=>{
    assert.match(migration,/CHECK\(attempt_count>=1\)/);
    assert.match(migration,/CHECK\(attempt_ordinal>=1\)/);
    assert.equal((migration.match(/CHECK\(environment_code IN \('dev','prod'\)\)/g)??[]).length,3);
    assert.equal((migration.match(/CHECK\(CHAR_LENGTH\(database_identity\)>0\)/g)??[]).length,3);
    assert.match(migration,/denial_reason IN \('PRIVATE_HOI_PASS_REQUIRED','PRIVATE_CHAT_BLOCKED'\)/);
    assert.match(migration,/notification_disposition IN \('NOT_DUE','QUEUED','DISABLED'\)/);
    assert.equal((migration.match(/REGEXP '\^\[0-9a-f\]\{64\}\$'/g)??[]).length,3);
    assert.equal((migration.match(/INSERT_TIME REGEXP/g)??[]).length,3);
    assert.equal((migration.match(/UPDATE_TIME REGEXP/g)??[]).length,3);
    assert.doesNotMatch(migration,/INSERT INTO/i);
    assert.doesNotMatch(migration,/호이|Admin|Master|room[-_ ]?id/i);
  });

  it("drops only the three new tables in reverse dependency order",()=>{
    const drops=[...rollback.matchAll(/DROP TABLE IF EXISTS ([a-z0-9_]+);/g)].map(match=>match[1]);
    assert.deepEqual(drops,["private_chat_denial_attempts","private_chat_denial_notification_channels","private_chat_denial_counters"]);
    assert.doesNotMatch(rollback,/DELETE|UPDATE|ALTER/i);
    for(const table of tables)assert.match(rollback,new RegExp(`EXISTS\\(SELECT 1 FROM ${table}\\)`));
    assert.match(rollback,/SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ROLLBACK_486_PRIVATE_CHAT_DENIAL_ROWS_EXIST'/);
    assert.ok(rollback.indexOf("SIGNAL SQLSTATE")<rollback.indexOf("DROP TABLE IF EXISTS private_chat_denial_attempts"));
  });

  it("registers migration 486 and all three tables in both schema contracts",()=>{
    assert.equal(objectManifest.registeredMigrations.includes("486_private_chat_denial_notice.sql"),true);
    const manifestTables=new Set(objectManifest.tables.map(row=>row.table));
    const planTables=new Set(schemaPlan.tables.map(row=>row.table));
    const supportTables=new Set(schemaPlan.supportTablesBeyondRequiredReceipts);
    for(const table of tables){
      assert.equal(manifestTables.has(table),true,`${table} missing from object manifest`);
      assert.equal(planTables.has(table),true,`${table} missing from additive plan`);
      assert.equal(supportTables.has(table),true,`${table} missing from additive support list`);
    }
    const amendment=schemaPlan.amendmentMigrations.find(row=>row.migration==="486_private_chat_denial_notice.sql");
    assert.deepEqual(amendment?.creates,tables);
  });

  it("pins event_inbox exactly and rejects dependency or local FK shape drift",()=>{
    assert.doesNotThrow(()=>validateObjectDataModelContract(objectManifest as unknown as ObjectDataModelContract));
    const dependencyDrift=structuredClone(objectManifest) as unknown as ObjectDataModelContract;
    const eventDependency=dependencyDrift.externalDependencies?.find(row=>row.table==="event_inbox");
    assert.ok(eventDependency);
    (eventDependency.columns[0] as {type:string}).type="VARCHAR(127)";
    assert.throws(()=>validateObjectDataModelContract(dependencyDrift),/OBJECT_DATA_MODEL_EXTERNAL_DEPENDENCY_COLUMNS:event_inbox/);
    const localDrift=structuredClone(objectManifest) as unknown as ObjectDataModelContract;
    const attemptTable=localDrift.tables.find(row=>row.table==="private_chat_denial_attempts");
    assert.ok(attemptTable);
    (attemptTable.columns.find(row=>row.name==="event_id") as {collation:string}).collation="utf8mb4_bin";
    assert.throws(()=>validateObjectDataModelContract(localDrift),/OBJECT_DATA_MODEL_FK_SHAPE:private_chat_denial_attempts.event_id/);
    const environmentDrift=structuredClone(objectManifest) as unknown as ObjectDataModelContract;
    const environmentAttempt=environmentDrift.tables.find(row=>row.table==="private_chat_denial_attempts");
    assert.ok(environmentAttempt);
    (environmentAttempt.columns.find(row=>row.name==="database_identity") as {type:string}).type="VARCHAR(63)";
    assert.throws(()=>validateObjectDataModelContract(environmentDrift),/OBJECT_DATA_MODEL_FK_SHAPE:private_chat_denial_attempts.database_identity/);
  });
});
