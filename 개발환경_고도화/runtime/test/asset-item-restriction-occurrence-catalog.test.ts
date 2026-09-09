import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { describe, it } from "node:test";
import { MariaAssetItemRestrictionCatalogProvider } from "../src/catalog/asset-item-restriction-catalog.js";

const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/asset-item-restriction-occurrence-v1.json", import.meta.url), "utf8"));
const migration = fs.readFileSync(new URL("../migrations/418_asset_item_restriction_occurrence_catalog.sql", import.meta.url), "utf8");
const rollback = fs.readFileSync(new URL("../../migration-control/rollback/418_asset_item_restriction_occurrence_catalog.sql", import.meta.url), "utf8");

describe("asset item restriction occurrence catalog", () => {
  it("pins the exact classified source and counts", () => {
    assert.equal(fixture.sourceRevision, "5925b83b1dbfb78ef583354604e112b9430003f3");
    assert.equal(fixture.sourceSha256, "b6f4751f2faf7588c2e41c032bac4fc5b05ff6bd2c105ea0c57a0e072c60c402");
    assert.deepEqual(fixture.policies.map((policy: { rowCount: number; uniqueCount: number }) => [policy.rowCount, policy.uniqueCount]), [[674, 670], [504, 503]]);
  });

  it("preserves all five duplicate groups as ordered occurrences", () => {
    const duplicates = fixture.policies.flatMap((policy: { restrictionKind: string; definitions: Array<{ displayName: string; occurrenceCount: number }> }) =>
      policy.definitions.filter((row) => row.occurrenceCount > 1).map((row) => `${policy.restrictionKind}:${row.displayName}:${row.occurrenceCount}`));
    assert.equal(duplicates.length, 5);
    assert.ok(duplicates.includes("untradable:초보자 스타터패키지🎁[17](/초보오픈17):2"));
    for (const policy of fixture.policies) {
      assert.deepEqual(policy.occurrences.map((row: { sourceOrder: number }) => row.sourceOrder), Array.from({ length: policy.rowCount }, (_, index) => index + 1));
      assert.equal(new Set(policy.occurrences.map((row: { definitionHash: string }) => row.definitionHash)).size, policy.uniqueCount);
    }
  });

  it("retains first-match removal semantics without clearing a later duplicate", () => {
    for (const policy of fixture.policies) {
      const duplicate = policy.definitions.find((row: { occurrenceCount: number }) => row.occurrenceCount > 1);
      if (!duplicate) continue;
      const values = policy.occurrences.map((row: { rawValue: string }) => row.rawValue);
      values.splice(values.indexOf(duplicate.displayName), 1);
      assert.ok(values.includes(duplicate.displayName));
    }
  });

  it("separates immutable sets, definitions, and occurrence rows", () => {
    assert.match(migration, /CREATE TABLE IF NOT EXISTS asset_item_restriction_sets/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS asset_item_restriction_definitions/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS asset_item_restriction_occurrences/);
    assert.match(migration, /PRIMARY KEY \(restriction_set_id,source_order\)/);
    assert.doesNotMatch(migration, /UNIQUE KEY[^\n]*display_name/i);
  });

  it("does not mutate legacy restrictions, ownership, or consumers", () => {
    for (const protectedTable of ["item_restrictions", "inventory_stacks", "inventory_ledger", "currency_ledger", "package_catalog"]) {
      assert.doesNotMatch(migration, new RegExp(`(?:INSERT|UPDATE|DELETE)\\s+(?:INTO\\s+|FROM\\s+)?${protectedTable}`, "i"));
    }
    assert.doesNotMatch(migration, /command_registry|command_aliases|object_registry|object_source_bindings/i);
  });

  it("is transactional, idempotent, and narrowly reversible", () => {
    assert.match(migration, /^SET NAMES utf8mb4;\s*START TRANSACTION;/);
    assert.equal((migration.match(/ON DUPLICATE KEY UPDATE/g) ?? []).length, 3);
    assert.match(migration, /COMMIT;\s*$/);
    assert.match(rollback, /DROP TABLE IF EXISTS asset_item_restriction_occurrences/);
    assert.doesNotMatch(rollback, /item_restrictions|item_definitions|inventory_/i);
  });

  it("reads exact contiguous policy rows through the provider", async () => {
    const policy = fixture.policies[0];
    const query = async <T>(sql: string): Promise<T> => {
      if (sql.includes("FROM asset_item_restriction_sets")) return [{
        id: 1n, catalog_version: fixture.catalogVersion, restriction_kind: policy.restrictionKind,
        source_path: fixture.sourcePath, source_key: policy.sourceKey, source_sha256: fixture.sourceSha256,
        source_row_count: BigInt(policy.rowCount), source_unique_count: BigInt(policy.uniqueCount), publication_status: "SHADOW"
      }] as T;
      return policy.occurrences.map((row: { sourceOrder: number; definitionHash: string; rawValue: string }) => ({
        source_order: BigInt(row.sourceOrder), definition_hash: row.definitionHash, raw_value: row.rawValue, canonical_item_id: null
      })) as T;
    };
    const provider = new MariaAssetItemRestrictionCatalogProvider({ query });
    const result = await provider.readPolicy(fixture.catalogVersion, "non_item");
    assert.equal(result?.occurrences.length, 674);
    assert.equal(result?.sourceUniqueCount, 670);
    assert.equal(crypto.createHash("sha256").update(result!.occurrences.map((row) => row.rawValue).join("\0")).digest("hex").length, 64);
  });
});
