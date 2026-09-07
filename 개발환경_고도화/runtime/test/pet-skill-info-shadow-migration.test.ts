import assert from "node:assert/strict";
import fs from "node:fs";
import {describe,it} from "node:test";
const migration=fs.readFileSync(new URL("../migrations/484_pet_skill_info_shadow_ingress.sql",import.meta.url),"utf8");
const rollback=fs.readFileSync(new URL("../migrations/rollback/484_pet_skill_info_shadow_ingress.rollback.sql",import.meta.url),"utf8");
const adminMigration=fs.readFileSync(new URL("../migrations/485_pet_skill_info_admin_bag_projection.sql",import.meta.url),"utf8");
const adminRollback=fs.readFileSync(new URL("../migrations/rollback/485_pet_skill_info_admin_bag_projection.rollback.sql",import.meta.url),"utf8");
const objectManifest=JSON.parse(fs.readFileSync(new URL("../../migration-control/contracts/object-data-model-standard.v1.json",import.meta.url),"utf8")) as {tables:Array<{table:string}>};
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
  it("adds only named CUID authority/rank projections with catalog FKs, deny semantics and frozen active marker uniqueness",()=>{
    assert.match(adminMigration,/pet_skill_info_admin_channel_authority_id CHAR\(8\).*ascii_bin NOT NULL/);
    assert.match(adminMigration,/player_pet_skill_rank_marker_projection_id CHAR\(8\).*ascii_bin NOT NULL/);
    assert.match(adminMigration,/FOREIGN KEY\(provider_code,external_channel_id\) REFERENCES channels\(provider_code,external_channel_id\)/);
    assert.match(adminMigration,/INSERT INTO admin_permissions\(code,display_name\)/);assert.match(adminMigration,/code IN \('manager','super_admin'\)/);
    assert.match(adminMigration,/operator_scope IN \('ADMIN','MASTER'\)/);assert.match(adminMigration,/authority_decision IN \('ALLOW','DENY'\)/);
    assert.match(adminMigration,/GENERATED ALWAYS AS \(CASE WHEN active_flag THEN marker_kind ELSE NULL END\) STORED/);
    assert.match(adminMigration,/assignment_status='UNASSIGNED' AND player_id IS NULL/);
    assert.match(adminMigration,/CREATE TABLE player_pet_skill_bag_import_completeness_projections/);
    assert.match(adminMigration,/quarantined_source_key_count=0 AND ignored_source_key_count=0/);
    assert.match(adminMigration,/catalog_set_fingerprint CHAR\(64\)/);assert.match(adminMigration,/stack_set_fingerprint CHAR\(64\)/);
    assert.match(adminMigration,/FOREIGN KEY\(player_id\) REFERENCES canonical_players\(player_id\)/);
    assert.match(adminMigration,/FOREIGN KEY\(object_domain_import_run_id\) REFERENCES data_migration_object_domain_import_runs\(object_domain_import_run_id\)/);
    for(const kind of ["CASTLE_LORD","STAR","CARROT","THERMO","MINI_PET","TOP_LEVEL","MC","INTIMACY"])assert.match(adminMigration,new RegExp(`'${kind}'`));
    assert.doesNotMatch(adminMigration,/CREATE TABLE .*premium|CREATE TABLE .*stack|CREATE TABLE .*catalog/i);
    assert.ok(adminRollback.indexOf("DROP TABLE IF EXISTS player_pet_skill_rank_marker_projections")<adminRollback.indexOf("DROP TABLE IF EXISTS pet_skill_info_admin_channel_authorities"));
    assert.ok(adminRollback.startsWith("DROP PROCEDURE IF EXISTS rollback_485_pet_skill_info_admin_bag_projection;"));assert.match(adminRollback,/SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ROLLBACK_485_PROJECTION_ROWS_EXIST'/);assert.ok(adminRollback.indexOf("SIGNAL SQLSTATE")<adminRollback.indexOf("DROP TABLE IF EXISTS player_pet_skill_bag_import_completeness_projections"));assert.doesNotMatch(adminRollback,/(?:DELETE FROM|DROP TABLE) admin_(?:permissions|role_permissions)/);
    const registered=new Set(objectManifest.tables.map(row=>row.table));
    for(const table of ["pet_skill_info_admin_channel_authorities","player_pet_skill_rank_marker_projections","player_pet_skill_bag_import_completeness_projections"])assert.equal(registered.has(table),true,`${table} must be registered in the object manifest`);
  });
});
