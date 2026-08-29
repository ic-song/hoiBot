import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { assertRingDefinitionCatalog, type RingDefinitionRecord } from "../src/catalog/ring-definition-catalog.js";
import { MariaRingDefinitionRepository } from "../src/catalog/maria-ring-definition-repository.js";
const fixturePath = new URL("../../migration-control/fixtures/synthetic-relational/iteminfo-ring-definitions-v1.json", import.meta.url);
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as { rows: RingDefinitionRecord[] };
test("itemInfo ring catalog preserves all 45 source identities", () => {
  assert.deepEqual(assertRingDefinitionCatalog(fixture.rows), { rows: 45, uniqueDisplayNames: 27, repeatedDisplayGroups: 2, repeatedDisplayRows: 20 });
});
test("repeated ring display names stay separate by source key and stats", () => {
  const repeated = fixture.rows.filter((row) => row.itemDisplayName === "숨빌볓 반지💫");
  assert.equal(repeated.length, 10); assert.equal(new Set(repeated.map((row) => row.sourceKey)).size, 10);
  assert.equal(new Set(repeated.map((row) => String(row.battleExp))).size, 10);
});
test("catalog rejects duplicate source identity", () => {
  const duplicate = fixture.rows.map((row) => ({ ...row }));
  const first = duplicate[0]; const second = duplicate[1];
  assert.ok(first !== undefined && second !== undefined);
  duplicate[1] = { ...second, sourceKey: first.sourceKey };
  assert.throws(() => assertRingDefinitionCatalog(duplicate), /duplicate sourceKey/);
});
test("catalog rejects duplicate source order", () => {
  const invalid = fixture.rows.map((row) => ({ ...row }));
  const last = invalid[44]; assert.ok(last !== undefined);
  invalid[44] = { ...last, gradeOrder: 44 };
  assert.throws(() => assertRingDefinitionCatalog(invalid), /duplicate gradeOrder/);
});
test("Maria repository pins active canonical joins and explicit source lookup", async () => {
  const statements: Array<{ sql: string; params?: readonly unknown[] }> = [];
  const database = { query: async <T>(sql: string, params?: readonly unknown[]): Promise<T> => { statements.push({ sql, params }); return [] as T; } };
  const repository = new MariaRingDefinitionRepository(database as never);
  await repository.listActive(); await repository.findBySourceKey("숨별빛10급");
  const list = statements[0]; const find = statements[1];
  assert.ok(list !== undefined && find !== undefined);
  assert.match(list.sql, /registry\.active=TRUE/); assert.match(list.sql, /item\.active=TRUE/);
  assert.match(list.sql, /ORDER BY ring\.grade_order/); assert.match(find.sql, /ring\.source_key=\?/);
  assert.deepEqual(find.params, ["숨별빛10급"]);
});
