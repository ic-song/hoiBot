import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { INDEPENDENT_PACKAGE_FIXTURES } from "./fixtures/package-parity.js";

const configured = ["DATABASE_HOST", "DATABASE_PORT", "DATABASE_USER", "DATABASE_PASSWORD", "DATABASE_NAME"]
  .every((name) => Boolean(process.env[name]));
const required = (name: string): string => process.env[name] ?? "integration-test-not-configured";
let database: DatabaseClient;

function jsonObject(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  return typeof value === "string" ? JSON.parse(value) as Record<string, unknown> : value as Record<string, unknown>;
}

(configured ? describe : describe.skip)("31 package MariaDB seed parity", () => {
  before(() => {
    database = createDatabaseClient({
      enabled: true,
      host: required("DATABASE_HOST"),
      port: Number(required("DATABASE_PORT")),
      user: required("DATABASE_USER"),
      password: required("DATABASE_PASSWORD"),
      name: required("DATABASE_NAME"),
      connectionLimit: 2,
      connectTimeoutMs: 5_000,
    });
  });

  after(async () => database.close());

  it("keeps every package seed without creating direct legacy command aliases", async () => {
    assert.equal(INDEPENDENT_PACKAGE_FIXTURES.length, 31);
    for (const fixture of INDEPENDENT_PACKAGE_FIXTURES) {
      const rows = await database.query<Array<Record<string, unknown>>>(
        `SELECT catalog.consume_item_id,catalog.max_open_count,
                COUNT(alias_row.command_text) AS active_alias_count
         FROM package_catalog catalog
         LEFT JOIN package_command_aliases alias_row
           ON alias_row.package_id=catalog.package_id AND alias_row.active=1
         WHERE catalog.package_id=?
         GROUP BY catalog.package_id,catalog.consume_item_id,catalog.max_open_count`,
        [fixture.packageId],
      );
      assert.equal(String(rows[0]?.consume_item_id), fixture.consumeItemId, fixture.packageId);
      assert.equal(Number(rows[0]?.max_open_count), fixture.maxOpenCount, fixture.packageId);
      assert.equal(Number(rows[0]?.active_alias_count), 0, fixture.legacyCommand);
    }
  });

  it("matches every fixed reward row and metadata value", async () => {
    for (const fixture of INDEPENDENT_PACKAGE_FIXTURES) {
      const rows = await database.query<Array<Record<string, unknown>>>(
        `SELECT rule.item_id,rule.quantity,rule.operation,rule.owner_scope,
                definition_row.item_type,definition_row.item_name,
                definition_row.metadata_json,rule.metadata_override_json
         FROM package_reward_rules rule
         JOIN package_item_definitions definition_row ON definition_row.item_id=rule.item_id
         WHERE rule.package_id=? AND rule.rule_mode='ALL' AND rule.enabled=1
         ORDER BY rule.reward_order`,
        [fixture.packageId],
      );
      assert.equal(rows.length, fixture.fixedRewards.length, fixture.legacyCommand);
      for (let index = 0; index < fixture.fixedRewards.length; index += 1) {
        const expected = fixture.fixedRewards[index]!;
        const actual = rows[index]!;
        assert.equal(String(actual.item_id), expected.itemId, fixture.legacyCommand);
        assert.equal(String(actual.item_name), expected.name, fixture.legacyCommand);
        assert.equal(String(actual.item_type), expected.itemType, fixture.legacyCommand);
        assert.equal(BigInt(String(actual.quantity)), expected.quantity, fixture.legacyCommand);
        assert.equal(String(actual.operation), expected.operation, fixture.legacyCommand);
        assert.equal(String(actual.owner_scope), expected.ownerScope ?? "USER", fixture.legacyCommand);
        const definition = jsonObject(actual.metadata_json);
        const override = jsonObject(actual.metadata_override_json);
        for (const [key, value] of Object.entries(expected.metadata ?? {})) {
          assert.deepEqual(override[key] ?? definition[key], value, `${fixture.legacyCommand}:${key}`);
        }
      }
    }
  });
});
