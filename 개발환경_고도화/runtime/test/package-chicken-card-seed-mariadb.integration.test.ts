import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const configured = ["DATABASE_HOST", "DATABASE_PORT", "DATABASE_USER", "DATABASE_PASSWORD", "DATABASE_NAME"]
  .every((name) => Boolean(process.env[name]));
const required = (name: string): string => process.env[name] ?? "integration-test-not-configured";
let database: DatabaseClient;

(configured ? describe : describe.skip)("chicken and castle-card package catalog seed", () => {
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

  it("stores two disabled catalog entries without direct command aliases", async () => {
    const rows = await database.query<Array<{
      package_id: string; consume_item_id: string; enabled: number; alias_count: bigint;
    }>>(
      `SELECT catalog.package_id,catalog.consume_item_id,catalog.enabled,
              COUNT(alias_row.command_text) AS alias_count
       FROM package_catalog catalog
       LEFT JOIN package_command_aliases alias_row
         ON alias_row.package_id=catalog.package_id
       WHERE catalog.package_id IN ('PKG-CHICKEN-BOX','PKG-CASTLE-CARD')
       GROUP BY catalog.package_id,catalog.consume_item_id,catalog.enabled
       ORDER BY catalog.package_id`,
    );
    assert.deepEqual(rows.map((row) => ({
      packageId: row.package_id,
      consumeItemId: row.consume_item_id,
      enabled: Number(row.enabled),
      aliases: Number(row.alias_count),
    })), [
      { packageId: "PKG-CASTLE-CARD", consumeItemId: "ITEM-RWD-024", enabled: 0, aliases: 0 },
      { packageId: "PKG-CHICKEN-BOX", consumeItemId: "ITEM-PACKAGE-CHICKEN-BOX", enabled: 0, aliases: 0 },
    ]);
  });

  it("preserves the chicken inclusive 5 through 10 reward range", async () => {
    const rows = await database.query<Array<Record<string, unknown>>>(
      `SELECT rule_mode,item_id,range_min,range_max,range_step
       FROM package_reward_rules WHERE package_id='PKG-CHICKEN-BOX'`,
    );
    assert.equal(rows.length, 1);
    assert.equal(String(rows[0]?.rule_mode), "UNIFORM_RANGE");
    assert.equal(String(rows[0]?.item_id), "ITEM-RWD-SEASONED-CHICKEN");
    assert.equal(BigInt(String(rows[0]?.range_min)), 5n);
    assert.equal(BigInt(String(rows[0]?.range_max)), 10n);
    assert.equal(BigInt(String(rows[0]?.range_step)), 1n);
  });

  it("preserves all nine castle-card weights, quantities and special notices", async () => {
    const rows = await database.query<Array<{
      item_id: string; quantity: bigint; weight: string; metadata_override_json: string;
    }>>(
      `SELECT item_id,quantity,weight,metadata_override_json
       FROM package_reward_rules
       WHERE package_id='PKG-CASTLE-CARD' AND enabled=1
       ORDER BY reward_order`,
    );
    assert.equal(rows.length, 9);
    assert.equal(rows.reduce((sum, row) => sum + Number(row.weight), 0), 1);
    assert.equal(rows[6]?.item_id, "ITEM-RWD-025");
    assert.equal(rows[6]?.quantity, 4n);
    const firstMetadata = typeof rows[0]?.metadata_override_json === "string"
      ? rows[0].metadata_override_json
      : JSON.stringify(rows[0]?.metadata_override_json ?? {});
    const secondMetadata = typeof rows[1]?.metadata_override_json === "string"
      ? rows[1].metadata_override_json
      : JSON.stringify(rows[1]?.metadata_override_json ?? {});
    assert.match(firstMetadata, /초대박/);
    assert.match(secondMetadata, /신화급/);
  });
});
