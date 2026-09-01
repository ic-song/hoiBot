import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

type Fixture = {
  databaseBoundary: { migrationCount: number; oldTables: string[]; currentTables: string[]; readOnly: boolean };
  counts: Record<string, number>;
  activeRows: { catalog: string[]; effectiveRewards: string[] };
  hashes: Record<string, string>;
  dropAssessment: Record<string, string | boolean>;
  scopeGuards: Record<string, boolean>;
};

const fixture = JSON.parse(readFileSync(fileURLToPath(new URL(
  "../../migration-control/fixtures/synthetic-relational/package-legacy-schema-data-parity-v1.json",
  import.meta.url,
)), "utf8")) as Fixture;
const oldDdl = readFileSync(fileURLToPath(new URL("../migrations/028_complete_legacy_domains.sql", import.meta.url)), "utf8");
const runtimeSourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
const oldTablePattern = /package_definitions|package_contents|package_purchases/g;
const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

function sourceFiles(root: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...sourceFiles(path));
    else if (extname(entry.name) === ".ts") result.push(path);
  }
  return result.sort();
}

describe("Lease2420 package legacy schema data parity", () => {
  it("freezes fresh migration counts and exact current effective rows", () => {
    assert.equal(fixture.databaseBoundary.migrationCount, 390);
    assert.deepEqual(fixture.databaseBoundary.oldTables, ["package_definitions", "package_contents", "package_purchases"]);
    assert.deepEqual(fixture.activeRows.catalog, ["package_5|LEGACY-PACKAGEINFO-v1|package_5|100|READY|1"]);
    assert.deepEqual(fixture.activeRows.effectiveRewards, ["package_5|1|ADD|USER|free_market_membership|1|1"]);
    assert.equal(fixture.counts.oldDefinitions, 0);
    assert.equal(fixture.counts.oldContents, 0);
    assert.equal(fixture.counts.oldPurchases, 0);
    assert.equal(fixture.counts.currentCatalogTotal, 60);
    assert.equal(fixture.counts.currentActiveCatalog, 1);
    assert.equal(fixture.counts.currentEnabledRules, 243);
    assert.equal(fixture.counts.currentEffectiveRules, 1);
  });

  it("pins stable mapping, sequence, orphan and duplicate diagnostics", () => {
    assert.equal(fixture.counts.directStableMappings, 0);
    assert.equal(fixture.counts.oldActiveWithoutCurrent, 0);
    assert.equal(fixture.counts.currentActiveWithoutOld, 1);
    assert.equal(fixture.counts.sourceBackedCurrentWithoutOld, 1);
    for (const key of [
      "oldContentOrphans", "oldPurchaseOrphans", "currentRuleOrphans", "oldCodeDuplicates",
      "currentPackageDuplicates", "currentRuleIdDuplicates", "oldSequenceGaps",
      "currentEffectiveSequenceGaps", "mappedSequenceMismatches",
    ]) assert.equal(fixture.counts[key], 0, key);
  });

  it("replays the exact canonical hashes", () => {
    const empty = sha256("");
    assert.equal(empty, fixture.hashes.emptySha256);
    assert.equal(fixture.hashes.oldDefinitionsSha256, empty);
    assert.equal(fixture.hashes.oldContentsSha256, empty);
    assert.equal(fixture.hashes.oldPurchasesSha256, empty);
    assert.equal(fixture.hashes.directMappingsSha256, empty);
    assert.equal(sha256(fixture.activeRows.catalog.join("\n")), fixture.hashes.activeCatalogSha256);
    assert.equal(sha256(fixture.activeRows.effectiveRewards.join("\n")), fixture.hashes.effectiveRewardsSha256);
  });

  it("proves runtime source references zero while preserving historical DDL", () => {
    const references = sourceFiles(runtimeSourceRoot).flatMap((path) => readFileSync(path, "utf8").match(oldTablePattern) ?? []);
    assert.equal(references.length, fixture.counts.runtimeSourceRefs);
    assert.match(oldDdl, /CREATE TABLE package_definitions/);
    assert.match(oldDdl, /CREATE TABLE package_contents/);
    assert.match(oldDdl, /CREATE TABLE package_purchases/);
    assert.equal((oldDdl.match(/ON DELETE RESTRICT/g) ?? []).length >= 3, true);
  });

  it("refuses drop-ready from zero rows or runtime-ref0 alone", () => {
    assert.deepEqual(fixture.dropAssessment, {
      dropReady: false,
      zeroRowsSufficient: false,
      runtimeRefsZeroSufficient: false,
      activeMappedParityComplete: false,
      purchaseHistoryPreservationRequired: true,
      productionSnapshotRequired: true,
      verifiedBackupRequired: true,
      verifiedRollbackRequired: true,
      currentOnlySourceDispositionRequired: true,
      reason: "fresh migration의 old row0과 runtime source ref0은 필요조건 일부일 뿐이며 active mapping, 운영 history snapshot, backup 및 rollback 증거가 없다",
    });
    assert.deepEqual(fixture.scopeGuards, {
      oldTableDrop: false, oldDataDelete: false, providerChanged: false, runtimeChanged: false,
      mainChanged: false, schemaChanged: false, migrationChanged: false, gate8: false,
    });
  });
});
