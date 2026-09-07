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
const migration447 = readFileSync(new URL("../migrations/447_canonical_mini_pet.sql", import.meta.url), "utf8");
const migration448 = readFileSync(new URL("../migrations/448_canonical_title_domains.sql", import.meta.url), "utf8");
const migration450 = readFileSync(new URL("../migrations/450_object_furniture_market_active_listing.sql", import.meta.url), "utf8");
const migration449 = readFileSync(new URL("../migrations/449_canonical_pet_skill.sql", import.meta.url), "utf8");
const migration452 = readFileSync(new URL("../migrations/452_canonical_currency_ledger.sql", import.meta.url), "utf8");
const migration451 = readFileSync(new URL("../migrations/451_canonical_package_reward.sql", import.meta.url), "utf8");
const migration453 = readFileSync(new URL("../migrations/453_canonical_building_recipe.sql", import.meta.url), "utf8");
const migration470 = readFileSync(new URL("../migrations/470_pet_explore_event_control_app_wiring.sql", import.meta.url), "utf8");
const migration471 = readFileSync(new URL("../migrations/471_pet_title_sale_app_wiring.sql", import.meta.url), "utf8");
const copy = (): ObjectDataModelContract => JSON.parse(JSON.stringify(fixture)) as ObjectDataModelContract;

