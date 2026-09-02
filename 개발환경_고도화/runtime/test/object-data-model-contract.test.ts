import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { validateObjectDataModelContract, type ObjectDataModelContract } from "../src/catalog/object-data-model-contract.js";

const contract = JSON.parse(readFileSync(new URL("../../migration-control/contracts/object-data-model-standard.v1.json", import.meta.url), "utf8")) as ObjectDataModelContract;

describe("object data model standard contract", () => {
  it("accepts the registered new-object scope without retroactively judging legacy migrations", () => {
    assert.doesNotThrow(() => validateObjectDataModelContract(contract));
    assert.equal(contract.scope, "new_object_schema_only");
    assert.deepEqual(contract.registeredMigrations, []);
  });

  it("rejects bare ids, object codes, copied definition values, and incompatible foreign keys", () => {
    const compliant: ObjectDataModelContract = {
      ...contract,
      tables: [
        { table: "item_definitions", role: "definition", columns: [
          { name: "item_id", type: "CHAR(8)", charset: "ascii", collation: "ascii_bin" }, { name: "item_name", type: "VARCHAR(255)" },
          { name: "INSERT_USER", type: "VARCHAR(100)" }, { name: "INSERT_TIME", type: "CHAR(19)" }, { name: "UPDATE_USER", type: "VARCHAR(100)" }, { name: "UPDATE_TIME", type: "CHAR(19)" }
        ], primaryKey: ["item_id"], foreignKeys: [] },
        { table: "owned_items", role: "ownership_quantity", columns: [
          { name: "player_id", type: "CHAR(8)", charset: "ascii", collation: "ascii_bin" }, { name: "item_id", type: "CHAR(8)", charset: "ascii", collation: "ascii_bin" }, { name: "quantity", type: "BIGINT UNSIGNED" },
          { name: "INSERT_USER", type: "VARCHAR(100)" }, { name: "INSERT_TIME", type: "CHAR(19)" }, { name: "UPDATE_USER", type: "VARCHAR(100)" }, { name: "UPDATE_TIME", type: "CHAR(19)" }
        ], primaryKey: ["player_id", "item_id"], uniqueKeys: [["player_id", "item_id"]], foreignKeys: [{ column: "item_id", referencesTable: "item_definitions", referencesColumn: "item_id" }] }
      ]
    };
    assert.doesNotThrow(() => validateObjectDataModelContract(compliant));
    assert.throws(() => validateObjectDataModelContract({ ...compliant, tables: [{ ...compliant.tables[0]!, columns: [...compliant.tables[0]!.columns, { name: "id", type: "CHAR(8)" }] }]}), /BARE_ID/);
    assert.throws(() => validateObjectDataModelContract({ ...compliant, tables: [{ ...compliant.tables[0]!, columns: [...compliant.tables[0]!.columns, { name: "item_code", type: "VARCHAR(20)" }] }]}), /OBJECT_CODE/);
    assert.throws(() => validateObjectDataModelContract({ ...compliant, tables: [{ ...compliant.tables[1]!, columns: [...compliant.tables[1]!.columns, { name: "base_charm", type: "BIGINT" }] }]}), /DEFINITION_VALUE_COPIED/);
    assert.throws(() => validateObjectDataModelContract({ ...compliant, tables: [compliant.tables[0]!, { ...compliant.tables[1]!, foreignKeys: [{ column: "item_id", referencesTable: "item_definitions", referencesColumn: "wrong_item_id" }] }]}), /FK_NAME/);
  });
});
