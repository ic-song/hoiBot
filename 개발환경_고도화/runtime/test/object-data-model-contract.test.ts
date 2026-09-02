import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { validateObjectDataModelContract, type ObjectDataModelContract } from "../src/catalog/object-data-model-contract.js";

const contract = JSON.parse(readFileSync(new URL("../../migration-control/contracts/object-data-model-standard.v1.json", import.meta.url), "utf8")) as ObjectDataModelContract;
const fixture = JSON.parse(readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/object-data-model-standard-v1.json", import.meta.url), "utf8")) as ObjectDataModelContract;
const copy = (): ObjectDataModelContract => JSON.parse(JSON.stringify(fixture)) as ObjectDataModelContract;

describe("object data model standard contract", () => {
  it("accepts the registered WBS731 identity/audit schema contract", () => {
    assert.doesNotThrow(() => validateObjectDataModelContract(contract));
    assert.equal(contract.scope, "new_object_schema_only");
    assert.deepEqual(contract.registeredMigrations, ["443_object_identity_audit_provider.sql"]);
    assert.deepEqual(contract.tables.map((table) => table.table), ["object_identities", "object_identity_crosswalks"]);
  });

  it("accepts the anonymized identity, definition, and ownership fixture", () => {
    assert.doesNotThrow(() => validateObjectDataModelContract(fixture));
  });

  it("rejects audit user type, primary-key, and duplicate-column bypasses", () => {
    const wrongAudit = copy();
    wrongAudit.tables[0]!.columns = wrongAudit.tables[0]!.columns.map((entry) => entry.name === "INSERT_USER" ? { ...entry, type: "VARCHAR(30)" } : entry);
    assert.throws(() => validateObjectDataModelContract(wrongAudit), /AUDIT_USER_TYPE/);
    const emptyPrimaryKey = copy();
    emptyPrimaryKey.tables[0]!.primaryKey = [];
    assert.throws(() => validateObjectDataModelContract(emptyPrimaryKey), /PRIMARY_KEY_EMPTY/);
    const duplicateColumn = copy();
    duplicateColumn.tables[0]!.columns = [...duplicateColumn.tables[0]!.columns, duplicateColumn.tables[0]!.columns[0]!];
    assert.throws(() => validateObjectDataModelContract(duplicateColumn), /COLUMN_DUPLICATE/);
  });

  it("rejects bare and uppercase CODE columns plus executable payloads", () => {
    const bareId = copy();
    bareId.tables[1]!.columns = [...bareId.tables[1]!.columns, { name: "ID", type: "CHAR(8)" }];
    assert.throws(() => validateObjectDataModelContract(bareId), /BARE_ID/);
    const uppercaseCode = copy();
    uppercaseCode.tables[1]!.columns = [...uppercaseCode.tables[1]!.columns, { name: "ITEM_CODE", type: "VARCHAR(20)" }];
    assert.throws(() => validateObjectDataModelContract(uppercaseCode), /OBJECT_CODE/);
    for (const name of ["script_body", "sql_payload", "handler_script", "javascript_source"]) {
      const executable = copy();
      executable.tables[1]!.columns = [...executable.tables[1]!.columns, { name, type: "TEXT" }];
      assert.throws(() => validateObjectDataModelContract(executable), /EXECUTABLE_PAYLOAD/, name);
    }
  });

  it("requires FK targets to be their declared PK and enforces ownership boundaries", () => {
    const nonPrimaryTarget = copy();
    nonPrimaryTarget.tables[1]!.primaryKey = ["other_item_id"];
    nonPrimaryTarget.tables[1]!.columns = [...nonPrimaryTarget.tables[1]!.columns, { name: "other_item_id", type: "CHAR(8)", charset: "ascii", collation: "ascii_bin" }];
    assert.throws(() => validateObjectDataModelContract(nonPrimaryTarget), /FK_NOT_PRIMARY/);
    const copiedDefinition = copy();
    copiedDefinition.tables[2]!.columns = [...copiedDefinition.tables[2]!.columns, { name: "base_charm", type: "BIGINT" }];
    assert.throws(() => validateObjectDataModelContract(copiedDefinition), /OWNERSHIP_COLUMN/);
    const noPlayerFk = copy();
    noPlayerFk.tables[2]!.foreignKeys = noPlayerFk.tables[2]!.foreignKeys.filter((key) => key.column !== "player_id");
    assert.throws(() => validateObjectDataModelContract(noPlayerFk), /OWNERSHIP_PLAYER_FK/);
    const noDefinitionFk = copy();
    noDefinitionFk.tables[2]!.foreignKeys = noDefinitionFk.tables[2]!.foreignKeys.filter((key) => key.column !== "item_id");
    assert.throws(() => validateObjectDataModelContract(noDefinitionFk), /OWNERSHIP_DEFINITION_FK/);
  });

  it("requires migrations and registered tables to be paired", () => {
    const migrationOnly = copy();
    migrationOnly.tables = [];
    assert.throws(() => validateObjectDataModelContract(migrationOnly), /REGISTRATION_PAIR/);
    const tableOnly = copy();
    tableOnly.registeredMigrations = [];
    assert.throws(() => validateObjectDataModelContract(tableOnly), /REGISTRATION_PAIR/);
  });

  it("allows pet-skill handler keys and options while retaining executable-payload denial", () => {
    const petSkill = copy();
    petSkill.tables = [...petSkill.tables, {
      table: "pet_skill_definitions", role: "definition",
      columns: [
        { name: "pet_skill_id", type: "CHAR(8)", charset: "ascii", collation: "ascii_bin" },
        { name: "handler_key", type: "VARCHAR(100)" }, { name: "options_json", type: "JSON" },
        { name: "INSERT_USER", type: "VARCHAR(100)" }, { name: "INSERT_TIME", type: "CHAR(19)" },
        { name: "UPDATE_USER", type: "VARCHAR(100)" }, { name: "UPDATE_TIME", type: "CHAR(19)" }
      ], primaryKey: ["pet_skill_id"], foreignKeys: [], auditTimeFormat: "KST_YYYY-MM-DD HH:MM:SS"
    }];
    assert.doesNotThrow(() => validateObjectDataModelContract(petSkill));
  });
});
