import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("dopamine package 2 data-only MariaDB parity", { skip: !enabled }, () => {
  let database: DatabaseClient;

  before(() => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")),
      user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"),
      connectionLimit: 3, connectTimeoutMs: 5_000 });
  });

  after(async () => {
    if (database) await database.close();
  });

  it("keeps PKG-098 disabled with exact rewards and no executable legacy alias", async () => {
    const catalog = (await database.query<Array<{
      package_id: string; consume_item_id: string; definition_status: string; enabled: number; metadata_json: string;
    }>>(
      `SELECT catalog.package_id,catalog.consume_item_id,catalog.definition_status,catalog.enabled,
              CAST(item.metadata_json AS CHAR) AS metadata_json
       FROM package_catalog catalog
       JOIN package_item_definitions item ON item.item_id=catalog.consume_item_id
       WHERE catalog.package_id='PKG-098'`
    ))[0]!;
    assert.equal(catalog.consume_item_id, "ITEM-PACKAGE-098");
    assert.equal(catalog.definition_status, "EXACT_LEGACY_DRAFT");
    assert.equal(catalog.enabled, 0);
    assert.deepEqual(Object.fromEntries(Object.entries(JSON.parse(catalog.metadata_json)).filter(([key]) =>
      ["sourceGrantCommand", "grantRoute", "useRoute", "migrationPolicy"].includes(key))), {
      sourceGrantCommand: "/도파민민", grantRoute: "/패키지지급", useRoute: "/패키지사용", migrationPolicy: "CATALOG_SEED_ONLY"
    });

    const rewards = await database.query<Array<{ reward_order: number; item_id: string; quantity: string }>>(
      "SELECT reward_order,item_id,CAST(quantity AS CHAR) AS quantity FROM package_rewards WHERE package_id='PKG-098' ORDER BY reward_order"
    );
    assert.deepEqual(rewards.map((reward) => [reward.item_id, reward.quantity]), [
      ["ITEM-PACKAGE-105", "4000"], ["ITEM-RWD-001", "7000"], ["ITEM-RWD-014", "200"],
      ["ITEM-RWD-015", "1"], ["ITEM-RWD-016", "50"]
    ]);

    const sources = await database.query<Array<{ source_command: string; canonical_route: string; executable: number }>>(
      "SELECT source_command,canonical_route,executable FROM package_catalog_source_commands WHERE package_id='PKG-098' ORDER BY source_command"
    );
    assert.deepEqual(sources.map((source) => [source.source_command, source.canonical_route, source.executable]), [
      ["/도파민민", "/패키지지급", 0], ["/도파민오픈2", "/패키지사용", 0]
    ]);
    const aliases = await database.query<Array<{ alias_count: bigint }>>(
      `SELECT
        (SELECT COUNT(*) FROM package_command_aliases WHERE package_id='PKG-098' OR command_text IN ('/도파민오픈2','/도파민민'))
        + (SELECT COUNT(*) FROM command_aliases WHERE command_text IN ('/도파민오픈2','/도파민민')) AS alias_count`
    );
    assert.equal(Number(aliases[0]!.alias_count), 0);
  });
});
