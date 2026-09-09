import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

type Definition = {
  ordinal: number;
  badge_code: string;
  source_code: string;
  grade_code: string | null;
  emoji_value: string;
  display_name: string;
  detail_text: string;
  criteria_json: Record<string, number> | null;
  required_badge_codes_json: string[] | null;
};
type LineRow = { line: string };
type Snapshot = {
  baseline: string;
  sourceContract: string;
  sourceCommit: string;
  counts: Record<string, number>;
  series: Array<{ sourceCode: string; count: number; contentSha256: string }>;
  currentVersion: { id: string; versionKey: string; definitionCount: number; contentHash: string };
  placeholderVersion: { id: string; versionKey: string; definitionCount: number; contentHash: string };
  versionTransition: { exactDisplayTransitions: number; awardLifecyclePreserved: number; physicalVersionRows: number; currentCanonicalRows: number; mergeByDisplayNameAllowed: boolean };
  runtimeDisplayBoundary: { sourceCodes: string[]; count: number; membershipSha256: string; contentSha256: string };
  awardLifecycleBoundary: { sourceCodes: string[]; count: number; membershipSha256: string; contentSha256: string };
  duplicateDisplayGroups: Array<{ displayName: string; badgeCodes: string[]; identityConflict: boolean }>;
  ownershipLifecycleTables: Array<LineRow & { table: string; role: string }>;
  directLifecycleServices: Array<LineRow & { path: string }>;
  objectBoundary: { badgeTypeExists: boolean; badgeObjects: number; badgeAliases: number; badgeSourceBindings: number; providerMutationChanges: number; objectChanges: number };
  hashes: Record<string, string>;
  forbiddenChanges: string[];
};
type Canonical = { sourceContract: string; sourceCommit: string; contentHash: string; counts: Record<string, number>; definitions: Definition[] };

const fixture = JSON.parse(fs.readFileSync(new URL(
  "../../migration-control/fixtures/synthetic-relational/badge-definition-snapshot-v1.json", import.meta.url,
), "utf8")) as Snapshot;
const canonical = JSON.parse(fs.readFileSync(new URL(
  "../../migration-control/evidence/home-badge-inventory/v2400-home-badge-definitions.json", import.meta.url,
), "utf8")) as Canonical;
const evidence = JSON.parse(fs.readFileSync(new URL(
  "../../migration-control/evidence/badge-definition-snapshot-freeze/slice.json", import.meta.url,
), "utf8")) as { sliceId: string; scope: Record<string, number | boolean>; gates: Record<string, boolean> };
const runtimeRoot = fileURLToPath(new URL("..", import.meta.url));
const migrationsDir = path.join(runtimeRoot, "migrations");

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function orderedContent(rows: readonly Definition[]): string {
  return sha256(JSON.stringify(rows.toSorted((left, right) => left.ordinal - right.ordinal)));
}

function membership(rows: readonly Definition[]): string {
  return sha256(rows.map((row) => row.badge_code).toSorted().join("\n"));
}

function lineHash(rows: readonly LineRow[]): string {
  return sha256(rows.map((row) => row.line).toSorted().join("\n"));
}

function identityHash(rows: readonly Definition[]): string {
  return sha256(rows.map((row) => [
    row.badge_code, row.source_code, fixture.currentVersion.id, row.grade_code,
    row.emoji_value, row.display_name, row.detail_text, JSON.stringify(row.criteria_json),
    JSON.stringify(row.required_badge_codes_json),
  ].join("|")).toSorted().join("\n"));
}

test("freezes the exact v930000002 canonical204 definitions and five series", () => {
  assert.equal(fixture.baseline, "328c056447d48d0c558aa164d544a8f1ca45f933");
  assert.equal(canonical.sourceContract, fixture.sourceContract);
  assert.equal(canonical.sourceCommit, fixture.sourceCommit);
  assert.equal(canonical.definitions.length, 204);
  assert.equal(sha256(JSON.stringify(canonical.definitions)), fixture.hashes.canonicalContentSha256);
  assert.equal(canonical.contentHash, fixture.currentVersion.contentHash);
  assert.equal(membership(canonical.definitions), fixture.hashes.canonicalMembershipSha256);
  assert.equal(identityHash(canonical.definitions), fixture.hashes.identitySha256);
  for (const series of fixture.series) {
    const rows = canonical.definitions.filter((row) => row.source_code === series.sourceCode);
    assert.equal(rows.length, series.count);
    assert.equal(orderedContent(rows), series.contentSha256);
  }
  assert.deepEqual(fixture.series.map(({ sourceCode, count }) => [sourceCode, count]), [
    ["achievement", 64], ["special", 13], ["gacha", 57], ["mbti", 20], ["love", 50],
  ]);
});

test("freezes runtime display127 and award lifecycle77 as disjoint complete boundaries", () => {
  const runtimeDisplay = canonical.definitions.filter((row) => fixture.runtimeDisplayBoundary.sourceCodes.includes(row.source_code));
  const awardLifecycle = canonical.definitions.filter((row) => fixture.awardLifecycleBoundary.sourceCodes.includes(row.source_code));
  assert.equal(runtimeDisplay.length, 127);
  assert.equal(awardLifecycle.length, 77);
  assert.equal(runtimeDisplay.length + awardLifecycle.length, 204);
  assert.equal(membership(runtimeDisplay), fixture.runtimeDisplayBoundary.membershipSha256);
  assert.equal(orderedContent(runtimeDisplay), fixture.runtimeDisplayBoundary.contentSha256);
  assert.equal(membership(awardLifecycle), fixture.awardLifecycleBoundary.membershipSha256);
  assert.equal(orderedContent(awardLifecycle), fixture.awardLifecycleBoundary.contentSha256);
});

