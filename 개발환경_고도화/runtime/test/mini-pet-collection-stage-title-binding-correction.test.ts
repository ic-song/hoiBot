import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const migration = fs.readFileSync(new URL("../migrations/437_asset_minipet_collection_stage_title_binding_correction.sql", import.meta.url), "utf8");
const rollback = fs.readFileSync(new URL("../../migration-control/rollback/437_asset_minipet_collection_stage_title_binding_correction.sql", import.meta.url), "utf8");

describe("mini-pet collection stage title binding correction", () => {
  it("binds all 100 stage titles by stable source row and definition code", () => {
    assert.match(migration, /source_scope='MINI_PET_COLLECTION'/);
    assert.match(migration, /source_table='data\/miniPetCollectionInfo\.json#titles'/);
    assert.match(migration, /source_binding\.source_key=source_occurrence\.source_key/);
    assert.match(migration, /identity_row\.definition_code=JSON_UNQUOTE\(JSON_EXTRACT\(title_object\.metadata_json,'\$\.definitionCode'\)\)/);
    assert.match(migration, /object_count=100 AND binding_count=100/);
  });

  it("never merges title identity by display name", () => {
    assert.doesNotMatch(migration, /JOIN\s+title_definitions\s+\w+\s+ON\s+\w+\.display_name/i);
    assert.doesNotMatch(migration, /source_binding\.source_key\s*=\s*source_occurrence\.title_display_name/i);
    assert.match(migration, /identityContract','source_file\+source_section\+source_row\+definition_code'/);
  });

  it("creates a new immutable catalog version and preserves the old unresolved snapshot", () => {
    assert.match(migration, /ASSET-FREEZE-v2\.438-mini-pet-collection-reward-title-binding-01/);
    assert.match(migration, /old_occurrence_count=108 AND old_unresolved_count=100/);
    assert.match(migration, /new_occurrence_count=108 AND new_resolved_count=100 AND new_not_applicable_count=8 AND new_unresolved_count=0/);
    assert.doesNotMatch(migration, /UPDATE\s+mini_pet_collection_reward_(?:catalogs|occurrences)/i);
  });

  it("does not add schema, providers, ownership writes, or consumer cutover", () => {
    assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS (?:object_registry|object_source_bindings|mini_pet_collection_reward_catalogs)/i);
    for (const protectedTable of ["inventory_stacks", "inventory_ledger", "mini_pet_collection_entries", "mini_pet_title_assignments", "player_titles", "pet_titles", "command_registry"]) {
      assert.doesNotMatch(migration, new RegExp(`(?:INSERT|UPDATE|DELETE)\\s+(?:INTO\\s+|FROM\\s+)?${protectedTable}`, "i"));
    }
  });

  it("is transactional, idempotent, and narrowly reversible", () => {
    assert.match(migration, /^SET NAMES utf8mb4;\s*START TRANSACTION;/);
    assert.match(migration, /COMMIT;\s*$/);
    assert.match(rollback, /DELETE FROM mini_pet_collection_reward_catalogs/);
    assert.match(rollback, /data\/miniPetCollectionInfo\.json#titles/);
    assert.doesNotMatch(rollback, /DROP TABLE|title_definitions|inventory_/i);
  });
});
