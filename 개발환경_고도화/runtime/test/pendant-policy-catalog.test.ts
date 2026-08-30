import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import type { DatabaseClient } from "../src/database.js";
import { MariaPendantPolicyCatalogRepository } from "../src/pet/maria-pendant-policy-catalog-repository.js";
import { PendantPolicyCatalogReadProvider } from "../src/pet/pendant-policy-catalog.js";

const migration = fs.readFileSync(new URL("../migrations/400_pendant_policy_catalog.sql", import.meta.url), "utf8");
const rollback = fs.readFileSync(new URL("../../migration-control/rollback/400_pendant_policy_catalog.sql", import.meta.url), "utf8");
const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/pendant-policy-catalog-v1.json", import.meta.url), "utf8"));
const evidence = JSON.parse(fs.readFileSync(new URL("../../migration-control/evidence/pendant-policy-catalog/slice.json", import.meta.url), "utf8"));

test("seeds one published version header with the frozen policy hash", () => {
  assert.equal(fixture.headerRows, 1);
  assert.equal(fixture.policyCode, "PENDANT_ENHANCE_LEGACY");
  assert.equal(fixture.policyVersion, 1);
  assert.equal(fixture.publishState, "PUBLISHED");
  assert.match(migration, new RegExp(fixture.sourceHash));
});

test("seeds exact canonical levels one through thirty", () => {
  assert.equal(fixture.levelRows, 30);
  assert.deepEqual(fixture.levels.map((row: unknown[]) => row[0]), Array.from({ length: 30 }, (_, index) => index + 1));
  assert.equal((migration.match(/\(@pendant_policy_id,/g) ?? []).length, 30);
  assert.match(migration, /target_level BETWEEN 1 AND 30/);
});

test("Maria repository and read provider expose the published policy", async () => {
  const query = async (sql: string) => sql.includes("FROM pendant_upgrade_policy_versions")
    ? [{ id: 1n, policy_code: fixture.policyCode, policy_version: 1, publish_state: "PUBLISHED", source_hash: fixture.sourceHash }]
    : fixture.levels.map((row: [number, number, number, number, string, number]) => ({ target_level: row[0], success_rate: row[1].toFixed(4), charm_increment: BigInt(row[2]), explore_increment: row[3].toFixed(3), point_cost: BigInt(row[4]), stone_cost: BigInt(row[5]) }));
  const repository = new MariaPendantPolicyCatalogRepository({ query } as unknown as DatabaseClient);
  const policy = await new PendantPolicyCatalogReadProvider(repository).readPublished();
  assert.equal(policy.sourceHash, fixture.sourceHash);
  assert.equal(policy.levels.length, 30);
  assert.equal(policy.levels[29]?.pointCost, 100000000000n);
  assert.equal(policy.levels[29]?.stoneCost, 30n);
});

test("does not replicate policy into items or change consumers and ownership", () => {
  assert.doesNotMatch(migration, /item_definitions|inventory_instances|player_pet_pendants|pendant_upgrade_confirmations|object_registry|provider|admin/i);
  assert.equal(fixture.ownershipRowsMutated, 0);
  assert.equal(evidence.scope.enhanceConsumerTransitionIncluded, false);
  assert.equal(evidence.scope.itemMetadataReplicationIncluded, false);
});

test("is transactional idempotent and narrowly reversible", () => {
  assert.match(migration, /^SET NAMES utf8mb4;\s*START TRANSACTION;/);
  assert.equal((migration.match(/ON DUPLICATE KEY UPDATE/g) ?? []).length, 2);
  assert.match(migration, /COMMIT;\s*$/);
  assert.match(rollback, /^START TRANSACTION;/);
  assert.match(rollback, new RegExp(fixture.sourceHash));
  assert.doesNotMatch(rollback, /item_definitions|inventory_instances|player_pet_pendants|object_registry/i);
  assert.match(rollback, /COMMIT;\s*$/);
});
