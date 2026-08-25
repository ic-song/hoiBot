import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const configured = ["DATABASE_HOST", "DATABASE_PORT", "DATABASE_USER", "DATABASE_PASSWORD", "DATABASE_NAME"].every((name) => Boolean(process.env[name]));
const required = (name: string): string => process.env[name] ?? "integration-test-not-configured";
let database: DatabaseClient;

(configured ? describe : describe.skip)("pet food box catalog data-only MariaDB parity", () => {
  before(() => { database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 2, connectTimeoutMs: 5_000 }); });
  after(async () => database.close());

  it("keeps PKG-215 disabled with exact weighted rewards and no conflicting alias", async () => {
    const catalog = await database.query<Array<Record<string, unknown>>>("SELECT consume_item_id,max_open_count,block_castle,enabled FROM package_catalog WHERE package_id='PKG-215'");
    assert.deepEqual(catalog[0], { consume_item_id: "ITEM-RWD-PET-FOOD-BOX", max_open_count: 10_000, block_castle: 0, enabled: 0 });
    const rules = await database.query<Array<Record<string, unknown>>>("SELECT item_id,quantity,weight,rule_mode FROM package_reward_rules WHERE package_id='PKG-215' AND enabled=1 ORDER BY reward_order");
    assert.equal(rules.length, 4);
    assert.deepEqual(rules.map((row) => BigInt(String(row.quantity))), [50n, 100n, 250n, 500n]);
    assert.deepEqual(rules.map((row) => Number(row.weight)), [9815, 150, 30, 5]);
    assert.ok(rules.every((row) => row.item_id === "ITEM-RWD-025" && row.rule_mode === "WEIGHTED_ONE"));
    const source = await database.query<Array<Record<string, unknown>>>("SELECT canonical_route,executable,metadata_json FROM package_catalog_source_commands WHERE package_id='PKG-215' AND source_command='/상자오픈'");
    assert.equal(source[0]?.canonical_route, "/패키지사용");
    assert.equal(source[0]?.executable, 0);
    assert.match(JSON.stringify(source[0]?.metadata_json), /캐슬오픈/);
    const aliases = await database.query<Array<Record<string, unknown>>>("SELECT (SELECT COUNT(*) FROM package_command_aliases WHERE package_id='PKG-215' OR command_text IN ('/상자오픈','/캐슬오픈')) AS package_aliases,(SELECT COUNT(*) FROM command_aliases WHERE command_text='/상자오픈') AS command_aliases");
    assert.equal(Number(aliases[0]?.package_aliases), 0);
    assert.equal(Number(aliases[0]?.command_aliases), 0);
  });
});
