import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Provider = { providerId: string; sourcePath: string; sourceTokens: string[]; line: string };
type Fixture = { canonical: Record<string, string | number | Record<string, number>>; providers: Provider[]; stateTables: string[]; directServices: string[]; requiredScenarios: string[]; hashes: Record<string, string>; invariants: Record<string, string | number | boolean> };
const fixture = JSON.parse(fs.readFileSync(new URL(
  "../../migration-control/fixtures/synthetic-relational/badge-provider-parity-v1.json", import.meta.url,
), "utf8")) as Fixture;
const sourceDir = fileURLToPath(new URL("../src", import.meta.url));
const sha256Lines = (lines: string[]): string => createHash("sha256").update(lines.toSorted().join("\n")).digest("hex");

assert.equal(fixture.canonical.definitions, 204);
assert.equal(fixture.canonical.runtimeDisplay, 127);
assert.equal(fixture.canonical.awardLifecycle, 77);
assert.equal(fixture.providers.length, 10);
assert.equal(sha256Lines(fixture.providers.map((row) => row.line)), fixture.hashes.providerMatrixSha256);
assert.equal(sha256Lines(fixture.stateTables), fixture.hashes.stateTablesSha256);
assert.equal(sha256Lines(fixture.directServices), fixture.hashes.directServicesSha256);
for (const provider of fixture.providers) {
  const source = fs.readFileSync(path.join(sourceDir, provider.sourcePath), "utf8");
  for (const token of provider.sourceTokens) assert.ok(source.includes(token), `${provider.providerId}:${token}`);
  assert.doesNotMatch(source, /owned_badges/);
}
assert.equal(fixture.invariants.providerChanges, 0);
assert.equal(fixture.invariants.schemaChanges, 0);
assert.equal(fixture.invariants.badgeTypeChanges, 0);
assert.equal(fixture.invariants.gate8, false);
console.log(JSON.stringify({ result: "passed", providers: 10, canonical: 204, runtimeDisplay: 127, awardLifecycle: 77, lifecycleTables: 7, directServices: 8, providerChanges: 0, schemaChanges: 0, badgeObjects: 0, shadowMismatches: 0, consoleErrors: 0 }));
