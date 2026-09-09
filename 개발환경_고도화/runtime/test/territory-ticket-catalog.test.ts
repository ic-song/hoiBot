import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { MariaTerritoryTicketRepository } from "../src/catalog/maria-territory-ticket-repository.js";
import { assertTerritoryTicketCatalog, type TerritoryTicketRecord } from "../src/catalog/territory-ticket-catalog.js";

const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/iteminfo-territory-tickets-v1.json", import.meta.url), "utf8")) as { rows: TerritoryTicketRecord[] };

test("territory ticket catalog preserves offense three and defense three", () => {
  assert.deepEqual(assertTerritoryTicketCatalog(fixture.rows), { rows: 6, offense: 3, defense: 3, reusedCanonical: 1 });
});

test("display percentage and source successRate remain independent", () => {
  assert.deepEqual(fixture.rows.slice(0, 1).map((row) => [row.displayRatePercent, Number(row.successRate)]), [[90, 1]]);
  assert.deepEqual(fixture.rows.slice(3, 4).map((row) => [row.displayRatePercent, Number(row.successRate)]), [[80, 1]]);
});

test("existing exact defense ticket keeps ITEM-TERRITORY-DEFENSE-50", () => {
  const reused = fixture.rows.filter((row) => row.reusedCanonical === true);
  assert.equal(reused.length, 1);
  assert.equal(reused[0]?.itemCode, "ITEM-TERRITORY-DEFENSE-50");
});

test("catalog rejects a duplicate scope source identity", () => {
  const rows = fixture.rows.map((row) => ({ ...row }));
  const first = rows[0];
  const second = rows[5];
  assert.ok(first !== undefined && second !== undefined);
  rows[5] = { ...second, scope: first.scope, sourceKey: first.sourceKey };
  assert.throws(() => assertTerritoryTicketCatalog(rows), /duplicate sourceIdentity/);
});

test("Maria repository uses active canonical joins and explicit scope source", async () => {
  const statements: Array<{ sql: string; params?: readonly unknown[] }> = [];
  const db = { query: async <T>(sql: string, params?: readonly unknown[]): Promise<T> => { statements.push({ sql, params }); return [] as T; } };
  const repository = new MariaTerritoryTicketRepository(db as never);
  await repository.listActive();
  await repository.findBySource("defense", "item_1");
  const list = statements[0];
  const find = statements[1];
  assert.ok(list !== undefined && find !== undefined);
  assert.match(list.sql, /registry\.active=TRUE/);
  assert.match(list.sql, /ORDER BY ticket\.display_order/);
  assert.match(find.sql, /ticket\.scope_code=\?/);
  assert.deepEqual(find.params, ["defense", "item_1"]);
});
