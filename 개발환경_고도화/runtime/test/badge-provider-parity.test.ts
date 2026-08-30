import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

type Provider = { providerId: string; boundary: string; sourcePath: string; sourceTokens: string[]; line: string };
type Fixture = {
  baseline: string;
  canonical: { versionId: string; definitions: number; runtimeDisplay: number; awardLifecycle: number; contentHash: string; seriesCounts: Record<string, number> };
  providers: Provider[];
  stateTables: string[];
  directServices: string[];
  requiredScenarios: string[];
  mariaExpected: Record<string, string | number>;
  hashes: Record<string, string>;
  carryForward: string[];
  invariants: Record<string, string | number | boolean>;
};

const fixture = JSON.parse(fs.readFileSync(new URL(
  "../../migration-control/fixtures/synthetic-relational/badge-provider-parity-v1.json", import.meta.url,
), "utf8")) as Fixture;
const canonical = JSON.parse(fs.readFileSync(new URL(
  "../../migration-control/evidence/home-badge-inventory/v2400-home-badge-definitions.json", import.meta.url,
), "utf8")) as { contentHash: string; counts: Record<string, number>; definitions: Array<{ badge_code: string; source_code: string }> };
const evidence = JSON.parse(fs.readFileSync(new URL(
  "../../migration-control/evidence/badge-provider-parity/slice.json", import.meta.url,
), "utf8")) as { sliceId: string; scope: Record<string, number | boolean>; gates: Record<string, boolean> };
const runtimeRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceDir = path.join(runtimeRoot, "src");
const testDir = path.join(runtimeRoot, "test");
const scriptsDir = path.join(runtimeRoot, "scripts");
const sha256Lines = (lines: readonly string[]): string => createHash("sha256").update(lines.toSorted().join("\n")).digest("hex");

test("freezes canonical204 display127 award77 and ten provider identities", () => {
  assert.equal(fixture.baseline, "9899eac1f5de4bb9147a8af31788f0a0ececf5c7");
  assert.equal(canonical.definitions.length, 204);
  assert.equal(canonical.contentHash, fixture.canonical.contentHash);
  assert.deepEqual(fixture.canonical.seriesCounts, { achievement: 64, special: 13, gacha: 57, mbti: 20, love: 50 });
  assert.equal(fixture.canonical.runtimeDisplay, 127);
  assert.equal(fixture.canonical.awardLifecycle, 77);
  assert.equal(fixture.providers.length, 10);
  assert.equal(new Set(fixture.providers.map((row) => row.providerId)).size, 10);
  assert.equal(sha256Lines(fixture.providers.map((row) => row.line)), fixture.hashes.providerMatrixSha256);
});

test("pins every provider to its existing source contract", () => {
  for (const provider of fixture.providers) {
    const source = fs.readFileSync(path.join(sourceDir, provider.sourcePath), "utf8");
    for (const token of provider.sourceTokens) assert.ok(source.includes(token), `${provider.providerId}:${token}`);
    assert.doesNotMatch(source, /owned_badges/);
  }
  assert.deepEqual(fixture.providers.filter((row) => row.providerId.startsWith("gacha_")).map((row) => row.boundary), ["gacha57", "mbti20", "love50"]);
});

test("freezes seven state tables, five ownership surfaces and eight services", () => {
  assert.equal(fixture.stateTables.length, 7);
  assert.equal(sha256Lines(fixture.stateTables), fixture.hashes.stateTablesSha256);
  assert.equal(fixture.directServices.length, 8);
  assert.equal(sha256Lines(fixture.directServices), fixture.hashes.directServicesSha256);
  for (const relative of fixture.directServices) assert.equal(fs.existsSync(path.join(runtimeRoot, relative.replace(/^runtime\//, ""))), true, relative);
  assert.equal(fixture.invariants.assignmentAndLegacyProjectionDualRead, true);
  assert.equal(fixture.invariants.tombstoneBlocksRegrant, true);
  assert.equal(fixture.invariants.ownershipEquipmentConsistent, true);
});

test("requires replay rollback reconnect deleted and duplicate reward scenarios", () => {
  assert.deepEqual(fixture.requiredScenarios, [
    "normal", "dual_read", "ownership_consistency", "equipment_consistency", "deleted_no_regrant",
    "duplicate_point_reward", "replay", "idempotency", "transaction_rollback", "reconnect",
  ]);
  assert.deepEqual(fixture.mariaExpected, {
    providerOperations: 12,
    auditRows: 12,
    outboxRows: 12,
    duplicatePointReward: "100000000",
    deletedBadgeRegrants: 0,
    rollbackResidue: 0,
    wrongSequenceRows: 0,
  });
});

test("carries every provider-specific Maria entry point forward", () => {
  for (const file of fixture.carryForward) {
    const directory = file.startsWith("probe-") ? scriptsDir : testDir;
    assert.equal(fs.existsSync(path.join(directory, file)), true, file);
  }
});

test("keeps provider schema object main UI and Gate8 changes at zero", () => {
  for (const key of ["newOwnedBadges", "badgeTypeChanges", "objectChanges", "providerChanges", "schemaChanges", "migrationChanges", "mainJsChanges", "uiChanges"]) {
    assert.equal(fixture.invariants[key], 0, key);
  }
  assert.equal(fixture.invariants.gate8, false);
  assert.equal(evidence.scope.operationalDbTouched, false);
  assert.deepEqual(evidence.gates, { gate1: true, gate2: true, gate3: true, gate4: true, gate5: true, gate6: true, gate7: true, gate8: false });
});
