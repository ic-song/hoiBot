import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { createCurrentDomainPackageRuntime } from "../src/package/current-domain-package-runtime.js";

const configured = ["DATABASE_HOST", "DATABASE_PORT", "DATABASE_USER", "DATABASE_PASSWORD", "DATABASE_NAME"]
  .every((name) => Boolean(process.env[name]));
const required = (name: string): string => process.env[name] ?? "integration-test-not-configured";
const playerId = "900000093";
const committedRequest = "fixture-lucky-reward-package-committed";
const rollbackRequest = "fixture-lucky-reward-package-rollback";
const rewardCodes = ["weekly_box", "mini_pet_draw", "pet_enhance_stone", "ITEM-RWD-022", "point"];
let database: DatabaseClient;

async function scalar(sql: string, values: readonly unknown[] = []): Promise<bigint> {
  const rows = await database.query<Array<{ value: string | bigint }>>(sql, values);
  return BigInt(rows[0]?.value ?? 0);
}

(configured ? describe : describe.skip)("lucky reward package seed", () => {
  before(async () => {
    database = createDatabaseClient({
      enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")),
      user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"),
      connectionLimit: 2, connectTimeoutMs: 5_000,
    });
    await database.execute("DELETE FROM package_item_effects WHERE player_id=?", [playerId]);
    await database.execute("DELETE FROM inventory_ledger WHERE player_id=?", [playerId]);
    await database.execute("DELETE FROM currency_ledger WHERE player_id=?", [playerId]);
    await database.execute("DELETE FROM inventory_stacks WHERE player_id=?", [playerId]);
    await database.execute("DELETE FROM currency_accounts WHERE player_id=?", [playerId]);
    await database.execute("DELETE FROM package_domain_uses WHERE player_id=?", [playerId]);
    await database.execute("DELETE FROM operations WHERE actor_type='player' AND actor_id=?", [playerId]);
    await database.execute("DELETE FROM players WHERE id=?", [playerId]);
    await database.execute("INSERT INTO players(id,status,version,created_at,updated_at) VALUES (?,'active',1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [playerId]);
  });

  after(async () => {
    await database.execute("DELETE FROM package_item_effects WHERE player_id=?", [playerId]);
    await database.execute("DELETE FROM inventory_ledger WHERE player_id=?", [playerId]);
    await database.execute("DELETE FROM currency_ledger WHERE player_id=?", [playerId]);
    await database.execute("DELETE FROM inventory_stacks WHERE player_id=?", [playerId]);
    await database.execute("DELETE FROM currency_accounts WHERE player_id=?", [playerId]);
    await database.execute("DELETE FROM package_domain_uses WHERE player_id=?", [playerId]);
    await database.execute("DELETE FROM operations WHERE actor_type='player' AND actor_id=?", [playerId]);
    await database.execute("DELETE FROM players WHERE id=?", [playerId]);
    await database.execute("UPDATE package_catalog SET definition_status='EXACT_LEGACY_DRAFT',enabled=0 WHERE package_id='PKG-LUCKY-REWARD-BOX'");
    await database.close();
  });

  it("stores one disabled six-step weighted catalog without executable aliases", async () => {
    const catalog = await database.query<Array<{ source: string; consumer: string; enabled: number; aliases: string }>>(
      `SELECT source_legacy_command source,consume_item_id consumer,enabled,
              CAST((SELECT COUNT(*) FROM package_command_aliases WHERE package_id=package_catalog.package_id) AS CHAR) aliases
       FROM package_catalog WHERE package_id='PKG-LUCKY-REWARD-BOX'`,
    );
    assert.deepEqual(catalog, [{ source: "/럭키오픈", consumer: "reward_lucky_box", enabled: 0, aliases: "0" }]);
    const rules = await database.query<Array<{ itemId: string; quantity: string; weight: string }>>(
      `SELECT item_id itemId,CAST(quantity AS CHAR) quantity,CAST(weight AS CHAR) weight
       FROM package_reward_rules WHERE package_id='PKG-LUCKY-REWARD-BOX' ORDER BY reward_order`,
    );
    assert.deepEqual(rules.map((row) => [row.itemId, Number(row.quantity), Number(row.weight)]), [
      ["weekly_box", 1, 0.0001], ["mini_pet_draw", 3, 0.005],
      ["pet_enhance_stone", 20, 0.01], ["ITEM-RWD-022", 4, 0.03],
      ["point", 25000000, 0.1], ["point", 15000000, 0.8549],
    ]);
    assert.equal(rules.reduce((sum, row) => sum + Number(row.weight), 0), 1);
    assert.equal(await scalar(
      `SELECT COUNT(*) value FROM (
         SELECT command_text FROM command_aliases WHERE command_text='/럭키오픈'
         UNION ALL SELECT command_text FROM package_command_aliases WHERE command_text='/럭키오픈'
         UNION ALL SELECT command_code FROM command_registry WHERE command_code='INVENTORY_LUCKY_REWARD_OPEN'
       ) direct_commands`,
    ), 0n);
  });

  it("uses the shared provider for atomic weighted grants and replay", async () => {
    await database.execute("UPDATE package_catalog SET definition_status='READY',enabled=1 WHERE package_id='PKG-LUCKY-REWARD-BOX'");
    await database.execute(
      `INSERT INTO inventory_stacks(player_id,item_id,quantity,version)
       SELECT ?,id,3,1 FROM item_definitions WHERE code='reward_lucky_box'`, [playerId],
    );
    const runtime = createCurrentDomainPackageRuntime(database);
    const result = await runtime.packages.use({ requestKey: committedRequest, userId: playerId, packageId: "PKG-LUCKY-REWARD-BOX", openCount: 2 });
    assert.equal(result.packageId, "PKG-LUCKY-REWARD-BOX");
    assert.equal(result.openCount, 2);
    assert.ok(result.rewardCount >= 1 && result.rewardCount <= 2);
    assert.equal(await scalar(
      `SELECT quantity value FROM inventory_stacks JOIN item_definitions ON item_definitions.id=inventory_stacks.item_id
       WHERE player_id=? AND item_definitions.code='reward_lucky_box'`, [playerId]), 1n);
    const replay = await runtime.packages.use({ requestKey: committedRequest, userId: playerId, packageId: "PKG-LUCKY-REWARD-BOX", openCount: 2 });
    assert.deepEqual(replay, result);
    assert.equal(await scalar("SELECT COUNT(*) value FROM package_domain_uses WHERE request_key=?", [committedRequest]), 1n);
  });

  it("rolls consumer back when every weighted reward definition is disabled", async () => {
    await database.execute("UPDATE package_reward_rules SET enabled=0 WHERE package_id='PKG-LUCKY-REWARD-BOX' AND item_id='point'");
    await database.execute(`UPDATE item_definitions SET active=0 WHERE code IN (${rewardCodes.map(() => "?").join(",")})`, rewardCodes);
    try {
      await assert.rejects(
        createCurrentDomainPackageRuntime(database).packages.use({ requestKey: rollbackRequest, userId: playerId, packageId: "PKG-LUCKY-REWARD-BOX", openCount: 1 }),
        /PACKAGE_DOMAIN_DEFINITION_NOT_FOUND/,
      );
    } finally {
      await database.execute(`UPDATE item_definitions SET active=1 WHERE code IN (${rewardCodes.map(() => "?").join(",")})`, rewardCodes);
      await database.execute("UPDATE package_reward_rules SET enabled=1 WHERE package_id='PKG-LUCKY-REWARD-BOX' AND item_id='point'");
    }
    assert.equal(await scalar(
      `SELECT quantity value FROM inventory_stacks JOIN item_definitions ON item_definitions.id=inventory_stacks.item_id
       WHERE player_id=? AND item_definitions.code='reward_lucky_box'`, [playerId]), 1n);
    assert.equal(await scalar("SELECT COUNT(*) value FROM package_domain_uses WHERE request_key=?", [rollbackRequest]), 0n);
  });
});
