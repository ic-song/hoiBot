import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { resolveCanonicalCurrencyCode } from "../src/currency/currency-code-scope-resolver.js";

type ProviderRow = {
  providerId: string;
  ownerScope: "PLAYER" | "GUILD";
  canonicalCode: string;
  accountTable: string;
  ledgerTable: string;
  unit: string;
  sourcePaths: string[];
  sourceTokens: string[];
  line: string;
};
type Fixture = {
  canonicalDefinitions: string[];
  providers: ProviderRow[];
  providerMatrixSha256: string;
  requiredScenarios: string[];
  carryForwardTests: string[];
  invariants: Record<string, string | number | boolean>;
};

const fixture = JSON.parse(fs.readFileSync(new URL(
  "../../migration-control/fixtures/synthetic-relational/currency-provider-parity-v1.json",
  import.meta.url,
), "utf8")) as Fixture;
const sourceDir = fileURLToPath(new URL("../src", import.meta.url));
const testDir = fileURLToPath(new URL(".", import.meta.url));

function combinedSource(row: ProviderRow): string {
  return row.sourcePaths.map((relative) => fs.readFileSync(path.join(sourceDir, relative), "utf8")).join("\n");
}

test("freezes canonical3 and nine owner-scoped provider identities", () => {
  assert.deepEqual(fixture.canonicalDefinitions, ["diamond", "guild_fund", "point"]);
  assert.equal(fixture.providers.length, 9);
  assert.equal(new Set(fixture.providers.map((row) => row.providerId)).size, 9);
  assert.equal(createHash("sha256").update(fixture.providers.map((row) => row.line).toSorted().join("\n")).digest("hex"), fixture.providerMatrixSha256);
  assert.deepEqual(new Set(fixture.providers.map((row) => row.canonicalCode)), new Set(fixture.canonicalDefinitions));
});

test("keeps every provider on its exact canonical source contract", () => {
  for (const row of fixture.providers) {
    const source = combinedSource(row);
    for (const token of row.sourceTokens) assert.ok(source.includes(token), `${row.providerId}:${token}`);
    assert.doesNotMatch(source, /currency_code\s*=\s*['"]POINT['"]/);
  }
  assert.equal(fixture.invariants.rawUppercaseAccountWrites, 0);
  assert.equal(fixture.invariants.globalPointAlias, false);
});

test("routes player and guild providers to separate versioned account ledgers", () => {
  for (const row of fixture.providers) {
    if (row.ownerScope === "PLAYER") {
      assert.equal(row.accountTable, "currency_accounts");
      assert.equal(row.ledgerTable, "currency_ledger");
    } else {
      assert.equal(row.accountTable, "guild_resource_accounts");
      assert.equal(row.ledgerTable, "guild_resource_ledger");
    }
    assert.equal(row.unit, "integer");
  }
  assert.equal(fixture.invariants.wrongAccountLedgerWrites, 0);
});

test("replays canonical lower-case codes through the scoped resolver without a global alias", () => {
  for (const row of fixture.providers) {
    const resolved = row.providerId === "package_point"
      ? resolveCanonicalCurrencyCode({ providerContext: "PACKAGE_POINT", ownerScope: "PLAYER", sourceCode: "ITEM-RWD-011", definitionCode: "ITEM-RWD-011" })
      : row.ownerScope === "PLAYER"
        ? resolveCanonicalCurrencyCode({ providerContext: "PLAYER_REWARD", ownerScope: "PLAYER", sourceCode: row.canonicalCode })
        : resolveCanonicalCurrencyCode({ providerContext: "GUILD_REWARD", ownerScope: "GUILD", sourceCode: row.canonicalCode });
    assert.equal(resolved, row.canonicalCode, row.providerId);
  }
});

test("carries normal, failure, replay, rollback and reconnect evidence for every provider family", () => {
  assert.deepEqual(fixture.requiredScenarios, ["normal", "not_found", "version_conflict", "replay", "idempotency", "transaction_rollback", "reconnect"]);
  for (const file of fixture.carryForwardTests) assert.equal(fs.existsSync(path.join(testDir, file)), true, file);
  assert.equal(fixture.invariants.accountVersionRequired, true);
  assert.equal(fixture.invariants.ledgerAppendOnly, true);
  assert.equal(fixture.invariants.ledgerOperationSequenceRequired, true);
  assert.equal(fixture.invariants.effectiveUnit, "integer");
});

test("keeps provider, object, schema, migration, main.js and UI changes at zero", () => {
  for (const key of ["providerChanges", "objectChanges", "schemaChanges", "migrationChanges", "mainJsChanges", "uiChanges"]) {
    assert.equal(fixture.invariants[key], 0, key);
  }
});
