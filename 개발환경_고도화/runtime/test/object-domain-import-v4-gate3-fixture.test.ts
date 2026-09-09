import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  loadGate3Documents,
  validateObjectDomainImportV4Gate3,
  type Gate3Documents,
  type Gate3Fixture
} from "../scripts/validate-object-domain-import-v4-gate3.js";

const contracts = new URL("../../migration-control/contracts/", import.meta.url);
const fixtureUrl = new URL("../../migration-control/fixtures/synthetic-relational/data-migration-object-domain-import-v4.json", import.meta.url);
const json = <T>(name: string): T => JSON.parse(readFileSync(new URL(name, contracts), "utf8")) as T;
const clone = <T>(value: T): T => structuredClone(value);

describe("WBS742 Gate 3 independent V4 fixture oracle", () => {
  it("derives 119 tables, 47 targets, 263 columns, 25 definitions, 49 rows, and 272 compared values", () => {
    const d1 = json<{ definitionSeed: string[]; stateImport: string[]; derived: string[]; initialLedger: string[]; quarantineOnly: string[]; runtimeOnly: string[] }>("object-domain-import-disposition.v1.json");
    const d4 = json<{ additions: { derived: string[]; runtimeOnly: string[] } }>("object-domain-import-disposition.v4.json");
    const p2 = json<{ directTargetAdditions: Array<{ table: string; columns: Array<{ table: string; column: string }> }> }>("object-domain-import-profile.v2.json");
    const s1 = json<{ columns: Array<{ table: string; column: string }> }>("object-domain-import-target-schema.v1.json");
    const s4 = json<{ columns: Array<{ table: string; column: string }> }>("object-domain-import-target-schema.v4.json");
    const model = json<{ tables: Array<{ table: string }> }>("object-data-model-standard.v1.json");
    const fixture = JSON.parse(readFileSync(fixtureUrl, "utf8")) as Gate3Fixture;

    const classified = [...d1.definitionSeed, ...d1.stateImport, ...d1.derived, ...d1.initialLedger, ...d1.quarantineOnly, ...d1.runtimeOnly, ...d4.additions.derived, ...d4.additions.runtimeOnly];
    const directTargets = [...d1.definitionSeed, ...d1.stateImport, ...d1.initialLedger, ...d1.quarantineOnly, ...p2.directTargetAdditions.map((target) => target.table)];
    const definitionTargets = [...d1.definitionSeed, ...p2.directTargetAdditions.map((target) => target.table)];
    const columns = [...s1.columns, ...p2.directTargetAdditions.flatMap((target) => target.columns), ...s4.columns];
    const rowTargets = [...directTargets, ...fixture.additionalProjectionRows.map((row) => row.table)];
    const counts = new Map<string, number>();
    for (const column of columns) counts.set(column.table, (counts.get(column.table) ?? 0) + 1);
    const compared = rowTargets.reduce((sum, table) => sum + (counts.get(table) ?? 0), 0);

    assert.deepEqual([classified.length, directTargets.length, columns.length, definitionTargets.length, rowTargets.length, compared], [119, 47, 263, 25, 49, 272]);
    assert.equal(new Set(classified).size, 119);
    assert.deepEqual(classified.slice().sort(), model.tables.map((table) => table.table).sort());
    assert.equal(new Set(directTargets).size, 47);
    assert.equal(new Set(columns.map((column) => `${column.table}.${column.column}`)).size, 263);
    assert.deepEqual(validateObjectDomainImportV4Gate3(loadGate3Documents()), {
      catalogVersion: "SC-20260902-1",
      deltaId: "SCD-WBS742-G3-20260909-1",
      evidenceSchemaVersion: "object-domain-import-gate3-evidence-v1",
      registeredTableCount: 119,
      directTargetCount: 47,
      targetColumnCount: 263,
      definitionTargetCount: 25,
      syntheticProjectionRowCount: 49,
      comparedFieldValueCount: 272
    });
  });

  it("fails closed on table, target, column, row, and version drift", () => {
    const cases: Array<[string, (documents: Gate3Documents) => void, RegExp]> = [
      ["registered table", (documents) => { documents.objectModel.tables.pop(); }, /REGISTERED_TABLE_SET_DRIFT|DISPOSITION_COUNT_INVALID/],
      ["direct target", (documents) => { documents.profileV2.directTargetAdditions[1]!.table = documents.profileV2.directTargetAdditions[0]!.table; }, /DIRECT_TARGET_DUPLICATE/],
      ["V4 column", (documents) => { documents.schemaV4.columns.pop(); }, /V4_COLUMN_SCOPE_INVALID/],
      ["fixture row", (documents) => { documents.fixture.additionalProjectionRows.pop(); }, /ADDITIONAL_ROW_PLAN_INVALID/],
      ["version identity", (documents) => { documents.fixture.deltaId = documents.fixture.catalogVersion; }, /VERSION_IDENTITY_INVALID|VERSION_IDENTITY_COLLISION/]
    ];
    for (const [name, mutate, expected] of cases) {
      const documents = clone(loadGate3Documents());
      mutate(documents);
      assert.throws(() => validateObjectDomainImportV4Gate3(documents), expected, name);
    }
  });
});
