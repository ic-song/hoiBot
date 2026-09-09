import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const migration = readFileSync(new URL("../migrations/455_title_instance_acquisition_price.sql", import.meta.url), "utf8");
const rollback = readFileSync(new URL("../migrations/rollback/455_title_instance_acquisition_price.rollback.sql", import.meta.url), "utf8");
const contract = JSON.parse(readFileSync(new URL("../../migration-control/contracts/object-data-model-standard.v1.json", import.meta.url), "utf8")) as {
  registeredMigrations: string[];
  tables: Array<{ table: string; columns: Array<{ name: string; type: string }>; allowedStateColumns?: string[] }>;
};

const scopes = [
  { owned: "canonical_owned_member_title_instances", definition: "canonical_member_title_definitions", foreignKey: "member_title_id" },
  { owned: "canonical_owned_pet_title_instances", definition: "canonical_pet_title_definitions", foreignKey: "pet_title_id" },
  { owned: "canonical_owned_mini_pet_title_instances", definition: "canonical_mini_pet_title_definitions", foreignKey: "mini_pet_title_id" }
];

describe("title instance acquisition price migration", () => {
  it("adds a nullable unsigned occurrence price without fabricating unknown historical values", () => {
    for (const scope of scopes) {
      assert.match(migration, new RegExp(`ALTER TABLE ${scope.owned}\\s+ADD COLUMN IF NOT EXISTS acquisition_price BIGINT UNSIGNED NULL AFTER acquired_time;`));
      assert.match(rollback, new RegExp(`ALTER TABLE ${scope.owned}\\s+DROP COLUMN IF EXISTS acquisition_price;`));

      const table = contract.tables.find((candidate) => candidate.table === scope.owned);
      assert.deepEqual(table?.columns.find((column) => column.name === "acquisition_price"), { name: "acquisition_price", type: "BIGINT UNSIGNED" });
      assert.ok(table?.allowedStateColumns?.includes("acquisition_price"));
    }
    assert.ok(contract.registeredMigrations.includes("455_title_instance_acquisition_price.sql"));
    assert.equal((migration.match(/ADD COLUMN IF NOT EXISTS acquisition_price/g) ?? []).length, 3);
    assert.doesNotMatch(migration, /UPDATE\s+canonical_owned_|definition\.base_sale_price|MODIFY COLUMN acquisition_price/i);
    assert.doesNotMatch(migration, /acquisition_price[^;\r\n]*DEFAULT/i);
    assert.doesNotMatch(migration, /\bCODE\b|(^|\W)id(\W|$)/i);
  });

  it("rolls back exactly the same three columns", () => {
    const droppedTables = [...rollback.matchAll(/ALTER TABLE\s+(canonical_owned_[a-z_]+_title_instances)\s+DROP COLUMN IF EXISTS acquisition_price;/g)]
      .map((match) => match[1])
      .sort();
    assert.deepEqual(droppedTables, scopes.map((scope) => scope.owned).sort());
  });
});
