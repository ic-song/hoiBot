import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {describe,it} from "node:test";

const migration=readFileSync(new URL("../migrations/487_pet_skill_info_direct_reply_canary.sql",import.meta.url),"utf8");
const rollback=readFileSync(new URL("../migrations/rollback/487_pet_skill_info_direct_reply_canary.rollback.sql",import.meta.url),"utf8");
const normalizeSql=(value:string)=>value.replace(/\s+/g," ").trim();

export const WBS770_SAFE_ROLLBACK_SQL=rollback;

describe("WBS770 pet skill info DIRECT reply canary migration",()=>{
  it("widens routing event ids to the shared 128-character UTF-8 contract without changing nullability or collation",()=>{
    assert.match(migration,/ALTER TABLE command_routing_decisions\s+MODIFY COLUMN event_id VARCHAR\(128\) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;/);
    assert.doesNotMatch(migration,/event_id VARCHAR\(100\)/);
  });

  it("promotes only the exact frozen PET_SKILL_INFO SHADOW definition and increments its version",()=>{
    const expected=normalizeSql(`
      UPDATE command_registry
      SET rollout_state='CANARY',version=version+1
      WHERE command_code='PET_SKILL_INFO'
        AND handler_key='pet_skill_info'
        AND auth_scope='VERIFIED_USER'
        AND enabled=TRUE
        AND version=1
        AND rollout_state='SHADOW';
    `);
    const update=normalizeSql(migration).match(/UPDATE command_registry .*?;/)?.[0];
    assert.equal(update,expected);
    assert.equal((migration.match(/UPDATE command_registry/g)??[]).length,1);
  });

  it("does not overwrite ACTIVE, LEGACY_ONLY, disabled, version-drifted, or differently wired definitions",()=>{
    assert.doesNotMatch(migration,/INSERT INTO command_registry|ON DUPLICATE KEY UPDATE/);
    assert.doesNotMatch(migration,/SET\s+(?:handler_key|auth_scope|enabled|version)\s*=/);
    assert.doesNotMatch(migration,/SET\s+rollout_state\s*=\s*'(?:ACTIVE|LEGACY_ONLY|SHADOW)'/);
    for(const guard of["handler_key='pet_skill_info'","auth_scope='VERIFIED_USER'","enabled=TRUE","version=1","rollout_state='SHADOW'"]){
      assert.match(migration,new RegExp(guard.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
    }
  });

  it("keeps rollback out of the forward migration and restores the exact SHADOW version-1 definition",()=>{
    assert.doesNotMatch(migration,/SET rollout_state='SHADOW'/);
    assert.doesNotMatch(migration,/ROLLBACK\s*;/i);
    assert.match(normalizeSql(WBS770_SAFE_ROLLBACK_SQL),/UPDATE command_registry SET rollout_state='SHADOW',version=1 WHERE command_code='PET_SKILL_INFO' AND handler_key='pet_skill_info' AND auth_scope='VERIFIED_USER' AND enabled=TRUE AND version=2 AND rollout_state='CANARY';/);
    assert.match(rollback,/MODIFY COLUMN event_id VARCHAR\(100\) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;/);
  });

  it("fails closed on registry, schema, or stored event-length drift before restoring shared schema",()=>{
    for(const guard of[
      "ROLLBACK_487_COMMAND_REGISTRY_DRIFT",
      "ROLLBACK_487_EVENT_ID_SCHEMA_DRIFT",
      "ROLLBACK_487_EVENT_ID_TOO_LONG",
      "ROLLBACK_487_COMMAND_REGISTRY_CONFLICT"
    ])assert.match(rollback,new RegExp(guard));
    assert.match(rollback,/COLUMN_TYPE='varchar\(128\)'/);
    assert.match(rollback,/IS_NULLABLE='NO'/);
    assert.match(rollback,/CHARACTER_SET_NAME='utf8mb4'/);
    assert.match(rollback,/COLLATION_NAME='utf8mb4_unicode_ci'/);
    assert.match(rollback,/CHAR_LENGTH\(event_id\)>100/);
    assert.doesNotMatch(rollback,/UPDATE command_registry[\s\S]*WHERE command_code<>'PET_SKILL_INFO'/);
  });
});
