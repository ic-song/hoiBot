import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/package-canonical-gap-correction-v1.json", import.meta.url), "utf8"));
const migration = fs.readFileSync(new URL("../migrations/439_asset_package_canonical_gap_correction.sql", import.meta.url), "utf8");
const rollback = fs.readFileSync(new URL("../../migration-control/rollback/439_asset_package_canonical_gap_correction.sql", import.meta.url), "utf8");

describe("package canonical gap correction overlay", () => {
  it("pins ten exact source-bound occurrences without inventing identity", () => {
    assert.equal(fixture.bindings.length, 10);
    assert.equal(new Set(fixture.bindings.map((row: { globalSourceOrder: number }) => row.globalSourceOrder)).size, 10);
    assert.equal(new Set(fixture.bindings.map((row: { objectKey: string }) => row.objectKey)).size, 4);
    assert.match(migration, /legacy_binding\.source_system='LEGACY_JS'/);
    assert.match(migration, /legacy_binding\.source_table='member\.bag'/);
    assert.match(migration, /BINARY legacy_binding\.source_key=BINARY exact_binding\.target_display_name/);
  });

  it("preserves frozen parity and records effective overlay parity separately", () => {
    assert.deepEqual(fixture.frozen, { packages: 107, occurrences: 557, resolvedStack: 467, gapStack: 46, packageSourceResolvedCanonicalGap: 44 });
    assert.deepEqual(fixture.effective, { resolvedStack: 477, resolvedByExactSourceBinding: 10, residualStackGap: 36, residualPackageGap: 44, conflicts: 0 });
    assert.match(migration, /new_resolved_stack_count=467 AND new_gap_stack_count=46/);
    assert.match(migration, /effective_resolved_stack_count=477/);
    assert.doesNotMatch(migration, /UPDATE\s+asset_package_(?:typed_target_catalogs|reward_target_occurrences)/i);
  });

  it("uses the existing source-binding table as a versioned sidecar", () => {
    assert.equal(fixture.overlaySource.system, "RUNTIME_DB");
    assert.equal(fixture.overlaySource.table, "asset_package_reward_target_occurrences");
    assert.match(migration, /CONCAT\('ASSET-FREEZE-v2\.438-package-canonical-gap-correction-01#',resolved_occurrence\.global_source_order\)/);
    assert.match(migration, /publication_status\)\s*SELECT[\s\S]*'SHADOW'/);
  });

  it("does not change schema, providers, consumers, ownership, or ledgers", () => {
    assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS/i);
    for (const protectedTable of ["object_registry", "item_definitions", "package_catalog", "inventory_stacks", "inventory_ledger", "package_item_balances", "package_item_ledger", "command_registry"]) {
      assert.doesNotMatch(migration, new RegExp(`(?:INSERT|UPDATE|DELETE)\\s+(?:INTO\\s+|FROM\\s+)?${protectedTable}\\b`, "i"));
    }
  });

  it("is transactional, idempotent, and narrowly reversible", () => {
    assert.match(migration, /^SET NAMES utf8mb4;\s*START TRANSACTION;/);
    assert.match(migration, /ON DUPLICATE KEY UPDATE/);
    assert.match(migration, /COMMIT;\s*$/);
    assert.match(rollback, /DELETE FROM object_source_bindings/);
    assert.match(rollback, /DELETE FROM asset_package_typed_target_catalogs/);
    assert.doesNotMatch(rollback, /DROP TABLE|object_registry|item_definitions|package_catalog|inventory_/i);
  });
});
