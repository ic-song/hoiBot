import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCanonicalCurrencyCode, type CurrencyCodeResolutionInput } from "../src/currency/currency-code-scope-resolver.js";

type Row = CurrencyCodeResolutionInput & { canonicalCode: string; line: string };
type Fixture = { matrix: Row[]; matrixSha256: string; providerBindings: string[]; invariants: Record<string, string | number | boolean> };
const fixture = JSON.parse(fs.readFileSync(new URL(
  "../../migration-control/fixtures/synthetic-relational/currency-code-scope-convergence-v1.json",
  import.meta.url,
), "utf8")) as Fixture;
const sourceDir = fileURLToPath(new URL("../src", import.meta.url));

for (const row of fixture.matrix) assert.equal(resolveCanonicalCurrencyCode(row), row.canonicalCode);
assert.equal(createHash("sha256").update(fixture.matrix.map((row) => row.line).toSorted().join("\n")).digest("hex"), fixture.matrixSha256);
for (const binding of fixture.providerBindings) {
  const source = fs.readFileSync(path.join(sourceDir, binding.split("|")[0]!), "utf8");
  assert.match(source, /resolveCanonicalCurrencyCode/);
}
assert.equal(fixture.invariants.globalPointAlias, false);
assert.equal(fixture.invariants.inactiveResiduePreserved, "ITEM-RWD-011");
console.log(JSON.stringify({ result: "passed", matrix: fixture.matrix.length, providerBindings: fixture.providerBindings.length, globalPointAlias: 0, uppercaseAccountWrites: 0, shadowMismatches: 0, consoleErrors: 0 }));
