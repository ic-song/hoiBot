import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const fixturePath = fileURLToPath(new URL("../../migration-control/fixtures/synthetic-relational/package-a74-static-coverage-v1.json", import.meta.url));
const itemSnapshotPath = fileURLToPath(new URL("../../migration-control/fixtures/synthetic-relational/item-definition-snapshot-v1.json", import.meta.url));
const dualFixturePath = fileURLToPath(new URL("../../migration-control/fixtures/synthetic-relational/package-canonical-item-dual-consumer-parity-v1.json", import.meta.url));
const migrationRoot = fileURLToPath(new URL("../migrations/", import.meta.url));
const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

type CoverageRow = { code: string; definitionMigrations: string[]; catalogConsumeMigrations: string[]; rewardTargetMigrations: string[]; bindingClass: "PRODUCT_ONLY" | "REWARD_ONLY" | "BOTH" | "UNBOUND"; sourceBindingMode: "STATIC_LITERAL" | "DB_DRIVEN_LITERAL0"; orphan: boolean };
type Fixture = { hashes: { membershipSha256: string; coverageMatrixSha256: string; sourceMigrationSetSha256: string }; counts: Record<string, number>; sourceMigrations: Record<string, string>; rows: CoverageRow[]; scopeGuards: Record<string, string | number | boolean> };
type Snapshot = { rows: Array<{ code: string; boundary: string }> };
type Dual = { codes: string[]; unresolvedExcludedCodes: string[] };
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture;
const snapshot = JSON.parse(readFileSync(itemSnapshotPath, "utf8")) as Snapshot;
const dual = JSON.parse(readFileSync(dualFixturePath, "utf8")) as Dual;
const canonicalRows = (rows: CoverageRow[]): string => rows.map((row) => [row.code,row.bindingClass,row.sourceBindingMode,row.definitionMigrations.join(","),row.catalogConsumeMigrations.join(","),row.rewardTargetMigrations.join(",")].join("|")).join("\n");

describe("Lease2407 package A74 static coverage snapshot", () => {
  it("freezes the exact A74 membership and source-derived hash", () => {
    const excluded = new Set([...dual.codes, ...dual.unresolvedExcludedCodes]);
    const expected = snapshot.rows.filter((row) => row.boundary === "PACKAGE_COMPATIBILITY" && !excluded.has(row.code)).map((row) => row.code).sort();
    assert.equal(expected.length, 74);
    assert.deepEqual(fixture.rows.map((row) => row.code), expected);
    assert.equal(sha256(expected.join("\n")), fixture.hashes.membershipSha256);
  });

  it("freezes definition74 catalog21 reward45 and the four exclusive binding classes", () => {
    assert.deepEqual(fixture.counts, { membership:74, definitionCoverage:74, catalogConsumeCoverage:21, rewardTargetCoverage:45, productOnly:19, rewardOnly:43, both:2, unbound:10, duplicate:0, conflict:0, orphan:0, gap:0, extra:0 });
    assert.equal(fixture.rows.filter((row) => row.definitionMigrations.length > 0).length, 74);
    assert.equal(fixture.rows.filter((row) => row.catalogConsumeMigrations.length > 0).length, 21);
    assert.equal(fixture.rows.filter((row) => row.rewardTargetMigrations.length > 0).length, 45);
    assert.equal(sha256(canonicalRows(fixture.rows)), fixture.hashes.coverageMatrixSha256);
  });

  it("keeps DB-driven literal0 unbound rows out of orphan diagnostics", () => {
    const unbound = fixture.rows.filter((row) => row.bindingClass === "UNBOUND");
    assert.equal(unbound.length, 10);
    for (const row of unbound) {
      assert.equal(row.sourceBindingMode, "DB_DRIVEN_LITERAL0");
      assert.ok(row.definitionMigrations.length > 0);
      assert.deepEqual(row.catalogConsumeMigrations, []);
      assert.deepEqual(row.rewardTargetMigrations, []);
      assert.equal(row.orphan, false);
    }
    assert.equal(fixture.counts.orphan, 0);
  });

  it("proves every static role against its exact source migration", () => {
    const sources = new Map<string, string>();
    for (const file of Object.keys(fixture.sourceMigrations)) sources.set(file, readFileSync(migrationRoot + file, "utf8"));
    for (const row of fixture.rows) {
      for (const file of row.definitionMigrations) { const source = sources.get(file); assert.ok(source); assert.match(source, /package_item_definitions/); assert.ok(source.includes("'" + row.code + "'")); }
      for (const file of row.catalogConsumeMigrations) { const source = sources.get(file); assert.ok(source); assert.match(source, /package_catalog/); assert.ok(source.includes("'" + row.code + "'")); }
      for (const file of row.rewardTargetMigrations) { const source = sources.get(file); assert.ok(source); assert.match(source, /package_reward_rules/); assert.ok(source.includes("'" + row.code + "'")); }
    }
  });

  it("replays source hashes deterministically and keeps the source Shadow mutation-free", () => {
    const actual = Object.fromEntries(Object.keys(fixture.sourceMigrations).sort().map((file) => [file, sha256(readFileSync(migrationRoot + file, "utf8"))]));
    assert.deepEqual(actual, fixture.sourceMigrations);
    const canonical = Object.entries(actual).map(([file, hash]) => file + ":" + hash).join("\n");
    assert.equal(sha256(canonical), fixture.hashes.sourceMigrationSetSha256);
    assert.equal(sha256(canonicalRows(fixture.rows)), sha256(canonicalRows(fixture.rows)));
    assert.deepEqual(fixture.scopeGuards, { d1Code:"free_market_membership", d1Changed:false, runtimeChanges:0, providerChanges:0, ownershipChanges:0, schemaChanges:0, migrationFilesAdded:0, oldSchemaChanges:0, mainChanges:0, uiChanges:0, databaseWrites:0 });
  });
});