describe("object data model standard contract", () => {
  it("accepts the registered identity/audit, item, and furniture schema contract", () => {
    assert.doesNotThrow(() => validateObjectDataModelContract(contract));
    assert.equal(contract.scope, "new_object_schema_only");
    assert.deepEqual(contract.registeredMigrations, ["443_object_identity_audit_provider.sql", "444_canonical_item_inventory.sql", "445_object_furniture_home_canonical_model.sql", "446_canonical_pet_equipment.sql", "447_canonical_mini_pet.sql", "448_canonical_title_domains.sql", "449_canonical_pet_skill.sql", "450_object_furniture_market_active_listing.sql", "451_canonical_package_reward.sql", "452_canonical_currency_ledger.sql", "453_canonical_building_recipe.sql", "454_object_import_crosswalk_payload_fingerprint.sql", "455_title_instance_acquisition_price.sql", "456_owned_object_state_hardening.sql", "457_data_migration_common_staging.sql", "458_data_migration_catalog_projection.sql", "459_catalog_projection_upstream_envelope.sql", "460_data_migration_object_domain_import.sql", "461_object_db_transition_identity_crosswalk.sql", "462_object_db_transition_app_wiring_claim.sql", "463_object_db_transition_operation_receipts.sql", "464_object_db_transition_typed_asset_ledgers.sql", "465_object_db_transition_operation_participants.sql", "466_object_db_transition_recovery_receipt_links.sql", "470_pet_explore_event_control_app_wiring.sql", "471_pet_title_sale_app_wiring.sql", "472_pet_title_admin_batch_app_wiring.sql", "474_pet_title_batch_member_key_snapshot.sql", "478_guild_territory_attack_runtime_item_policy.sql", "479_admin_global_gift_object_db.sql", "481_canonical_pet_skill_read_provider.sql", "482_canonical_pet_skill_grade_unicode.sql"]);
    assert.equal(contract.registeredMigrations.length, 32);
    assert.equal(contract.tables.length, 105);
    assert.deepEqual(contract.integrationOnlyTables?.map(({ table, integrationMigration, primaryKey }) => ({ table, integrationMigration, primaryKey })), [{ table: "guild_territory_attack_policy_versions", integrationMigration: "353_guild_territory_attack_execute.sql", primaryKey: ["policy_scope_code", "policy_version"] }]);
    const appWiring = contract.tables.find((entry) => entry.table === "canonical_app_wiring_operations");
    const receiptLinks = contract.tables.find((entry) => entry.table === "canonical_app_wiring_receipt_links");
    const eventControl = contract.tables.find((entry) => entry.table === "canonical_pet_explore_event_control_operations");
    assert.ok(appWiring);
    assert.ok(receiptLinks);
    assert.ok(eventControl);
    assert.deepEqual(appWiring.columns.slice(14, 21).map(({ name }) => name), ["effect_mode", "lease_token", "lease_generation", "lease_expires_time", "attempt_count", "recovery_status", "recovery_code"]);
    assert.deepEqual(eventControl.columns.map(({ name }) => name), ["pet_explore_event_control_operation_id", "event_code", "requested_active", "previous_active", "previous_version", "resulting_version", "relocated_participant_count", "replay_namespace", "request_key", "payload_fingerprint", "result_fingerprint", "operation_status", "INSERT_USER", "INSERT_TIME", "UPDATE_USER", "UPDATE_TIME"]);
    assert.deepEqual(eventControl.primaryKey, ["pet_explore_event_control_operation_id"]);
    assert.deepEqual(eventControl.uniqueKeys, [["replay_namespace", "request_key"]]);
    assert.equal(eventControl.auditTimeFormat, "KST_YYYY-MM-DD HH:MM:SS");
    const eventChecks = (eventControl as typeof eventControl & { checks: Array<{ constraint: string; expression: string }> }).checks;
    assert.deepEqual(eventChecks.map(({ constraint }) => constraint), ["chk_odbt_470_01_event", "chk_odbt_470_01_version", "chk_odbt_470_01_payload", "chk_odbt_470_01_result", "chk_odbt_470_01_status", "chk_odbt_470_01_insert_time", "chk_odbt_470_01_update_time"]);
    assert.match(eventChecks.find(({ constraint }) => constraint === "chk_odbt_470_01_insert_time")?.expression ?? "", /2\[0-3\].*\[0-5\]\[0-9\]/);
    assert.match(eventChecks.find(({ constraint }) => constraint === "chk_odbt_470_01_update_time")?.expression ?? "", /2\[0-3\].*\[0-5\]\[0-9\]/);
    assert.equal(receiptLinks.columns.length, 19);
    assert.equal(receiptLinks.foreignKeys.length, 12);
    assert.equal(receiptLinks.uniqueKeys?.length, 12);
    assert.ok(receiptLinks.columns.some(({ name }) => name === "pet_explore_event_control_operation_id"));
    assert.ok(receiptLinks.foreignKeys.some(({ column, referencesTable, referencesColumn }) => column === "pet_explore_event_control_operation_id" && referencesTable === "canonical_pet_explore_event_control_operations" && referencesColumn === "pet_explore_event_control_operation_id"));
    assert.ok(receiptLinks.uniqueKeys?.some((key) => key.length === 1 && key[0] === "pet_explore_event_control_operation_id"));
    const receiptChecks = (receiptLinks as typeof receiptLinks & { checks: Array<{ constraint: string; expression: string }> }).checks;
    assert.match(receiptChecks.find(({ constraint }) => constraint === "chk_odbt_472_03_rule_01")?.expression ?? "", /pet_title_batch_operation_id IS NOT NULL/);
    assert.match(receiptChecks.find(({ constraint }) => constraint === "chk_odbt_472_03_rule_02")?.expression ?? "", /receipt_kind = 'PET_TITLE_BATCH' AND pet_title_batch_operation_id IS NOT NULL/);
    for (const table of ["data_migration_common_staging_runs", "data_migration_common_staging_records", "data_migration_catalog_projection_runs", "data_migration_catalog_source_decisions", "data_migration_catalog_projection_records", "data_migration_object_domain_import_runs", "data_migration_object_domain_import_decisions", "data_migration_object_domain_import_records"]) assert.ok(contract.tables.some((entry) => entry.table === table));
    for (const table of ["object_identities", "object_identity_crosswalks", "canonical_players", "canonical_item_definitions", "canonical_item_definition_imports", "canonical_owned_item_stacks", "canonical_owned_item_instances", "canonical_item_inventory_operations", "canonical_item_inventory_ledger_entries", "object_furniture_definitions", "object_owned_furniture_instances", "object_home_furniture_placements", "object_furniture_operation_replays", "canonical_pet_definitions", "canonical_owned_pet_instances", "canonical_equipment_definitions", "canonical_owned_equipment_instances", "canonical_owned_pet_equipment", "canonical_pet_equipment_operation_replays", "object_furniture_ownership_history", "object_furniture_market_listings", "object_furniture_active_market_listings", "canonical_mini_pet_definitions", "canonical_mini_pet_enhancement_rules", "canonical_owned_mini_pet_instances", "canonical_mini_pet_operation_replays", "canonical_member_title_definitions", "canonical_owned_member_title_instances", "canonical_member_title_selections", "canonical_pet_title_definitions", "canonical_owned_pet_title_instances", "canonical_pet_title_selections", "canonical_mini_pet_title_definitions", "canonical_owned_mini_pet_title_instances", "canonical_mini_pet_title_selections", "canonical_pet_skill_definitions", "canonical_pet_skill_definition_imports", "canonical_pet_skill_aliases", "canonical_pet_skill_draw_grade_policies", "canonical_owned_pet_skill_stacks", "canonical_owned_pet_skill_equipments", "canonical_pet_skill_operation_replays", "canonical_package_definitions", "canonical_package_definition_imports", "canonical_package_reward_groups", "canonical_package_reward_entries", "canonical_package_item_rewards", "canonical_package_nested_rewards", "canonical_package_reward_quarantines", "canonical_package_definition_replays", "canonical_currency_definitions", "canonical_currency_definition_imports", "canonical_player_currency_balances", "canonical_currency_operations", "canonical_currency_ledger_entries"]) assert.ok(contract.tables.some((entry) => entry.table === table));
    for (const table of ["canonical_building_definitions", "canonical_building_definition_imports", "canonical_craft_recipe_definitions", "canonical_craft_recipe_definition_imports", "canonical_craft_recipe_item_inputs", "canonical_craft_recipe_currency_inputs", "canonical_craft_recipe_item_outputs", "canonical_craft_recipe_currency_outputs", "canonical_building_craft_recipes", "canonical_craft_operations", "canonical_craft_item_ledger_entries", "canonical_craft_currency_ledger_entries"]) assert.ok(contract.tables.some((entry) => entry.table === table));
  });

  it("keeps migration470 event-control receipt schema and additive link discriminator exact", () => {
    for (const token of [
      "canonical_pet_explore_event_control_operations",
      "pet_explore_event_control_operation_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin",
      "UNIQUE KEY uq_odbt_470_01_01 (replay_namespace, request_key)",
      "event_code IN ('diamond_mine','guild_raid')",
      "resulting_version = previous_version OR resulting_version = previous_version + 1",
      "operation_status IN ('COMPLETED','FAILED')",
      "ADD COLUMN IF NOT EXISTS pet_explore_event_control_operation_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NULL",
      "ADD UNIQUE KEY IF NOT EXISTS uq_odbt_470_02_01 (pet_explore_event_control_operation_id)",
      "REFERENCES canonical_pet_explore_event_control_operations (pet_explore_event_control_operation_id)",
      "receipt_kind = 'PET_EXPLORE_EVENT_CONTROL' AND pet_explore_event_control_operation_id IS NOT NULL",
    ]) assert.ok(migration470.includes(token), token);
    assert.equal((migration470.match(/pet_explore_event_control_operation_id IS NOT NULL/g) ?? []).length, 2);
  });

  it("keeps migration471 PET_TITLE sale linked to one exact currency operation",()=>{
    const receipt=contract.tables.find(({table})=>table==="canonical_pet_title_operations");
    assert.ok(receipt);
    assert.ok(receipt.columns.some(({name,type})=>name==="currency_operation_id"&&type==="CHAR(8)"));
    assert.ok(receipt.foreignKeys.some((foreignKey)=>Array.isArray(foreignKey.columns)&&foreignKey.columns.join(",")==="currency_operation_id,player_id"&&foreignKey.referencesTable==="canonical_currency_operations"&&Array.isArray(foreignKey.referencesColumns)&&foreignKey.referencesColumns.join(",")==="currency_operation_id,player_id"));
    assert.ok(receipt.uniqueKeys?.some((key)=>key.length===1&&key[0]==="currency_operation_id"));
    for(const token of ["ADD UNIQUE KEY IF NOT EXISTS uq_odbt_471_00_01 (currency_operation_id,player_id)","ADD COLUMN IF NOT EXISTS currency_operation_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NULL","ADD UNIQUE KEY IF NOT EXISTS uq_odbt_471_01_01 (currency_operation_id)","REFERENCES canonical_currency_operations (currency_operation_id,player_id)","('PET_TITLE_SELL','pet_title_lifecycle','VERIFIED_USER','SHADOW',1,1)"])assert.ok(migration471.includes(token),token);
  });

  it("keeps building and recipe definitions, typed targets, replay, and owner-bound ledgers explicit", () => {
    for (const token of ["canonical_building_definitions", "canonical_craft_recipe_definitions", "canonical_craft_recipe_item_inputs", "canonical_craft_recipe_currency_inputs", "canonical_craft_recipe_item_outputs", "canonical_craft_recipe_currency_outputs", "canonical_craft_operations", "payload_fingerprint CHAR(64)", "FOREIGN KEY (craft_operation_id, player_id)", "FOREIGN KEY (owned_item_stack_id, player_id, item_id)", "FOREIGN KEY (player_currency_balance_id, player_id, currency_id)", "ALTER TABLE outbox_messages", "fk_outbox_canonical_craft_owner"]) assert.ok(migration453.includes(token));
    assert.doesNotMatch(migration453, /\bCODE\b|javascript|script_body|sql_payload/i);
    assert.ok(contract.integrationOnlyTables?.some(({ table }) => table === "guild_territory_attack_policy_versions"));
  });

  it("keeps migration446 aligned with the common player provider and owner-bound replay contract", () => {
    for (const token of ["Requires 444_canonical_item_inventory.sql for canonical_players(player_id)", "REFERENCES canonical_players (player_id)", "UNIQUE KEY uq_canonical_owned_pet_owner (owned_pet_id, player_id)", "UNIQUE KEY uq_canonical_owned_equipment_owner (owned_equipment_id, player_id)", "FOREIGN KEY (owned_pet_id, player_id)", "FOREIGN KEY (owned_equipment_id, player_id)", "FOREIGN KEY (owned_pet_equipment_id, player_id)", "canonical_pet_equipment_operation_replays", "request_key VARCHAR(191)", "equipment_slot VARCHAR(50)"]) assert.match(migration446, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(migration446, /canonical_item_players/);
  });

  it("keeps canonical pet skill definition, ownership and equipment boundaries explicit", () => {
    for (const token of ["handler_key", "options_json JSON", "canonical_owned_pet_skill_stacks", "quantity BIGINT UNSIGNED", "canonical_owned_pet_skill_equipments", "owned_pet_id", "payload_fingerprint CHAR(64)", "operation_kind", "FOREIGN KEY (owned_pet_id, player_id)"]) assert.match(migration449, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(migration449, /(?:javascript|sql_payload|script_body)/i);
    assert.doesNotMatch(migration449, /pet_skill_(?:name|grade).*canonical_owned_pet_skill_stacks/);
  });

  it("keeps canonical currency balance, replay, and ledger owner bindings lossless", () => {
    for (const token of ["canonical_currency_definitions", "currency_id CHAR(8)", "decimal_places TINYINT UNSIGNED", "canonical_player_currency_balances", "balance_minor_amount BIGINT UNSIGNED", "canonical_currency_operations", "delta_minor_amount BIGINT", "request_key VARCHAR(182)", "canonical_currency_ledger_entries", "UNIQUE KEY uq_canonical_player_currency_balance_owner (player_currency_balance_id, player_id, currency_id)", "FOREIGN KEY (player_currency_balance_id, player_id, currency_id)", "UNIQUE KEY uq_canonical_currency_operation_balance (currency_operation_id, player_currency_balance_id)", "FOREIGN KEY (currency_operation_id, player_currency_balance_id)"]) assert.match(migration452, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(migration452, /(?:currency|reason|object)_code/i);
    assert.doesNotMatch(migration452, /\b(?:DECIMAL\s*\(|DOUBLE\s|FLOAT\s)/i);
    const invalidOperationLink = migration452.replace("FOREIGN KEY (player_currency_balance_id, player_id, currency_id)", "FOREIGN KEY (player_currency_balance_id)");
    assert.doesNotMatch(invalidOperationLink, /FOREIGN KEY \(player_currency_balance_id, player_id, currency_id\)/);
    const invalidLedgerLink = migration452.replace("FOREIGN KEY (currency_operation_id, player_currency_balance_id)", "FOREIGN KEY (currency_operation_id)");
    assert.doesNotMatch(invalidLedgerLink, /FOREIGN KEY \(currency_operation_id, player_currency_balance_id\)/);
  });

  it("keeps canonical package rewards typed and unresolved targets quarantined", () => {
    for (const token of ["canonical_package_definitions", "canonical_package_reward_groups", "canonical_package_reward_entries", "canonical_package_item_rewards", "canonical_package_nested_rewards", "canonical_package_reward_quarantines", "canonical_package_definition_replays", "FOREIGN KEY (item_id) REFERENCES canonical_item_definitions (item_id)", "payload_fingerprint CHAR(64)", "request_key VARCHAR(182)"]) assert.match(migration451, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const replay = contract.tables.find((entry) => entry.table === "canonical_package_definition_replays");
    assert.equal(replay?.columns.find((column) => column.name === "request_key")?.type, "VARCHAR(182)");
    assert.doesNotMatch(migration451, /ALTER TABLE (?:package_catalog|package_rewards|object_registry)/i);
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
    assert.match(migration445, /ownership_status/);
  });

  it("keeps cancelled and sold market history while allowing one active listing", () => {
    for (const token of ["CREATE INDEX IF NOT EXISTS idx_object_furniture_market_owned", "uq_object_furniture_market_listing_owner", "FOREIGN KEY (furniture_market_listing_id, owned_furniture_id)", "INSERT INTO object_furniture_active_market_listings", "listing.listing_status = 'active'", "NOT EXISTS", "DROP INDEX IF EXISTS uq_object_furniture_market_listing_owned", "PRIMARY KEY (furniture_market_listing_id)", "uq_object_furniture_active_market_owned", "FOREIGN KEY (owned_furniture_id)"]) assert.match(migration450, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const activeMarket = contract.tables.find((entry) => entry.table === "object_furniture_active_market_listings");
    assert.deepEqual(activeMarket?.uniqueKeys, [["owned_furniture_id"]]);
  });

  it("keeps migration447 definitions separate from each owned mini-pet copy", () => {
    for (const token of ["444_canonical_item_inventory.sql", "canonical_mini_pet_definitions", "canonical_mini_pet_enhancement_rules", "canonical_owned_mini_pet_instances", "canonical_mini_pet_operation_replays", "mini_pet_id CHAR(8)", "owned_mini_pet_id CHAR(8)", "base_battle_charm BIGINT", "target_enhancement_level INT UNSIGNED", "enhancement_level INT UNSIGNED", "INSERT_USER VARCHAR(100)", "UPDATE_TIME CHAR(19)"]) assert.match(migration447, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(migration447, /final_(?:battle_|castle_|raid_)?charm/i);
    assert.doesNotMatch(migration447, /(?:mini_pet_|object_)code/i);
  });

  it("keeps migration448 split across member, pet, and mini-pet definitions, ownership, and selection", () => {
    for (const token of [
      "Requires 443_object_identity_audit_provider.sql and 444_canonical_item_inventory.sql",
      "canonical_member_title_definitions", "canonical_owned_member_title_instances", "canonical_member_title_selections",
      "canonical_pet_title_definitions", "canonical_owned_pet_title_instances", "canonical_pet_title_selections",
      "canonical_mini_pet_title_definitions", "canonical_owned_mini_pet_title_instances", "canonical_mini_pet_title_selections",
      "base_sale_price BIGINT UNSIGNED", "acquisition_sequence BIGINT UNSIGNED", "acquired_time CHAR(19)",
      "FOREIGN KEY (owned_member_title_id, player_id)", "FOREIGN KEY (owned_pet_title_id, player_id)", "FOREIGN KEY (owned_mini_pet_title_id, player_id)"
    ]) assert.match(migration448, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    for (const table of ["canonical_owned_member_title_instances", "canonical_owned_pet_title_instances", "canonical_owned_mini_pet_title_instances"]) {
      const body = migration448.match(new RegExp(`CREATE TABLE ${table} \\(([\\s\\S]*?)\\n\\) ENGINE`))?.[1] ?? "";
      assert.doesNotMatch(body, /title_name|base_sale_price|active_flag/);
    }
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

  it("allows only explicit semantic code columns while rejecting object CODE columns and executable payloads", () => {
    const bareId = copy();
    bareId.tables[1]!.columns = [...bareId.tables[1]!.columns, { name: "ID", type: "CHAR(8)" }];
    assert.throws(() => validateObjectDataModelContract(bareId), /BARE_ID/);
    const uppercaseCode = copy();
    uppercaseCode.tables[1]!.columns = [...uppercaseCode.tables[1]!.columns, { name: "ITEM_CODE", type: "VARCHAR(20)" }];
    assert.throws(() => validateObjectDataModelContract(uppercaseCode), /OBJECT_CODE/);
    for (const name of ["command_code", "environment_code", "error_code", "event_code", "provider_code", "reason_code"]) {
      const semanticCode = copy();
      semanticCode.tables[1]!.columns = [...semanticCode.tables[1]!.columns, { name, type: "VARCHAR(100)" }];
      assert.doesNotThrow(() => validateObjectDataModelContract(semanticCode), name);
    }
    const undeclaredSemanticCode = copy();
    undeclaredSemanticCode.tables[1]!.columns = [...undeclaredSemanticCode.tables[1]!.columns, { name: "status_code", type: "VARCHAR(20)" }];
    assert.throws(() => validateObjectDataModelContract(undeclaredSemanticCode), /OBJECT_CODE/);
    for (const name of ["script_body", "sql_payload", "handler_script", "javascript_source"]) {
      const executable = copy();
      executable.tables[1]!.columns = [...executable.tables[1]!.columns, { name, type: "TEXT" }];
      assert.throws(() => validateObjectDataModelContract(executable), /EXECUTABLE_PAYLOAD/, name);
    }
  });

  it("requires FK targets to be an exact declared candidate key and enforces ownership boundaries", () => {
    const nonPrimaryTarget = copy();
    nonPrimaryTarget.tables[1]!.primaryKey = ["other_item_id"];
    nonPrimaryTarget.tables[1]!.columns = [...nonPrimaryTarget.tables[1]!.columns, { name: "other_item_id", type: "CHAR(8)", charset: "ascii", collation: "ascii_bin" }];
    assert.throws(() => validateObjectDataModelContract(nonPrimaryTarget), /FK_NOT_CANDIDATE_KEY/);
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

  it("validates composite FK column names, order, candidate key, and shape", () => {
    const valid = copy();
    valid.tables = [...valid.tables, {
      table: "owned_item_events", role: "history",
      columns: [
        { name: "owned_item_event_id", type: "CHAR(8)", charset: "ascii", collation: "ascii_bin" },
        { name: "player_id", type: "CHAR(8)", charset: "ascii", collation: "ascii_bin" },
        { name: "item_id", type: "CHAR(8)", charset: "ascii", collation: "ascii_bin" },
        { name: "INSERT_USER", type: "VARCHAR(100)" }, { name: "INSERT_TIME", type: "CHAR(19)" },
        { name: "UPDATE_USER", type: "VARCHAR(100)" }, { name: "UPDATE_TIME", type: "CHAR(19)" }
      ],
      primaryKey: ["owned_item_event_id"],
      foreignKeys: [{ columns: ["player_id", "item_id"], referencesTable: "owned_items", referencesColumns: ["player_id", "item_id"] }],
      auditTimeFormat: "KST_YYYY-MM-DD HH:MM:SS"
    }];
    assert.doesNotThrow(() => validateObjectDataModelContract(valid));

    const wrongOrder = JSON.parse(JSON.stringify(valid)) as ObjectDataModelContract;
    wrongOrder.tables.at(-1)!.foreignKeys = [{ columns: ["player_id", "item_id"], referencesTable: "owned_items", referencesColumns: ["item_id", "player_id"] }];
    assert.throws(() => validateObjectDataModelContract(wrongOrder), /FK_NAME/);
    const partialCandidate = JSON.parse(JSON.stringify(valid)) as ObjectDataModelContract;
    partialCandidate.tables.at(-1)!.foreignKeys = [{ column: "player_id", referencesTable: "owned_items", referencesColumn: "player_id" }];
    assert.throws(() => validateObjectDataModelContract(partialCandidate), /FK_NOT_CANDIDATE_KEY/);
    const wrongShape = JSON.parse(JSON.stringify(valid)) as ObjectDataModelContract;
    wrongShape.tables.at(-1)!.columns = wrongShape.tables.at(-1)!.columns.map((entry) => entry.name === "item_id" ? { ...entry, collation: "ascii_general_ci" } : entry);
    assert.throws(() => validateObjectDataModelContract(wrongShape), /FK_SHAPE/);
    const wrongArity = JSON.parse(JSON.stringify(valid)) as ObjectDataModelContract;
    wrongArity.tables.at(-1)!.foreignKeys = [{ columns: ["player_id", "item_id"], referencesTable: "owned_items", referencesColumns: ["player_id"] }];
    assert.throws(() => validateObjectDataModelContract(wrongArity), /FK_ARITY/);
    const mixedDeclaration = JSON.parse(JSON.stringify(valid)) as ObjectDataModelContract;
    mixedDeclaration.tables.at(-1)!.foreignKeys = [{ column: "player_id", columns: ["player_id"], referencesTable: "players", referencesColumn: "player_id", referencesColumns: ["player_id"] }];
    assert.throws(() => validateObjectDataModelContract(mixedDeclaration), /FK_DECLARATION/);
  });

  it("allows only the pinned external identity composite candidate key", () => {
    const withExternalReference = (): ObjectDataModelContract => {
      const value = copy();
      value.tables = [...value.tables, {
        table: "canonical_player_identity_crosswalks", role: "relation",
        columns: [
          { name: "player_identity_crosswalk_id", type: "CHAR(8)", charset: "ascii", collation: "ascii_bin" },
          { name: "provider_code", type: "VARCHAR(64)", charset: "ascii", collation: "ascii_bin" },
          { name: "external_user_id", type: "VARCHAR(191)", charset: "utf8mb4", collation: "utf8mb4_bin" },
          { name: "INSERT_USER", type: "VARCHAR(100)" }, { name: "INSERT_TIME", type: "CHAR(19)" },
          { name: "UPDATE_USER", type: "VARCHAR(100)" }, { name: "UPDATE_TIME", type: "CHAR(19)" }
        ],
        primaryKey: ["player_identity_crosswalk_id"],
        foreignKeys: [{ columns: ["provider_code", "external_user_id"], referencesTable: "external_identities", referencesColumns: ["provider_code", "external_user_id"] }],
        auditTimeFormat: "KST_YYYY-MM-DD HH:MM:SS"
      }];
      return value;
    };
    const missingDependency = withExternalReference();
    assert.throws(() => validateObjectDataModelContract(missingDependency), /FK_TARGET/);

    const pinned = withExternalReference();
    pinned.externalDependencies = [{
      table: "external_identities", integrationMigration: "003_identity_import.sql",
      columns: [
        { name: "id", type: "BIGINT UNSIGNED" },
        { name: "provider_code", type: "VARCHAR(64)", charset: "ascii", collation: "ascii_bin" },
        { name: "external_user_id", type: "VARCHAR(191)", charset: "utf8mb4", collation: "utf8mb4_bin" }
      ],
      primaryKey: ["id"], uniqueKeys: [["provider_code", "external_user_id"]]
    }];
    assert.doesNotThrow(() => validateObjectDataModelContract(pinned));

    const dependencyShapeMismatch = JSON.parse(JSON.stringify(pinned)) as ObjectDataModelContract;
    dependencyShapeMismatch.externalDependencies![0]!.columns = dependencyShapeMismatch.externalDependencies![0]!.columns.map((entry) => entry.name === "provider_code" ? { ...entry, type: "VARCHAR(32)" } : entry);
    assert.throws(() => validateObjectDataModelContract(dependencyShapeMismatch), /EXTERNAL_DEPENDENCY_COLUMNS/);
    const localShapeMismatch = JSON.parse(JSON.stringify(pinned)) as ObjectDataModelContract;
    localShapeMismatch.tables.at(-1)!.columns = localShapeMismatch.tables.at(-1)!.columns.map((entry) => entry.name === "external_user_id" ? { ...entry, collation: "utf8mb4_unicode_ci" } : entry);
    assert.throws(() => validateObjectDataModelContract(localShapeMismatch), /FK_SHAPE/);
    const arbitraryExternal = copy();
    arbitraryExternal.externalDependencies = [{ table: "unknown_external", integrationMigration: "003_identity_import.sql", columns: [], primaryKey: [], uniqueKeys: [] }];
    assert.throws(() => validateObjectDataModelContract(arbitraryExternal), /EXTERNAL_DEPENDENCY_NOT_PINNED/);
  });

  it("pins the legacy operations key used by canonical global-gift delivery evidence",()=>{
    const valid=JSON.parse(JSON.stringify(contract)) as ObjectDataModelContract;
    const dependency=valid.externalDependencies?.find(({table})=>table==="operations");
    assert.deepEqual(dependency?.primaryKey,["id"]);
    assert.deepEqual(dependency?.uniqueKeys,[["operation_key"]]);
    assert.doesNotThrow(()=>validateObjectDataModelContract(valid));
    const drift=JSON.parse(JSON.stringify(valid)) as ObjectDataModelContract;
    drift.externalDependencies!.find(({table})=>table==="operations")!.columns[1]!.collation="utf8mb4_bin";
    assert.throws(()=>validateObjectDataModelContract(drift),/EXTERNAL_DEPENDENCY_COLUMNS/);
  });

  it("requires migrations and registered tables to be paired", () => {
    const migrationOnly = copy();
    migrationOnly.tables = [];
    assert.throws(() => validateObjectDataModelContract(migrationOnly), /REGISTRATION_PAIR/);
    const tableOnly = copy();
    tableOnly.registeredMigrations = [];
    assert.throws(() => validateObjectDataModelContract(tableOnly), /REGISTRATION_PAIR/);
  });

  it("rejects unpinned or shape-mismatched integration-only dependencies", () => {
    const invalidMigration = copy();
    invalidMigration.integrationOnlyTables = [{ table: "canonical_players", role: "identity", columns: [{ name: "player_id", type: "CHAR(8)", charset: "ascii", collation: "ascii_bin" }], primaryKey: ["player_id"], foreignKeys: [], integrationMigration: "unversioned.sql" }];
    assert.throws(() => validateObjectDataModelContract(invalidMigration), /INTEGRATION_MIGRATION_INVALID/);
    const fakeValidFilename = copy();
    fakeValidFilename.integrationOnlyTables = [{ table: "canonical_players", role: "identity", columns: [{ name: "player_id", type: "CHAR(8)", charset: "ascii", collation: "ascii_bin" }], primaryKey: ["player_id"], foreignKeys: [], integrationMigration: "999_fake_players.sql" }];
    assert.throws(() => validateObjectDataModelContract(fakeValidFilename), /INTEGRATION_DEPENDENCY_NOT_PINNED/);
    const invalidShape = copy();
    invalidShape.integrationOnlyTables = [{ table: "canonical_players", role: "identity", columns: [{ name: "player_id", type: "BIGINT" }], primaryKey: ["player_id"], foreignKeys: [], integrationMigration: "444_canonical_item_inventory.sql" }];
    assert.throws(() => validateObjectDataModelContract(invalidShape), /IDENTIFIER_SHAPE/);
    const missingOwnerKey = copy();
    missingOwnerKey.integrationOnlyTables = [{
      table: "canonical_owned_pet_instances", role: "ownership_instance",
      columns: [{ name: "owned_pet_id", type: "CHAR(8)", charset: "ascii", collation: "ascii_bin" }, { name: "player_id", type: "CHAR(8)", charset: "ascii", collation: "ascii_bin" }],
      primaryKey: ["owned_pet_id"], foreignKeys: [], uniqueKeys: [], integrationMigration: "446_canonical_pet_equipment.sql"
    }];
    assert.throws(() => validateObjectDataModelContract(missingOwnerKey), /INTEGRATION_UNIQUE_KEY_MISSING/);
    const fakeCurrencyMigration = copy();
    fakeCurrencyMigration.integrationOnlyTables = [{ table: "canonical_currency_definitions", role: "definition", columns: [{ name: "currency_id", type: "CHAR(8)", charset: "ascii", collation: "ascii_bin" }], primaryKey: ["currency_id"], foreignKeys: [], integrationMigration: "999_fake_currency.sql" }];
    assert.throws(() => validateObjectDataModelContract(fakeCurrencyMigration), /INTEGRATION_DEPENDENCY_NOT_PINNED/);
    const missingBalanceOwnerTarget = copy();
    missingBalanceOwnerTarget.integrationOnlyTables = [{
      table: "canonical_player_currency_balances", role: "ownership_quantity",
      columns: [{ name: "player_currency_balance_id", type: "CHAR(8)", charset: "ascii", collation: "ascii_bin" }, { name: "player_id", type: "CHAR(8)", charset: "ascii", collation: "ascii_bin" }, { name: "currency_id", type: "CHAR(8)", charset: "ascii", collation: "ascii_bin" }],
      primaryKey: ["player_currency_balance_id"], foreignKeys: [], uniqueKeys: [["player_id", "currency_id"]], integrationMigration: "452_canonical_currency_ledger.sql"
    }];
    assert.throws(() => validateObjectDataModelContract(missingBalanceOwnerTarget), /INTEGRATION_UNIQUE_KEY_MISSING/);
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
