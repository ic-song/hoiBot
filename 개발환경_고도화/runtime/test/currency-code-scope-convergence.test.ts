import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { resolveCanonicalCurrencyCode, type CurrencyCodeResolutionInput } from "../src/currency/currency-code-scope-resolver.js";
import { PackageDomainItemMutationStore, type PackageDomainTransaction } from "../src/package/domain-item-provider.js";

type MatrixRow = CurrencyCodeResolutionInput & { canonicalCode: string; line: string };
type Fixture = {
  matrix: MatrixRow[];
  matrixSha256: string;
  providerBindings: string[];
  invariants: Record<string, string | number | boolean>;
};

const fixture = JSON.parse(fs.readFileSync(new URL(
  "../../migration-control/fixtures/synthetic-relational/currency-code-scope-convergence-v1.json",
  import.meta.url,
), "utf8")) as Fixture;
const sourceDir = fileURLToPath(new URL("../src", import.meta.url));

test("resolves the exact context and owner-scope matrix without a global POINT alias", () => {
  for (const row of fixture.matrix) assert.equal(resolveCanonicalCurrencyCode(row), row.canonicalCode, row.line);
  const hash = createHash("sha256").update(fixture.matrix.map((row) => row.line).toSorted().join("\n")).digest("hex");
  assert.equal(hash, fixture.matrixSha256);
  assert.equal(resolveCanonicalCurrencyCode({ providerContext: "PLAYER_REWARD", ownerScope: "PLAYER", sourceCode: "ITEM-RWD-011" }), "ITEM-RWD-011");
  assert.equal(fixture.invariants.globalPointAlias, false);
});

test("binds only the four proven provider gaps to the scoped resolver", () => {
  assert.deepEqual(fixture.providerBindings, [
    "admin/member-voice-auth-reward-service.ts|PLAYER_REWARD|PLAYER",
    "guild/guild-territory-attack-service.ts|GUILD_REWARD|GUILD",
    "guild/guild-territory-war-finish-service.ts|GUILD_REWARD|GUILD",
    "package/domain-item-provider.ts|PACKAGE_POINT|PLAYER",
  ]);
  for (const binding of fixture.providerBindings) {
    const [relative, providerContext, ownerScope] = binding.split("|");
    const source = fs.readFileSync(path.join(sourceDir, relative!), "utf8");
    assert.match(source, /resolveCanonicalCurrencyCode/);
    assert.match(source, new RegExp(`providerContext:\\s*"${providerContext}"`));
    assert.match(source, new RegExp(`ownerScope:\\s*"${ownerScope}"`));
  }
});

test("removes uppercase POINT account and ledger writes while preserving lowercase providers", () => {
  const member = fs.readFileSync(path.join(sourceDir, "admin/member-voice-auth-reward-service.ts"), "utf8");
  const attack = fs.readFileSync(path.join(sourceDir, "guild/guild-territory-attack-service.ts"), "utf8");
  const finish = fs.readFileSync(path.join(sourceDir, "guild/guild-territory-war-finish-service.ts"), "utf8");
  assert.doesNotMatch(member, /currency_code='POINT'/);
  assert.doesNotMatch(attack, /currency_code='POINT'/);
  assert.match(finish, /sourceCode:currencyCode/);
  assert.equal(fixture.invariants.playerAccountLedger, "currency_accounts/currency_ledger");
  assert.equal(fixture.invariants.guildAccountLedger, "guild_resource_accounts/guild_resource_ledger");
});

test("routes the package ITEM-RWD-011 projection to the player point account", async () => {
  const calls: Array<{ kind: "query" | "execute"; sql: string; parameters: readonly unknown[] }> = [];
  const transaction: PackageDomainTransaction = {
    query: async <T>(sql: string, parameters: readonly unknown[] = []) => {
      calls.push({ kind: "query", sql, parameters });
      return [{ balance: "7" }] as T[];
    },
    execute: async (sql, parameters = []) => {
      calls.push({ kind: "execute", sql, parameters });
      return { affectedRows: 1n };
    },
  };
  await new PackageDomainItemMutationStore().add(transaction, {
    id: "ITEM-RWD-011",
    type: "POINT",
    displayName: "포인트",
    metadata: { currencyCode: "ITEM-RWD-011" },
  }, { operationId: "2393", sequenceNo: 1, playerId: "900002393", quantity: 7, reasonCode: "lease2393" });
  const currencyCalls = calls.filter((call) => /currency_accounts|currency_ledger/.test(call.sql));
  assert.equal(currencyCalls.length, 3);
  assert.ok(currencyCalls.every((call) => call.parameters.includes("point")));
  assert.ok(currencyCalls.every((call) => !call.parameters.includes("ITEM-RWD-011")));
});

test("keeps schema, migration, object, main.js and UI outside the slice", () => {
  assert.equal(fixture.invariants.inactiveResiduePreserved, "ITEM-RWD-011");
  for (const key of ["schemaChanges", "migrationChanges", "objectChanges", "mainJsChanges", "uiChanges"]) {
    assert.equal(fixture.invariants[key], 0);
  }
});
