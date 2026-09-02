import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { validateObjectDataModelContract, type ObjectDataModelContract } from "../src/catalog/object-data-model-contract.js";

const contract = JSON.parse(readFileSync(new URL("../../migration-control/contracts/object-data-model-standard.v1.json", import.meta.url), "utf8")) as ObjectDataModelContract;
const fixture = JSON.parse(readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/object-data-model-standard-v1.json", import.meta.url), "utf8")) as ObjectDataModelContract;
const migration443 = readFileSync(new URL("../migrations/443_object_identity_audit_provider.sql", import.meta.url), "utf8");
const migration444 = readFileSync(new URL("../migrations/444_canonical_item_inventory.sql", import.meta.url), "utf8");
const migration445 = readFileSync(new URL("../migrations/445_object_furniture_home_canonical_model.sql", import.meta.url), "utf8");
const migration446 = readFileSync(new URL("../migrations/446_canonical_pet_equipment.sql", import.meta.url), "utf8");
const copy = (): ObjectDataModelContract => JSON.parse(JSON.stringify(fixture)) as ObjectDataModelContract;

describe("object data model standard contract", () => {
  it("accepts the registered identity/audit, item, and furniture schema contract", () => {
    assert.doesNotThrow(() => validateObjectDataModelContract(contract));
    assert.equal(contract.scope, "new_object_schema_only");
    assert.deepEqual(contract.registeredMigrations, ["443_object_identity_audit_provider.sql", "444_canonical_item_inventory.sql", "445_object_furniture_home_canonical_model.sql", "446_canonical_pet_equipment.sql"]);
    assert.deepEqual(contract.tables.map((table) => table.table), ["object_identities", "object_identity_crosswalks", "canonical_players", "canonical_item_definitions", "canonical_item_definition_imports", "canonical_owned_item_stacks", "canonical_owned_item_instances", "canonical_item_inventory_operations", "canonical_item_inventory_ledger_entries", "object_furniture_definitions", "object_owned_furniture_instances", "object_home_furniture_placements", "object_furniture_operation_replays", "canonical_pet_definitions", "canonical_owned_pet_instances", "canonical_equipment_definitions", "canonical_owned_equipment_instances", "canonical_owned_pet_equipment", "canonical_pet_equipment_operation_replays"]);
  });

  it("keeps migration446 aligned with the common player provider and owner-bound replay contract", () => {
    for (const token of ["Requires 444_canonical_item_inventory.sql for canonical_players(player_id)", "REFERENCES canonical_players (player_id)", "UNIQUE KEY uq_canonical_owned_pet_owner (owned_pet_id, player_id)", "UNIQUE KEY uq_canonical_owned_equipment_owner (owned_equipment_id, player_id)", "FOREIGN KEY (owned_pet_id, player_id)", "FOREIGN KEY (owned_equipment_id, player_id)", "FOREIGN KEY (owned_pet_equipment_id, player_id)", "canonical_pet_equipment_operation_replays", "request_key VARCHAR(191)", "equipment_slot VARCHAR(50)"]) assert.match(migration446, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(migration446, /canonical_item_players/);
  });

  it("keeps migration443 DDL aligned with registered PK, FK, audit, and KST checks", () => {
    for (const token of ["object_identities", "object_identity_crosswalks", "object_identity_id CHAR(8)", "object_identity_crosswalk_id CHAR(8)", "FOREIGN KEY (object_identity_id)", "INSERT_USER VARCHAR(100)", "UPDATE_TIME CHAR(19)", "2[0-3]", "[0-5][0-9]"]) assert.match(migration443, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  it("registers the additive canonical item schema without altering legacy item tables", () => {
    for (const token of ["canonical_players", "canonical_item_definitions", "canonical_owned_item_stacks", "canonical_owned_item_instances", "canonical_item_inventory_ledger_entries", "price_currency_source_identifier", "item_id CHAR(8)", "owned_item_id CHAR(8)", "FOREIGN KEY (player_id)", "INSERT_USER VARCHAR(100)", "UPDATE_TIME CHAR(19)"]) assert.match(migration444, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(migration444, /ALTER TABLE item_definitions/i);
    assert.doesNotMatch(migration444, /\bCODE\b/i);
  });

  it("keeps migration445 definition values separate from owned instance state", () => {
    for (const token of ["444_canonical_item_inventory.sql", "canonical_players (player_id)", "object_furniture_definitions", "object_owned_furniture_instances", "object_home_furniture_placements", "object_furniture_operation_replays", "furniture_id CHAR(8)", "owned_furniture_id CHAR(8)", "base_charm BIGINT", "charm_per_enhancement BIGINT", "enhancement_level INT UNSIGNED", "INSERT_USER VARCHAR(100)", "UPDATE_TIME CHAR(19)"]) assert.match(migration445, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(migration445, /final_charm/);
    assert.doesNotMatch(migration445, /charm_snapshot/);
    assert.doesNotMatch(migration445, /ownership_status/);
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