test("preserves two duplicate display groups without an identity merge", () => {
  const groups = new Map<string, string[]>();
  for (const definition of canonical.definitions) {
    const codes = groups.get(definition.display_name) ?? [];
    codes.push(definition.badge_code);
    groups.set(definition.display_name, codes);
  }
  const duplicates = [...groups.entries()].filter(([, codes]) => codes.length > 1)
    .map(([displayName, badgeCodes]) => ({ displayName, badgeCodes, identityConflict: false }));
  assert.deepEqual(duplicates, fixture.duplicateDisplayGroups);
  assert.equal(duplicates.length, 2);
  assert.equal(new Set(canonical.definitions.map((row) => `${row.badge_code}|${row.source_code}|${fixture.currentVersion.id}`)).size, 204);
  assert.equal(fixture.versionTransition.mergeByDisplayNameAllowed, false);
});

test("freezes placeholder to exact transition, legacy projection77 and physical version rows408", () => {
  const migration107 = fs.readFileSync(path.join(migrationsDir, "107_admin_special_badge_revoke.sql"), "utf8");
  const migration218 = fs.readFileSync(path.join(migrationsDir, "218_home_social_badge_migration.sql"), "utf8");
  const migration322 = fs.readFileSync(path.join(migrationsDir, "322_home_badge_inventory_queries.sql"), "utf8");
  const migration374 = fs.readFileSync(path.join(migrationsDir, "374_home_badge_definition_v2400.sql"), "utf8");
  const specialCodes = [...migration107.matchAll(/\('([A-Z][A-Z0-9]+)','special'/g)].map((match) => match[1]!);
  const activityCodes = [...migration218.matchAll(/\('([A-Z][A-Z0-9]+)','activity'/g)].map((match) => match[1]!);
  assert.equal(specialCodes.length, 13);
  assert.equal(activityCodes.length, 64);
  assert.equal(sha256([...specialCodes, ...activityCodes].toSorted().join("\n")), fixture.hashes.awardLifecycleMembershipSha256);
  assert.match(migration322, /930000001,'legacy-structure-v1-pending-name-parity',SHA2\('achievement64\|special13\|gacha57\|mbti20\|love50',256\)/);
  assert.equal(sha256("achievement64|special13|gacha57|mbti20|love50"), fixture.placeholderVersion.contentHash);
  assert.match(migration374, /930000002,'legacy-v2\.400-exact-display-v1','70d6731d0c5e2f72832fe70042ab1e0a7ba16d38af106b71617a31c33ed7932b'/);
  assert.equal([...migration374.matchAll(/\(930000002,\d+,'[^']+'/g)].length, 204);
  assert.deepEqual(fixture.versionTransition, {
    fromVersionId: "930000001",
    toVersionId: "930000002",
    exactDisplayTransitions: 127,
    awardLifecyclePreserved: 77,
    physicalVersionRows: 408,
    currentCanonicalRows: 204,
    mergeByDisplayNameAllowed: false,
  });
});

test("freezes five ownership lifecycle tables and eight direct services", () => {
  const tableSources = [
    ["005_player_profile.sql", "player_badge_assignments"],
    ["107_admin_special_badge_revoke.sql", "player_badge_equipment"],
    ["031_pet_info_projection.sql", "player_home_badge_cubes"],
    ["218_home_social_badge_migration.sql", "player_home_badge_exclusions"],
    ["196_hope_premium_delete.sql", "player_home_badges"],
  ] as const;
  for (const [migration, table] of tableSources) {
    assert.match(fs.readFileSync(path.join(migrationsDir, migration), "utf8"), new RegExp(`CREATE TABLE(?: IF NOT EXISTS)? ${table}`));
  }
  assert.equal(fixture.ownershipLifecycleTables.length, 5);
  assert.equal(lineHash(fixture.ownershipLifecycleTables), fixture.hashes.ownershipLifecycleTablesSha256);
  assert.equal(fixture.directLifecycleServices.length, 8);
  assert.equal(lineHash(fixture.directLifecycleServices), fixture.hashes.directLifecycleServicesSha256);
  for (const service of fixture.directLifecycleServices) {
    assert.equal(fs.existsSync(path.join(runtimeRoot, service.path.replace(/^runtime\//, ""))), true);
  }
});

test("keeps BADGE type, objects and provider mutations outside the slice", () => {
  const objectMigration = fs.readFileSync(path.join(migrationsDir, "384_object_catalog_core.sql"), "utf8");
  assert.doesNotMatch(objectMigration, /'BADGE'/);
  assert.deepEqual(fixture.objectBoundary, {
    badgeTypeExists: false,
    badgeObjects: 0,
    badgeAliases: 0,
    badgeSourceBindings: 0,
    providerMutationChanges: 0,
    objectChanges: 0,
  });
  assert.equal(sha256(""), fixture.hashes.emptyObjectMembershipSha256);
  assert.ok(fixture.forbiddenChanges.includes("BADGE type"));
  assert.ok(fixture.forbiddenChanges.includes("provider mutation"));
});

test("records immutable evidence and Gate1 through Gate7 only", () => {
  assert.equal(evidence.sliceId, "SL-ASSET-BADGE-DEFINITION-SNAPSHOT-FREEZE-01");
  assert.equal(evidence.scope.schemaChanges, 0);
  assert.equal(evidence.scope.providerChanges, 0);
  assert.equal(evidence.scope.operationalDbTouched, false);
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
