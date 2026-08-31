import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { MariaMiniPetCollectionRewardCatalogProvider } from "../src/catalog/mini-pet-collection-reward-catalog.js";

const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/mini-pet-collection-reward-catalog-v1.json", import.meta.url), "utf8"));
const migration = fs.readFileSync(new URL("../migrations/420_mini_pet_collection_reward_catalog.sql", import.meta.url), "utf8");
const rollback = fs.readFileSync(new URL("../../migration-control/rollback/420_mini_pet_collection_reward_catalog.sql", import.meta.url), "utf8");

describe("mini-pet collection reward catalog", () => {
  it("pins the exact source hash and 8 plus 100 reward rows", () => {
    assert.equal(fixture.sourceSha256, "3dadafd107bb82480d6d5218f98af2a31d0037af7c15b5fecaf8d3c62b9a4e39");
    assert.deepEqual(fixture.counts, { gradeRewards: 8, stageRewards: 100, titleDefinitions: 100, occurrences: 108 });
  });

  it("preserves source scope, key, order, quantity, and display identity", () => {
    assert.deepEqual(fixture.occurrences.map((row: { globalSourceOrder: number }) => row.globalSourceOrder), Array.from({ length: 108 }, (_, index) => index + 1));
    assert.deepEqual(fixture.occurrences.slice(0, 8).map((row: { sourceOrder: number }) => row.sourceOrder), Array.from({ length: 8 }, (_, index) => index + 1));
    assert.deepEqual(fixture.occurrences.slice(8).map((row: { sourceOrder: number }) => row.sourceOrder), Array.from({ length: 100 }, (_, index) => index + 1));
    assert.equal(new Set(fixture.occurrences.map((row: { displayIdentityHash: string }) => row.displayIdentityHash)).size, 108);
  });

  it("binds pet food only by stable code, object key, and source binding", () => {
    assert.deepEqual(fixture.rewardTarget, { definitionCode: "pet_food", objectKey: "item.direct_bag.3076ae479a9eb44e", displayName: "펫먹이🍼", ownershipModel: "STACK" });
    assert.match(migration, /definition_row\.code='pet_food'/);
    assert.match(migration, /registry\.object_key='item\.direct_bag\.3076ae479a9eb44e'/);
    assert.match(migration, /source_table='member\.bag'/);
  });

  it("never resolves titles by display name alone", () => {
    assert.match(migration, /source_table='data\/miniPetCollectionInfo\.json#titles'/);
    assert.match(migration, /source_binding\.source_key=row_data\.source_key/);
    assert.doesNotMatch(migration, /JOIN title_definitions title_definition ON title_definition\.display_name/);
    assert.match(migration, /'UNRESOLVED'/);
    assert.match(migration, /'CONFLICT'/);
  });

  it("does not mutate ownership, consumers, or canonical definitions", () => {
    for (const protectedTable of ["inventory_stacks", "inventory_ledger", "mini_pet_collection_entries", "mini_pet_title_assignments", "player_titles", "pet_titles", "command_registry"]) {
      assert.doesNotMatch(migration, new RegExp(`(?:INSERT|UPDATE|DELETE)\\s+(?:INTO\\s+|FROM\\s+)?${protectedTable}`, "i"));
    }
    assert.doesNotMatch(migration, /INSERT INTO (?:item_definitions|title_definitions|object_registry|object_source_bindings)/i);
  });

  it("is transactional, idempotent, and narrowly reversible", () => {
    assert.match(migration, /^SET NAMES utf8mb4;\s*START TRANSACTION;/);
    assert.equal((migration.match(/ON DUPLICATE KEY UPDATE/g) ?? []).length, 2);
    assert.match(migration, /COMMIT;\s*$/);
    assert.match(rollback, /DROP TABLE IF EXISTS mini_pet_collection_reward_occurrences/);
    assert.doesNotMatch(rollback, /item_definitions|title_definitions|inventory_/i);
  });

  it("reads all ordered rows and exposes unresolved title bindings", async () => {
    const query = async <T>(sql: string): Promise<T> => {
      if (sql.includes("FROM mini_pet_collection_reward_catalogs")) return [{
        id: 1n, catalog_version: fixture.catalogVersion, source_path: fixture.sourcePath, source_sha256: fixture.sourceSha256,
        grade_reward_count: 8n, stage_reward_count: 100n, title_definition_count: 100n,
        reward_item_id: 10n, reward_item_object_id: 20n, reward_item_code: "pet_food", reward_item_object_key: fixture.rewardTarget.objectKey,
        reward_item_display_name: fixture.rewardTarget.displayName, ownership_model: "STACK", publication_status: "SHADOW"
      }] as T;
      return fixture.occurrences.map((row: Record<string, unknown>) => ({
        global_source_order: BigInt(row.globalSourceOrder as number), source_scope: row.sourceScope, source_key: row.sourceKey,
        source_order: BigInt(row.sourceOrder as number), raw_item_display_name: row.rawItemDisplayName, quantity: BigInt(row.quantity as number),
        title_display_name: row.titleDisplayName, title_price: row.titlePrice === null ? null : BigInt(row.titlePrice as number),
        canonical_title_id: null, title_resolution: row.sourceScope === "GRADE" ? "NOT_APPLICABLE" : "UNRESOLVED", display_identity_hash: row.displayIdentityHash
      })) as T;
    };
    const result = await new MariaMiniPetCollectionRewardCatalogProvider({ query }).readCatalog(fixture.catalogVersion);
    assert.equal(result?.occurrences.length, 108);
    assert.equal(result?.occurrences.filter((row) => row.titleResolution === "UNRESOLVED").length, 100);
    assert.equal(result?.rewardTarget.itemCode, "pet_food");
  });
});
