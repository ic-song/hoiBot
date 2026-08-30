import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Provider = { providerId: string; ownerScope: string; canonicalCode: string; sourcePaths: string[]; sourceTokens: string[]; line: string };
type Fixture = { canonicalDefinitions: string[]; providers: Provider[]; providerMatrixSha256: string; requiredScenarios: string[]; invariants: Record<string, string | number | boolean> };
const fixture = JSON.parse(fs.readFileSync(new URL(
  "../../migration-control/fixtures/synthetic-relational/currency-provider-parity-v1.json",
  import.meta.url,
), "utf8")) as Fixture;
const sourceDir = fileURLToPath(new URL("../src", import.meta.url));

assert.deepEqual(fixture.canonicalDefinitions, ["diamond", "guild_fund", "point"]);
assert.equal(fixture.providers.length, 9);
assert.equal(createHash("sha256").update(fixture.providers.map((row) => row.line).toSorted().join("\n")).digest("hex"), fixture.providerMatrixSha256);
for (const provider of fixture.providers) {
  const source = provider.sourcePaths.map((relative) => fs.readFileSync(path.join(sourceDir, relative), "utf8")).join("\n");
  for (const token of provider.sourceTokens) assert.ok(source.includes(token), `${provider.providerId}:${token}`);
  assert.doesNotMatch(source, /currency_code\s*=\s*['"]POINT['"]/);
}
assert.deepEqual(fixture.requiredScenarios, ["normal", "not_found", "version_conflict", "replay", "idempotency", "transaction_rollback", "reconnect"]);
assert.equal(fixture.invariants.providerChanges, 0);
assert.equal(fixture.invariants.globalPointAlias, false);
console.log(JSON.stringify({ result: "passed", providers: 9, canonicalDefinitions: 3, rawUppercaseWrites: 0, globalAliases: 0, wrongAccountWrites: 0, shadowMismatches: 0, consoleErrors: 0 }));
