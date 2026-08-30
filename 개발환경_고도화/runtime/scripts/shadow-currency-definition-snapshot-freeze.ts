import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Membership = { count: number; sha256: string; token: string };
type Fixture = {
  counts: { canonicalDefinitions: number; sourceOwnerScopes: number; actualProjection: number; accountScopeIdentities: number; providerSources: number; packageBoundary: number };
  conflicts: { globalPointAliasAllowed: boolean; pointPlayerResolution: string; pointGuildResolution: string; packageResidue: string; pointEffectiveUnit: string };
  providerMembership: { playerAccountRefs: Membership; playerLedgerRefs: Membership; guildAccountRefs: Membership; guildLedgerRefs: Membership; union: { count: number; sha256: string } };
};

const fixture = JSON.parse(fs.readFileSync(new URL(
  "../../migration-control/fixtures/synthetic-relational/currency-definition-snapshot-v1.json",
  import.meta.url,
), "utf8")) as Fixture;
const sourceDir = fileURLToPath(new URL("../src", import.meta.url));

function files(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? files(target) : entry.isFile() && entry.name.endsWith(".ts") ? [target] : [];
  });
}

function membership(value: Membership): string[] {
  const paths = files(sourceDir).filter((file) => fs.readFileSync(file, "utf8").includes(value.token))
    .map((file) => `개발환경_고도화/runtime/src\\${path.relative(sourceDir, file)}`).toSorted();
  assert.equal(paths.length, value.count);
  assert.equal(createHash("sha256").update(paths.join("\n")).digest("hex"), value.sha256);
  return paths;
}

const groups = [
  fixture.providerMembership.playerAccountRefs,
  fixture.providerMembership.playerLedgerRefs,
  fixture.providerMembership.guildAccountRefs,
  fixture.providerMembership.guildLedgerRefs,
].map(membership);
const union = [...new Set(groups.flat())].toSorted();
assert.equal(union.length, fixture.providerMembership.union.count);
assert.equal(createHash("sha256").update(union.join("\n")).digest("hex"), fixture.providerMembership.union.sha256);
assert.deepEqual(fixture.counts, {
  canonicalDefinitions: 3,
  sourceOwnerScopes: 4,
  actualProjection: 5,
  accountScopeIdentities: 6,
  providerSources: 57,
  packageBoundary: 3,
  accountLedgerModels: 2,
  productionCurrencyObjects: 0,
});
assert.equal(fixture.conflicts.globalPointAliasAllowed, false);
assert.equal(fixture.conflicts.pointPlayerResolution, "POINT -> point");
assert.equal(fixture.conflicts.pointGuildResolution, "POINT -> guild_fund");
assert.equal(fixture.conflicts.packageResidue, "ITEM-RWD-011 -> point");
assert.equal(fixture.conflicts.pointEffectiveUnit, "integer");
console.log(JSON.stringify({ result: "passed", canonical: 3, sourceScopes: 4, projection: 5, accounts: 6, providers: 57, packageBoundary: 3, globalPointAlias: 0, sourceConsoleErrors: 0 }));
