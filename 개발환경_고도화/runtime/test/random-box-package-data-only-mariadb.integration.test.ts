import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const configured = ["DATABASE_HOST", "DATABASE_PORT", "DATABASE_USER", "DATABASE_PASSWORD", "DATABASE_NAME"].every((name) => Boolean(process.env[name]));
const required = (name: string): string => process.env[name] ?? "integration-test-not-configured";
let database: DatabaseClient;

(configured ? describe : describe.skip)("random box catalog data-only MariaDB parity", () => {
  before(() => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 2, connectTimeoutMs: 5_000 });
  });
  after(async () => database.close());

  it("keeps PKG-214 disabled with six equal rules and no executable alias", async () => {
    const catalog = await database.query<Array<Record<string, unknown>>>("SELECT consume_item_id,max_open_count,block_castle,enabled FROM package_catalog WHERE package_id='PKG-214'");
    assert.deepEqual(catalog[0], { consume_item_id: "ITEM-PACKAGE-214", max_open_count: 10_000, block_castle: 1, enabled: 0 });
    const rules = await database.query<Array<Record<string, unknown>>>("SELECT item_id,quantity,weight,rule_mode,operation,owner_scope FROM package_reward_rules WHERE package_id='PKG-214' AND enabled=1 ORDER BY reward_order");
    assert.equal(rules.length, 6);
    assert.ok(rules.every((row) => BigInt(String(row.quantity)) === 1n && Number(row.weight) === 1));
    assert.ok(rules.every((row) => row.rule_mode === "WEIGHTED_ONE" && row.operation === "ADD" && row.owner_scope === "USER"));
    assert.deepEqual(rules.map((row) => row.item_id), ["ITEM-RWD-TRASH-BOX", "ITEM-RWD-RANDOM-SPIRIT-BOX", "ITEM-PACKAGE-CHICKEN-BOX", "ITEM-RWD-025", "ITEM-RWD-RANDOM-TERRITORY-DEFENSE-20", "ITEM-RWD-RANDOM-TERRITORY-ATTACK-10"]);
    const source = await database.query<Array<Record<string, unknown>>>("SELECT canonical_route,executable FROM package_catalog_source_commands WHERE package_id='PKG-214' AND source_command='/랜덤오픈'");
    assert.deepEqual(source[0], { canonical_route: "/패키지사용", executable: 0 });
    const aliases = await database.query<Array<Record<string, unknown>>>("SELECT (SELECT COUNT(*) FROM package_command_aliases WHERE package_id='PKG-214' OR command_text='/랜덤오픈') AS package_aliases,(SELECT COUNT(*) FROM command_aliases WHERE command_text='/랜덤오픈') AS command_aliases");
    assert.equal(Number(aliases[0]?.package_aliases), 0);
    assert.equal(Number(aliases[0]?.command_aliases), 0);
  });
});
