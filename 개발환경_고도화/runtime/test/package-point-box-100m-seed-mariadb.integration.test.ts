import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { createCurrentDomainPackageRuntime } from "../src/package/current-domain-package-runtime.js";

const configured = ["DATABASE_HOST", "DATABASE_PORT", "DATABASE_USER", "DATABASE_PASSWORD", "DATABASE_NAME"]
  .every((name) => Boolean(process.env[name]));
const required = (name: string): string => process.env[name] ?? "integration-test-not-configured";
const playerId = "900000092";
const committedRequest = "fixture-point-box-100m-committed";
const failedRequest = "fixture-point-box-100m-failed";
let database: DatabaseClient;

async function scalar(sql: string, values: readonly unknown[] = []): Promise<bigint> {
  const rows = await database.query<Array<{ value: string | bigint }>>(sql, values);
  return BigInt(rows[0]?.value ?? 0);
}

(configured ? describe : describe.skip)("100m point box package seed", () => {
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
    await database.execute("UPDATE package_catalog SET definition_status='EXACT_LEGACY_DRAFT',enabled=0 WHERE package_id='PKG-POINT-BOX-100M'");
    await database.close();
  });

  it("stores one disabled fixed POINT catalog without executable aliases", async () => {
    const rows = await database.query<Array<{ source: string; consumer: string; reward: string; quantity: string; aliases: string }>>(
      `SELECT catalog.source_legacy_command source,catalog.consume_item_id consumer,rule.item_id reward,
              CAST(rule.quantity AS CHAR) quantity,
              CAST((SELECT COUNT(*) FROM package_command_aliases WHERE package_id=catalog.package_id) AS CHAR) aliases
       FROM package_catalog catalog JOIN package_reward_rules rule ON rule.package_id=catalog.package_id
       WHERE catalog.package_id='PKG-POINT-BOX-100M' AND catalog.enabled=0`,
    );
    assert.deepEqual(rows, [{ source: "/포인트상자오픈", consumer: "point_box_100m", reward: "point", quantity: "100000000", aliases: "0" }]);
    assert.equal(await scalar(
      `SELECT COUNT(*) value FROM (
         SELECT command_text FROM command_aliases WHERE command_text='/포인트상자오픈'
         UNION ALL SELECT command_code FROM command_registry WHERE command_code='INVENTORY_POINT_BOX_OPEN'
       ) direct_commands`,
    ), 0n);
  });

  it("uses the shared provider for two boxes, 200m points and replay", async () => {
    await database.execute("UPDATE package_catalog SET definition_status='READY',enabled=1 WHERE package_id='PKG-POINT-BOX-100M'");
    await database.execute(
      "INSERT INTO inventory_stacks(player_id,item_id,quantity,version) SELECT ?,id,3,1 FROM item_definitions WHERE code='point_box_100m'", [playerId],
    );
    const runtime = createCurrentDomainPackageRuntime(database);
    const result = await runtime.packages.use({ requestKey: committedRequest, userId: playerId, packageId: "PKG-POINT-BOX-100M", openCount: 2 });
    assert.deepEqual(result, { packageId: "PKG-POINT-BOX-100M", openCount: 2, rewardCount: 1 });
    assert.equal(await scalar(
      `SELECT quantity value FROM inventory_stacks JOIN item_definitions ON item_definitions.id=inventory_stacks.item_id
       WHERE player_id=? AND item_definitions.code='point_box_100m'`, [playerId]), 1n);
    assert.equal(await scalar("SELECT CAST(balance AS SIGNED) value FROM currency_accounts WHERE player_id=? AND currency_code='point'", [playerId]), 200000000n);
    const replay = await runtime.packages.use({ requestKey: committedRequest, userId: playerId, packageId: "PKG-POINT-BOX-100M", openCount: 2 });
    assert.deepEqual(replay, result);
    assert.equal(await scalar("SELECT COUNT(*) value FROM currency_ledger WHERE player_id=? AND currency_code='point'", [playerId]), 1n);
  });

  it("rolls the box back when the point definition is disabled", async () => {
    await database.execute("UPDATE package_item_definitions SET enabled=0 WHERE item_id='point'");
    try {
      await assert.rejects(createCurrentDomainPackageRuntime(database).packages.use({
        requestKey: failedRequest, userId: playerId, packageId: "PKG-POINT-BOX-100M", openCount: 1,
      }), /ITEM_NOT_AVAILABLE|ITEM_DISABLED|PACKAGE_ITEM_DISABLED/);
    } finally {
      await database.execute("UPDATE package_item_definitions SET enabled=1 WHERE item_id='point'");
    }
    assert.equal(await scalar(
      `SELECT quantity value FROM inventory_stacks JOIN item_definitions ON item_definitions.id=inventory_stacks.item_id
       WHERE player_id=? AND item_definitions.code='point_box_100m'`, [playerId]), 1n);
    assert.equal(await scalar("SELECT CAST(balance AS SIGNED) value FROM currency_accounts WHERE player_id=? AND currency_code='point'", [playerId]), 200000000n);
    assert.equal(await scalar("SELECT COUNT(*) value FROM package_domain_uses WHERE request_key=?", [failedRequest]), 0n);
  });
});
