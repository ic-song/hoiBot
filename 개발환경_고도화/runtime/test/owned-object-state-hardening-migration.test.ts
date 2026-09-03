import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const migration = readFileSync(new URL("../migrations/456_owned_object_state_hardening.sql", import.meta.url), "utf8");
const rollback = readFileSync(new URL("../migrations/rollback/456_owned_object_state_hardening.rollback.sql", import.meta.url), "utf8");
const contract = JSON.parse(readFileSync(new URL("../../migration-control/contracts/object-data-model-standard.v1.json", import.meta.url), "utf8")) as {
  registeredMigrations: string[];
  tables: Array<{ table: string; columns: Array<{ name: string; type: string; charset?: string; collation?: string }>; allowedStateColumns?: string[] }>;
};

const constrainedTables = [
  { table: "canonical_owned_item_instances", constraint: "chk_canonical_owned_item_instance_status" },
  { table: "canonical_owned_pet_instances", constraint: "chk_canonical_owned_pet_status" },
  { table: "canonical_owned_equipment_instances", constraint: "chk_canonical_owned_equipment_status" }
];

describe("owned object state hardening migration", () => {
  it("adds nullable binary-collated mini-pet display overrides without copying definition values", () => {
    assert.match(migration, /ALTER TABLE canonical_owned_mini_pet_instances\s+ADD COLUMN IF NOT EXISTS custom_name VARCHAR\(255\) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL AFTER mini_pet_id;/);
    assert.match(migration, /ALTER TABLE canonical_owned_mini_pet_instances\s+ADD COLUMN IF NOT EXISTS custom_emoji VARCHAR\(32\) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL AFTER custom_name;/);
    assert.match(rollback, /ALTER TABLE canonical_owned_mini_pet_instances\s+DROP COLUMN IF EXISTS custom_emoji,\s+DROP COLUMN IF EXISTS custom_name;/);

    const table = contract.tables.find((candidate) => candidate.table === "canonical_owned_mini_pet_instances");
    assert.deepEqual(table?.columns.find((column) => column.name === "custom_name"), { name: "custom_name", type: "VARCHAR(255)", charset: "utf8mb4", collation: "utf8mb4_bin" });
    assert.deepEqual(table?.columns.find((column) => column.name === "custom_emoji"), { name: "custom_emoji", type: "VARCHAR(32)", charset: "utf8mb4", collation: "utf8mb4_bin" });
    assert.ok(table?.allowedStateColumns?.includes("custom_name"));
    assert.ok(table?.allowedStateColumns?.includes("custom_emoji"));
    assert.ok(!table?.allowedStateColumns?.includes("mini_pet_name"));
    assert.ok(!table?.allowedStateColumns?.includes("mini_pet_emoji"));
  });

  it("constrains item, pet, and equipment lifecycle values and rolls back the same checks", () => {
    for (const scope of constrainedTables) {
      assert.match(migration, new RegExp(`ALTER TABLE ${scope.table}\\s+ADD CONSTRAINT ${scope.constraint}\\s+CHECK \\(ownership_status IN \\('owned','listed','consumed','removed'\\)\\);`));
      assert.match(rollback, new RegExp(`ALTER TABLE ${scope.table}\\s+DROP CONSTRAINT ${scope.constraint};`));
    }
    assert.equal((migration.match(/ownership_status IN \('owned','listed','consumed','removed'\)/g) ?? []).length, constrainedTables.length);
    assert.ok(contract.registeredMigrations.includes("456_owned_object_state_hardening.sql"));
    assert.doesNotMatch(migration, /\bCODE\b|javascript|script_body|sql_payload/i);
  });
});
