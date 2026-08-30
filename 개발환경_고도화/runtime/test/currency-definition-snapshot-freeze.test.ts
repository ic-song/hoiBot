import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

type LineRow = { line: string };
type Membership = { count: number; sha256: string; token?: string };
type Snapshot = {
  baseline: string;
  counts: Record<string, number>;
  canonicalDefinitions: Array<LineRow & { code: string; scaleDigits: number; effectiveUnit: string; definitionVersion: null }>;
  sourceOwnerScopes: LineRow[];
  actualProjection: Array<LineRow & { code: string; disposition: string }>;
  accountLedgerModels: LineRow[];
  accountScopeIdentities: Array<LineRow & { code: string; scope: string; disposition: string }>;
  packageBoundary: Array<LineRow & { packageCode: string; canonicalCode: string; itemType: string }>;
  providerMembership: {
    playerAccountRefs: Membership;
    playerLedgerRefs: Membership;
    guildAccountRefs: Membership;
    guildLedgerRefs: Membership;
    union: Membership;
  };
  objectBoundary: { existingType: string; productionObjects: number; newTypeRequired: boolean; objectChangesInSlice: number };
  conflicts: Record<string, string | number | boolean>;
  hashes: Record<string, string>;
  forbiddenChanges: string[];
};

const fixturePath = fileURLToPath(new URL("../../migration-control/fixtures/synthetic-relational/currency-definition-snapshot-v1.json", import.meta.url));
const evidencePath = fileURLToPath(new URL("../../migration-control/evidence/currency-definition-snapshot-freeze/slice.json", import.meta.url));
const migrationsDir = fileURLToPath(new URL("../migrations", import.meta.url));
const sourceDir = fileURLToPath(new URL("../src", import.meta.url));
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as Snapshot;
const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8")) as { sliceId: string; gates: Record<string, boolean> };

function sha256Lines(rows: readonly LineRow[]): string {
  const value = rows.map((row) => row.line).toSorted((left, right) =>
    left.toLowerCase().localeCompare(right.toLowerCase()) || left.localeCompare(right)
  ).join("\n");
  return createHash("sha256").update(value).digest("hex");
}

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return entry.isFile() && entry.name.endsWith(".ts") ? [target] : [];
  });
}

function providerPaths(token: string): string[] {
  return sourceFiles(sourceDir)
    .filter((file) => fs.readFileSync(file, "utf8").includes(token))
    .map((file) => `개발환경_고도화/runtime/src\\${path.relative(sourceDir, file)}`)
    .toSorted();
}

function providerHash(paths: readonly string[]): string {
  return createHash("sha256").update(paths.join("\n")).digest("hex");
}

test("freezes canonical3, source-owner scope4, projection5 and account identities6", () => {
  assert.equal(fixture.baseline, "2ca3df665b3be2f8256dde1b635d3c088d524010");
  assert.equal(fixture.canonicalDefinitions.length, 3);
  assert.deepEqual(fixture.canonicalDefinitions.map((row) => row.code), ["diamond", "guild_fund", "point"]);
  assert.equal(fixture.sourceOwnerScopes.length, 4);
  assert.equal(fixture.actualProjection.length, 5);
  assert.equal(fixture.accountScopeIdentities.length, 6);
  assert.equal(sha256Lines(fixture.canonicalDefinitions), fixture.hashes.canonicalDefinitionsSha256);
  assert.equal(sha256Lines(fixture.sourceOwnerScopes), fixture.hashes.sourceOwnerScopeSha256);
  assert.equal(sha256Lines(fixture.actualProjection), fixture.hashes.actualProjectionSha256);
  assert.equal(sha256Lines(fixture.accountScopeIdentities), fixture.hashes.accountScopeIdentitiesSha256);
});

