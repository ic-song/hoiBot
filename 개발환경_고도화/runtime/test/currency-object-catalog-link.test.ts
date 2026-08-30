import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { CurrencyObjectCatalogReadModel } from "../src/catalog/currency-object-catalog-read-model.js";

const migration = fs.readFileSync(new URL("../migrations/408_currency_object_catalog_link.sql", import.meta.url), "utf8");
const rollback = fs.readFileSync(new URL("../../migration-control/rollback/408_currency_object_catalog_link.sql", import.meta.url), "utf8");
const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/currency-object-catalog-link-v1.json", import.meta.url), "utf8"));
const evidence = JSON.parse(fs.readFileSync(new URL("../../migration-control/evidence/currency-object-catalog-link/slice.json", import.meta.url), "utf8"));

test("freezes exactly three lowercase canonical currency definitions", () => {
  assert.equal(fixture.definitions, 3);
  assert.deepEqual(fixture.rows.map((row: { code: string }) => row.code), ["point", "diamond", "guild_fund"]);
  assert.equal(new Set(fixture.rows.map((row: { objectKey: string }) => row.objectKey)).size, 3);
  assert.deepEqual(fixture.rows.map((row: { scaleDigits: number }) => row.scaleDigits), [3, 0, 0]);
  assert.match(migration, new RegExp(fixture.sourceHash));
  assert.deepEqual(fixture.excludedDefinitionCodes, ["POINT"]);
  assert.doesNotMatch(migration, /\('POINT'/);
});

test("uses CURRENCY plus owner scope code and definition version identity", () => {
  assert.deepEqual(fixture.rows.map((row: { ownerScope: string }) => row.ownerScope), ["PLAYER", "PLAYER", "GUILD"]);
  assert.ok(fixture.rows.every((row: { objectKey: string }) => row.objectKey.endsWith(".v1")));
  assert.match(migration, /'definitionVersion', identity_row\.definition_version/);
  assert.match(migration, /'ownerScope', identity_row\.owner_scope/);
  assert.doesNotMatch(migration, /GROUP BY\s+definition_row\.display_name/i);
});

test("creates three objects and exact definition source bindings without aliases", () => {
  assert.equal(fixture.objects, 3);
  assert.equal(fixture.sourceBindings, 3);
  assert.equal(fixture.aliases, 0);
  assert.match(migration, /'CURRENCY',\s*'RUNTIME_DB',\s*'currency_definitions'/);
  assert.doesNotMatch(migration, /object_aliases|alias_value/i);
  assert.equal((migration.match(/ON DUPLICATE KEY UPDATE/g) ?? []).length, 2);
});

test("read model resolves the complete identity and never display name", () => {
  const model = new CurrencyObjectCatalogReadModel(fixture.rows.map((row: Record<string, unknown>) => ({
    code: row.code,
    displayName: row.display,
    scaleDigits: row.scaleDigits,
    ownerScope: row.ownerScope,
    definitionVersion: 1,
    objectKey: row.objectKey,
  })));
  assert.equal(model.find("point", "PLAYER", 1)?.objectKey, "currency.player.point.v1");
  assert.equal(model.find("guild_fund", "GUILD", 1)?.objectKey, "currency.guild.guild_fund.v1");
  assert.equal(model.find("POINT", "PLAYER", 1), null);
});

test("is reversible and excludes ownership ledger provider runtime and UI", () => {
  assert.match(rollback, /^START TRANSACTION;/);
  assert.match(rollback, /ASSET-FREEZE-v2\.400-currency-object-link-01/);
  assert.doesNotMatch(rollback, /DELETE\s+FROM\s+currency_definitions/i);
  assert.doesNotMatch(migration, /currency_accounts|guild_resource_accounts|ledger|provider|main\.js|web-shell|admin/i);
  assert.equal(fixture.ownershipRowsMutated, 0);
  assert.equal(evidence.scope.gate8, false);
});
