import assert from "node:assert/strict";
import fs from "node:fs";
import {describe,it} from "node:test";
const migration=fs.readFileSync(new URL("../migrations/484_pet_skill_info_shadow_ingress.sql",import.meta.url),"utf8");
const rollback=fs.readFileSync(new URL("../migrations/rollback/484_pet_skill_info_shadow_ingress.rollback.sql",import.meta.url),"utf8");
describe("pet skill info shadow migration",()=>{
  it("backfills the frozen tier range before adding its constraint and splits only info aliases",()=>{
    assert.ok(migration.indexOf("UPDATE canonical_pet_skill_definitions")<migration.indexOf("ADD CONSTRAINT chk_canonical_pet_skill_info_tier_charm"));
    assert.match(migration,/WHEN 'skill_060' THEN 100000/);assert.match(migration,/WHEN 'skill_089' THEN 25000000/);
    assert.match(migration,/'PET_SKILL_INFO','pet_skill_info','VERIFIED_USER','SHADOW'/);
    assert.doesNotMatch(migration,/'\/펫스킬확률'/);assert.doesNotMatch(migration,/'\/펫스킬'(?:,|')/);
  });
  it("restores both historical aliases before disabling and dropping the additive metadata",()=>{
    assert.match(rollback,/rollback_preflight_guard/);assert.match(rollback,/command_routing_decisions WHERE command_code='PET_SKILL_INFO'/);
    assert.ok(rollback.indexOf("UPDATE command_aliases")<rollback.indexOf("DELETE FROM command_registry"));
    assert.match(rollback,/command_code='PET_SKILL_READ'/);assert.match(rollback,/DROP COLUMN castle_charm_bonus/);
  });
});
