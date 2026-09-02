import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { validateObjectDataModelContract, type ObjectDataModelContract } from "../src/catalog/object-data-model-contract.js";

const contract = JSON.parse(readFileSync(new URL("../../migration-control/contracts/object-data-model-standard.v1.json", import.meta.url), "utf8")) as ObjectDataModelContract;
const fixture = JSON.parse(readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/object-data-model-standard-v1.json", import.meta.url), "utf8")) as ObjectDataModelContract;

describe("object data model standard contract", () => {
  it("accepts the registered new-object scope without retroactively judging legacy migrations", () => {
    assert.doesNotThrow(() => validateObjectDataModelContract(contract));
    assert.equal(contract.scope, "new_object_schema_only");
    assert.deepEqual(contract.registeredMigrations, []);
  });

  it("rejects bare ids, object codes, copied definition values, and incompatible foreign keys", () => {
    const compliant = fixture;
    assert.doesNotThrow(() => validateObjectDataModelContract(compliant));
    assert.throws(() => validateObjectDataModelContract({ ...compliant, tables: [{ ...compliant.tables[0]!, columns: [...compliant.tables[0]!.columns, { name: "id", type: "CHAR(8)" }] }]}), /BARE_ID/);
    assert.throws(() => validateObjectDataModelContract({ ...compliant, tables: [{ ...compliant.tables[0]!, columns: [...compliant.tables[0]!.columns, { name: "item_code", type: "VARCHAR(20)" }] }]}), /OBJECT_CODE/);
    assert.throws(() => validateObjectDataModelContract({ ...compliant, tables: [{ ...compliant.tables[1]!, columns: [...compliant.tables[1]!.columns, { name: "base_charm", type: "BIGINT" }] }]}), /DEFINITION_VALUE_COPIED/);
    assert.throws(() => validateObjectDataModelContract({ ...compliant, tables: [compliant.tables[0]!, { ...compliant.tables[1]!, foreignKeys: [{ column: "item_id", referencesTable: "item_definitions", referencesColumn: "wrong_item_id" }] }]}), /FK_NAME/);
  });
});
