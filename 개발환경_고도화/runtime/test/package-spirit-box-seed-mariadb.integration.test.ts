import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { createCurrentDomainPackageRuntime } from "../src/package/current-domain-package-runtime.js";

const configured = ["DATABASE_HOST", "DATABASE_PORT", "DATABASE_USER", "DATABASE_PASSWORD", "DATABASE_NAME"]
  .every((name) => Boolean(process.env[name]));
const required = (name: string): string => process.env[name] ?? "integration-test-not-configured";
const playerId = "900000094";
const committedRequest = "fixture-spirit-box-package-committed";
const rollbackRequest = "fixture-spirit-box-package-rollback";
let database: DatabaseClient;

async function scalar(sql: string, values: readonly unknown[] = []): Promise<bigint> {
  const rows = await database.query<Array<{ value: string | bigint }>>(sql, values);
  return BigInt(rows[0]?.value ?? 0);
}

(configured ? describe : describe.skip)("spirit box package seed", () => {
  before(async () => {
    database = createDatabaseClient({
      enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")),
      user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"),
      connectionLimit: 2, connectTimeoutMs: 5_000,
    });
    await database.execute("DELETE FROM package_item_effects WHERE player_id=?", [playerId]);
    await database.execute("DELETE FROM inventory_ledger WHERE player_id=?", [playerId]);
    await database.execute("DELETE FROM inventory_stacks WHERE player_id=?", [playerId]);
    await database.execute("DELETE FROM package_domain_uses WHERE player_id=?", [playerId]);
    await database.execute("DELETE FROM operations WHERE actor_type='player' AND actor_id=?", [playerId]);
    await database.execute("DELETE FROM players WHERE id=?", [playerId]);
    await database.execute("INSERT INTO players(id,status,version,created_at,updated_at) VALUES (?,'active',1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [playerId]);
  });

  after(async () => {
    await database.execute("DELETE FROM package_item_effects WHERE player_id=?", [playerId]);
    await database.execute("DELETE FROM inventory_ledger WHERE player_id=?", [playerId]);
    await database.execute("DELETE FROM inventory_stacks WHERE player_id=?", [playerId]);
    await database.execute("DELETE FROM package_domain_uses WHERE player_id=?", [playerId]);
    await database.execute("DELETE FROM operations WHERE actor_type='player' AND actor_id=?", [playerId]);
    await database.execute("DELETE FROM players WHERE id=?", [playerId]);
    await database.execute("UPDATE package_catalog SET definition_status='EXACT_LEGACY_DRAFT',enabled=0 WHERE package_id='PKG-SPIRIT-BOX'");
    await database.close();
  });

  it("stores a disabled uniform 5 to 10 catalog without executable aliases", async () => {
    const rows = await database.query<Array<{
      source: string; consumer: string; reward: string; mode: string;
      rangeMin: string; rangeMax: string; rangeStep: string; aliases: string;
    }>>(
      `SELECT catalog.source_legacy_command source,catalog.consume_item_id consumer,
              rule.item_id reward,rule.rule_mode mode,CAST(rule.range_min AS CHAR) rangeMin,
              CAST(rule.range_max AS CHAR) rangeMax,CAST(rule.range_step AS CHAR) rangeStep,
              CAST((SELECT COUNT(*) FROM package_command_aliases WHERE package_id=catalog.package_id) AS CHAR) aliases
       FROM package_catalog catalog JOIN package_reward_rules rule ON rule.package_id=catalog.package_id
       WHERE catalog.package_id='PKG-SPIRIT-BOX' AND catalog.enabled=0`,
    );
    assert.deepEqual(rows, [{
      source: "/정령오픈", consumer: "spirit_box", reward: "spirit_fragment",
      mode: "UNIFORM_RANGE", rangeMin: "5", rangeMax: "10", rangeStep: "1", aliases: "0",
    }]);
    assert.equal(await scalar(
      `SELECT COUNT(*) value FROM (
         SELECT command_text FROM command_aliases WHERE command_text='/정령오픈'
         UNION ALL SELECT command_text FROM package_command_aliases WHERE command_text='/정령오픈'
         UNION ALL SELECT command_code FROM command_registry
           WHERE command_code IN ('INVENTORY_FIXED_RANGE_BOX_OPEN','INVENTORY_SPIRIT_BOX_OPEN')
       ) direct_commands`,
    ), 0n);
  });

  it("connects the random-box producer to the stable spirit_box key", async () => {
    const rows = await database.query<Array<{ itemId: string; oldEnabled: number; oldActive: number }>>(
      `SELECT rule.item_id itemId,legacy_item.enabled oldEnabled,legacy_definition.active oldActive
       FROM package_reward_rules rule
       JOIN package_item_definitions legacy_item ON legacy_item.item_id='ITEM-RWD-RANDOM-SPIRIT-BOX'
       JOIN item_definitions legacy_definition ON legacy_definition.code='ITEM-RWD-RANDOM-SPIRIT-BOX'
       WHERE rule.rule_id='RULE-PKG-214-002'`,
    );
    assert.deepEqual(rows, [{ itemId: "spirit_box", oldEnabled: 0, oldActive: 0 }]);
  });

  it("uses the shared provider for range grants and replay", async () => {
    await database.execute("UPDATE package_catalog SET definition_status='READY',enabled=1 WHERE package_id='PKG-SPIRIT-BOX'");
    await database.execute(
      `INSERT INTO inventory_stacks(player_id,item_id,quantity,version)
       SELECT ?,id,3,1 FROM item_definitions WHERE code='spirit_box'`, [playerId],
    );
    const runtime = createCurrentDomainPackageRuntime(database);
    const result = await runtime.packages.use({
      requestKey: committedRequest, userId: playerId, packageId: "PKG-SPIRIT-BOX", openCount: 2,
    });
    assert.equal(result.packageId, "PKG-SPIRIT-BOX");
    assert.equal(result.openCount, 2);
    assert.equal(await scalar(
      `SELECT quantity value FROM inventory_stacks JOIN item_definitions ON item_definitions.id=inventory_stacks.item_id
       WHERE player_id=? AND item_definitions.code='spirit_box'`, [playerId]), 1n);
    const rewardQuantity = await scalar(
      `SELECT quantity value FROM inventory_stacks JOIN item_definitions ON item_definitions.id=inventory_stacks.item_id
       WHERE player_id=? AND item_definitions.code='spirit_fragment'`, [playerId]);
    assert.ok(rewardQuantity >= 10n && rewardQuantity <= 20n);
    const replay = await runtime.packages.use({
      requestKey: committedRequest, userId: playerId, packageId: "PKG-SPIRIT-BOX", openCount: 2,
    });
    assert.deepEqual(replay, result);
    assert.equal(await scalar("SELECT COUNT(*) value FROM package_domain_uses WHERE request_key=?", [committedRequest]), 1n);
  });

  it("rolls consumer back when the reward definition is disabled", async () => {
    await database.execute("UPDATE item_definitions SET active=0 WHERE code='spirit_fragment'");
    try {
      await assert.rejects(
        createCurrentDomainPackageRuntime(database).packages.use({
          requestKey: rollbackRequest, userId: playerId, packageId: "PKG-SPIRIT-BOX", openCount: 1,
        }),
        /PACKAGE_DOMAIN_DEFINITION_NOT_FOUND/,
      );
    } finally {
      await database.execute("UPDATE item_definitions SET active=1 WHERE code='spirit_fragment'");
    }
    assert.equal(await scalar(
      `SELECT quantity value FROM inventory_stacks JOIN item_definitions ON item_definitions.id=inventory_stacks.item_id
       WHERE player_id=? AND item_definitions.code='spirit_box'`, [playerId]), 1n);
    assert.equal(await scalar("SELECT COUNT(*) value FROM package_domain_uses WHERE request_key=?", [rollbackRequest]), 0n);
  });
});
