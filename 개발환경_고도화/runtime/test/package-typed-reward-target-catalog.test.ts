import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { MariaPackageTypedRewardTargetCatalogProvider } from "../src/catalog/package-typed-reward-target-catalog.js";

const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/package-typed-reward-target-catalog-v1.json", import.meta.url), "utf8"));
const migration = fs.readFileSync(new URL("../migrations/424_package_typed_reward_target_catalog.sql", import.meta.url), "utf8");
const rollback = fs.readFileSync(new URL("../../migration-control/rollback/424_package_typed_reward_target_catalog.sql", import.meta.url), "utf8");

describe("package typed reward target catalog", () => {
  it("pins the approved Git object and complete source counts", () => {
    assert.equal(fixture.sourceRevision, "5925b83b1dbfb78ef583354604e112b9430003f3");
    assert.equal(fixture.sourceSha256, "4d2072a8e829391cb2ad546ca9ba37d7081c677bdb9e2dedbc7e08e12697e7dc");
    assert.deepEqual(fixture.counts, { packages: 107, rewards: 557, stackRows: 513, packageRows: 44, resolvedStackRows: 467, gapStackRows: 46, uniqueStackTargets: 58, uniquePackageTargets: 21 });
  });

  it("preserves package and reward source identity plus dense order", () => {
    assert.deepEqual(fixture.packages.map((row: { sourceOrder: number }) => row.sourceOrder), Array.from({ length: 107 }, (_, index) => index + 1));
    assert.deepEqual(fixture.occurrences.map((row: { globalSourceOrder: number }) => row.globalSourceOrder), Array.from({ length: 557 }, (_, index) => index + 1));
    assert.equal(new Set(fixture.packages.map((row: { sourcePackageId: string }) => row.sourcePackageId)).size, 107);
    assert.equal(new Set(fixture.occurrences.map((row: { identityHash: string }) => row.identityHash)).size, 557);
  });

  it("classifies nested packages only through exact source inventory keys", () => {
    const nested = fixture.occurrences.filter((row: { targetType: string }) => row.targetType === "PACKAGE");
    assert.equal(nested.length, 44);
    assert.equal(new Set(nested.map((row: { targetSourcePackageId: string }) => row.targetSourcePackageId)).size, 21);
    assert.ok(nested.every((row: { resolutionStatus: string; canonicalItemCode: null }) => row.resolutionStatus === "SOURCE_RESOLVED_CANONICAL_GAP" && row.canonicalItemCode === null));
  });

  it("binds STACK targets by frozen code and exact display, retaining gaps", () => {
    assert.match(migration, /canonical_item\.code=row_data\.canonical_item_code AND canonical_item\.display_name=row_data\.target_display_name AND canonical_item\.active=TRUE/);
    assert.equal(fixture.occurrences.filter((row: { resolutionStatus: string }) => row.resolutionStatus === "RESOLVED").length, 467);
    assert.equal(fixture.occurrences.filter((row: { resolutionStatus: string }) => row.resolutionStatus === "GAP").length, 46);
  });

  it("keeps legacy maxUseOnce as inert metadata", () => {
    const maxUseOnceValues = fixture.packages.map((row: { legacyMaxUseOnce: number }) => row.legacyMaxUseOnce) as number[];
    assert.deepEqual([...new Set<number>(maxUseOnceValues)].sort((a, b) => a - b), [100, 1000]);
    assert.ok(fixture.packages.every((row: { enforcementStatus: string }) => row.enforcementStatus === "INERT_METADATA"));
    assert.doesNotMatch(migration, /UPDATE\s+package_catalog/i);
  });

  it("does not mutate canonical, ownership, consumer, or ledger tables", () => {
    for (const table of ["item_definitions", "package_item_definitions", "package_catalog", "package_rewards", "package_reward_rules", "package_item_balances", "package_item_ledger", "inventory_stacks", "inventory_ledger", "command_registry"]) {
      assert.doesNotMatch(migration, new RegExp(`(?:INSERT|UPDATE|DELETE)\\s+(?:INTO\\s+|FROM\\s+)?${table}\\b`, "i"));
    }
    assert.match(rollback, /DROP TABLE IF EXISTS asset_package_reward_target_occurrences/);
    assert.doesNotMatch(rollback, /item_definitions|package_catalog|inventory_/i);
  });

  it("reads ordered typed targets and fails closed on parity drift", async () => {
    let calls = 0;
    const query = async <T>(): Promise<T> => {
      calls++;
      if (calls === 1) return [{ id: 1n, catalog_version: fixture.catalogVersion, source_revision: fixture.sourceRevision, source_path: fixture.sourcePath, source_sha256: fixture.sourceSha256, package_count: 107n, reward_count: 557n, stack_row_count: 513n, package_row_count: 44n, resolved_stack_row_count: 467n, gap_stack_row_count: 46n, publication_status: "SHADOW" }] as T;
      if (calls === 2) return fixture.packages.map((row: Record<string, unknown>) => ({ source_order: BigInt(row.sourceOrder as number), source_package_id: row.sourcePackageId, display_name: row.displayName, inventory_key: row.inventoryKey, description: row.description, enabled: row.enabled ? 1 : 0, legacy_max_use_once: BigInt(row.legacyMaxUseOnce as number), enforcement_status: row.enforcementStatus, identity_hash: row.identityHash })) as T;
      return fixture.occurrences.map((row: Record<string, unknown>) => ({ global_source_order: BigInt(row.globalSourceOrder as number), source_package_id: row.sourcePackageId, reward_order: BigInt(row.rewardOrder as number), raw_type: row.rawType, target_type: row.targetType, target_display_name: row.targetDisplayName, quantity: BigInt(row.quantity as number), target_source_package_id: row.targetSourcePackageId, canonical_item_code: row.canonicalItemCode, canonical_package_id: row.canonicalPackageId, resolution_status: row.resolutionStatus, identity_hash: row.identityHash })) as T;
    };
    const result = await new MariaPackageTypedRewardTargetCatalogProvider({ query }).readCatalog(fixture.catalogVersion);
    assert.equal(result?.packages.length, 107);
    assert.equal(result?.occurrences.length, 557);
    assert.equal(result?.occurrences.filter((row) => row.targetType === "PACKAGE").length, 44);
  });
});