test("reconstructs all five definition projections from ordered migration sources", () => {
  const migration005 = fs.readFileSync(path.join(migrationsDir, "005_player_profile.sql"), "utf8");
  const migration038 = fs.readFileSync(path.join(migrationsDir, "038_independent_package_rewards.sql"), "utf8");
  const migration044 = fs.readFileSync(path.join(migrationsDir, "044_package_domain_projection.sql"), "utf8");
  const migration057 = fs.readFileSync(path.join(migrationsDir, "057_inventory_diamond_box_open.sql"), "utf8");
  const migration308 = fs.readFileSync(path.join(migrationsDir, "308_admin_member_voice_auth_reward.sql"), "utf8");
  const migration362 = fs.readFileSync(path.join(migrationsDir, "362_admin_guild_warehouse_resource_grant.sql"), "utf8");
  assert.match(migration005, /\('point', '포인트', 3\)/);
  assert.match(migration005, /\('diamond', '다이아', 3\)/);
  assert.match(migration038, /\('ITEM-RWD-011','POINT','포인트'/);
  assert.match(migration044, /WHERE item_type = 'POINT'/);
  assert.match(migration044, /currencyCode.*item_id/s);
  assert.match(migration057, /\('diamond','다이아',0,TRUE\)/);
  assert.match(migration308, /\('POINT','포인트',0,TRUE\)/);
  assert.match(migration362, /\('guild_fund','길드자금',0,TRUE\)/);
});

test("freezes the two versioned owner-account and append-only ledger models", () => {
  const migration005 = fs.readFileSync(path.join(migrationsDir, "005_player_profile.sql"), "utf8");
  const migration007 = fs.readFileSync(path.join(migrationsDir, "007_domain_foundations.sql"), "utf8");
  assert.equal(fixture.accountLedgerModels.length, 2);
  assert.equal(sha256Lines(fixture.accountLedgerModels), fixture.hashes.accountLedgerModelsSha256);
  assert.match(migration005, /CREATE TABLE currency_accounts[\s\S]*version BIGINT UNSIGNED/);
  assert.match(migration007, /CREATE TABLE currency_ledger/);
  assert.match(migration007, /CREATE TABLE guild_resource_accounts[\s\S]*version BIGINT UNSIGNED/);
  assert.match(migration007, /CREATE TABLE guild_resource_ledger/);
});

test("recomputes the exact provider57 membership and all four source hashes", () => {
  const memberships = [
    fixture.providerMembership.playerAccountRefs,
    fixture.providerMembership.playerLedgerRefs,
    fixture.providerMembership.guildAccountRefs,
    fixture.providerMembership.guildLedgerRefs,
  ];
  const all = new Set<string>();
  for (const membership of memberships) {
    const paths = providerPaths(membership.token!);
    assert.equal(paths.length, membership.count);
    assert.equal(providerHash(paths), membership.sha256);
    paths.forEach((value) => all.add(value));
  }
  const union = [...all].toSorted();
  assert.equal(union.length, fixture.providerMembership.union.count);
  assert.equal(providerHash(union), fixture.providerMembership.union.sha256);
  assert.equal(providerHash(union), fixture.hashes.providerUnionSha256);
});

test("keeps package POINT compatibility separate from ITEM and currency identity", () => {
  assert.equal(fixture.packageBoundary.length, 3);
  assert.deepEqual(fixture.packageBoundary.map((row) => row.packageCode), ["diamond", "ITEM-RWD-011", "point"]);
  assert.ok(fixture.packageBoundary.every((row) => row.itemType === "POINT"));
  assert.equal(sha256Lines(fixture.packageBoundary), fixture.hashes.packageBoundarySha256);
  assert.deepEqual(new Set(fixture.packageBoundary.map((row) => row.canonicalCode)), new Set(["diamond", "point"]));
});

test("records scoped POINT ambiguity, residue and effective integer mismatch without a global alias", () => {
  assert.equal(fixture.conflicts.globalPointAliasAllowed, false);
  assert.equal(fixture.conflicts.pointPlayerResolution, "POINT -> point");
  assert.equal(fixture.conflicts.pointGuildResolution, "POINT -> guild_fund");
  assert.equal(fixture.conflicts.packageResidue, "ITEM-RWD-011 -> point");
  assert.equal(fixture.conflicts.pointScaleDigits, 3);
  assert.equal(fixture.conflicts.pointEffectiveUnit, "integer");
  assert.equal(fixture.objectBoundary.existingType, "CURRENCY");
  assert.equal(fixture.objectBoundary.productionObjects, 0);
  assert.equal(fixture.objectBoundary.newTypeRequired, false);
  assert.equal(fixture.objectBoundary.objectChangesInSlice, 0);
  assert.ok(fixture.forbiddenChanges.includes("global POINT alias"));
});

test("records immutable evidence and Gate1 through Gate7 only", () => {
  assert.equal(evidence.sliceId, "SL-ASSET-CURRENCY-DEFINITION-SNAPSHOT-FREEZE-01");
  assert.deepEqual(evidence.gates, {
    gate1: true,
    gate2: true,
    gate3: true,
    gate4: true,
    gate5: true,
    gate6: true,
    gate7: true,
    gate8: false,
  });
});
