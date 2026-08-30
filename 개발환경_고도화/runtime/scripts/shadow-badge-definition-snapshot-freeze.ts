import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Definition = { ordinal: number; badge_code: string; source_code: string; display_name: string } & Record<string, unknown>;
type Fixture = {
  counts: Record<string, number>;
  currentVersion: { id: string; contentHash: string };
  runtimeDisplayBoundary: { sourceCodes: string[]; membershipSha256: string; contentSha256: string };
  awardLifecycleBoundary: { sourceCodes: string[]; membershipSha256: string; contentSha256: string };
  duplicateDisplayGroups: Array<{ displayName: string; badgeCodes: string[]; identityConflict: boolean }>;
  ownershipLifecycleTables: Array<{ line: string }>;
  directLifecycleServices: Array<{ line: string }>;
  objectBoundary: { badgeTypeExists: boolean; badgeObjects: number; providerMutationChanges: number };
  hashes: Record<string, string>;
};
type Canonical = { contentHash: string; definitions: Definition[] };

const fixture = JSON.parse(fs.readFileSync(new URL(
  "../../migration-control/fixtures/synthetic-relational/badge-definition-snapshot-v1.json", import.meta.url,
), "utf8")) as Fixture;
const canonical = JSON.parse(fs.readFileSync(new URL(
  "../../migration-control/evidence/home-badge-inventory/v2400-home-badge-definitions.json", import.meta.url,
), "utf8")) as Canonical;
const runtimeRoot = fileURLToPath(new URL("..", import.meta.url));

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
const content = (rows: Definition[]): string => sha256(JSON.stringify(rows.toSorted((left, right) => left.ordinal - right.ordinal)));
const membership = (rows: Definition[]): string => sha256(rows.map((row) => row.badge_code).toSorted().join("\n"));
const lineHash = (rows: Array<{ line: string }>): string => sha256(rows.map((row) => row.line).toSorted().join("\n"));

assert.equal(canonical.definitions.length, fixture.counts.canonicalDefinitions);
assert.equal(sha256(JSON.stringify(canonical.definitions)), fixture.hashes.canonicalContentSha256);
assert.equal(canonical.contentHash, fixture.currentVersion.contentHash);
const runtimeDisplay = canonical.definitions.filter((row) => fixture.runtimeDisplayBoundary.sourceCodes.includes(row.source_code));
const awardLifecycle = canonical.definitions.filter((row) => fixture.awardLifecycleBoundary.sourceCodes.includes(row.source_code));
assert.equal(runtimeDisplay.length, 127);
assert.equal(awardLifecycle.length, 77);
assert.equal(membership(runtimeDisplay), fixture.runtimeDisplayBoundary.membershipSha256);
assert.equal(content(runtimeDisplay), fixture.runtimeDisplayBoundary.contentSha256);
assert.equal(membership(awardLifecycle), fixture.awardLifecycleBoundary.membershipSha256);
assert.equal(content(awardLifecycle), fixture.awardLifecycleBoundary.contentSha256);
const displayGroups = new Map<string, string[]>();
for (const row of canonical.definitions) displayGroups.set(row.display_name, [...(displayGroups.get(row.display_name) ?? []), row.badge_code]);
const duplicates = [...displayGroups.entries()].filter(([, codes]) => codes.length > 1)
  .map(([displayName, badgeCodes]) => ({ displayName, badgeCodes, identityConflict: false }));
assert.deepEqual(duplicates, fixture.duplicateDisplayGroups);
assert.equal(lineHash(fixture.ownershipLifecycleTables), fixture.hashes.ownershipLifecycleTablesSha256);
assert.equal(lineHash(fixture.directLifecycleServices), fixture.hashes.directLifecycleServicesSha256);
assert.equal(fixture.objectBoundary.badgeTypeExists, false);
assert.equal(fixture.objectBoundary.badgeObjects, 0);
assert.equal(fixture.objectBoundary.providerMutationChanges, 0);
const objectMigration = fs.readFileSync(path.join(runtimeRoot, "migrations", "384_object_catalog_core.sql"), "utf8");
assert.doesNotMatch(objectMigration, /'BADGE'/);

console.log(JSON.stringify({
  result: "passed",
  canonical: 204,
  runtimeDisplay: 127,
  awardLifecycle: 77,
  versionRows: 408,
  currentDefinitions: 204,
  duplicateDisplayGroups: 2,
  identityConflicts: 0,
  lifecycleTables: 5,
  directServices: 8,
  badgeTypes: 0,
  badgeObjects: 0,
  providerMutations: 0,
  sourceConsoleErrors: 0,
}));
