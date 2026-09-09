import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { createCurrentDomainPackageRuntime } from "../src/package/current-domain-package-runtime.js";

const configured = ["DATABASE_HOST", "DATABASE_PORT", "DATABASE_USER", "DATABASE_PASSWORD", "DATABASE_NAME"]
  .every((name) => Boolean(process.env[name]));
const required = (name: string): string => process.env[name] ?? "integration-test-not-configured";
const playerId = "900000013";
const committedRequest = "fixture-gift-point-package-committed";
const failedRequest = "fixture-gift-point-package-failed";
let database: DatabaseClient;

async function scalar(sql: string, values: readonly unknown[] = []): Promise<bigint> {
  const rows = await database.query<Array<{ value: string | bigint }>>(sql, values);
  return BigInt(rows[0]?.value ?? 0);
}

(configured ? describe : describe.skip)("gift point package MariaDB runtime", () => {
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
    await database.execute("UPDATE package_catalog SET definition_status='READY',enabled=1 WHERE package_id='PKG-GIFT-POINT-BOX'");
    await database.execute("UPDATE package_item_definitions SET enabled=1 WHERE item_id IN ('gift_point_box','point')");
    await database.execute("UPDATE item_definitions SET active=1 WHERE code IN ('gift_point_box','point')");
    await database.execute(
      "INSERT INTO inventory_stacks(player_id,item_id,quantity,version) SELECT ?,id,2,1 FROM item_definitions WHERE code='gift_point_box'",
      [playerId],
    );
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
    await database.execute("UPDATE package_catalog SET definition_status='EXACT_LEGACY_DRAFT',enabled=0 WHERE package_id='PKG-GIFT-POINT-BOX'");
    await database.execute("UPDATE package_item_definitions SET enabled=0 WHERE item_id='gift_point_box'");
    await database.execute("UPDATE package_item_definitions SET enabled=1 WHERE item_id='point'");
    await database.execute("UPDATE item_definitions SET active=0 WHERE code='gift_point_box'");
    await database.execute("UPDATE item_definitions SET active=1 WHERE code='point'");
    await database.close();
  });

  it("consumes two boxes and records the minimum and maximum point rolls atomically", async () => {
    const originalRandom = Math.random;
    const rolls = [0, 0.999999];
    Math.random = () => rolls.shift() ?? 0;
    try {
      const result = await createCurrentDomainPackageRuntime(database).packages.use({
        requestKey: committedRequest, userId: playerId, packageId: "PKG-GIFT-POINT-BOX", openCount: 2,
      });
      assert.deepEqual(result, { packageId: "PKG-GIFT-POINT-BOX", openCount: 2, rewardCount: 1 });
    } finally {
      Math.random = originalRandom;
    }
    assert.equal(await scalar(
      `SELECT quantity AS value FROM inventory_stacks JOIN item_definitions ON item_definitions.id=inventory_stacks.item_id
       WHERE player_id=? AND item_definitions.code='gift_point_box'`, [playerId]), 0n);
    assert.equal(await scalar("SELECT CAST(balance AS SIGNED) AS value FROM currency_accounts WHERE player_id=? AND currency_code='point'", [playerId]), 3_500_000n);
    assert.equal(await scalar("SELECT CAST(delta AS SIGNED) AS value FROM currency_ledger WHERE player_id=? AND currency_code='point'", [playerId]), 3_500_000n);
    assert.equal(await scalar("SELECT COUNT(*) AS value FROM package_item_effects WHERE player_id=?", [playerId]), 2n);
  });

  it("replays the committed request without another box or point mutation", async () => {
    const replay = await createCurrentDomainPackageRuntime(database).packages.use({
      requestKey: committedRequest, userId: playerId, packageId: "PKG-GIFT-POINT-BOX", openCount: 2,
    });
    assert.deepEqual(replay, { packageId: "PKG-GIFT-POINT-BOX", openCount: 2, rewardCount: 1 });
    assert.equal(await scalar("SELECT CAST(balance AS SIGNED) AS value FROM currency_accounts WHERE player_id=? AND currency_code='point'", [playerId]), 3_500_000n);
    assert.equal(await scalar("SELECT COUNT(*) AS value FROM currency_ledger WHERE player_id=? AND currency_code='point'", [playerId]), 1n);
  });

  it("rolls back before consuming a box when the point definition is disabled", async () => {
    await database.execute(
      "UPDATE inventory_stacks SET quantity=1,version=version+1 WHERE player_id=? AND item_id=(SELECT id FROM item_definitions WHERE code='gift_point_box')",
      [playerId],
    );
    await database.execute("UPDATE package_item_definitions SET enabled=0 WHERE item_id='point'");
    try {
      await assert.rejects(createCurrentDomainPackageRuntime(database).packages.use({
        requestKey: failedRequest, userId: playerId, packageId: "PKG-GIFT-POINT-BOX", openCount: 1,
      }), /ITEM_NOT_AVAILABLE|ITEM_DISABLED|PACKAGE_ITEM_DISABLED/);
    } finally {
      await database.execute("UPDATE package_item_definitions SET enabled=1 WHERE item_id='point'");
    }
    assert.equal(await scalar(
      `SELECT quantity AS value FROM inventory_stacks JOIN item_definitions ON item_definitions.id=inventory_stacks.item_id
       WHERE player_id=? AND item_definitions.code='gift_point_box'`, [playerId]), 1n);
    assert.equal(await scalar("SELECT CAST(balance AS SIGNED) AS value FROM currency_accounts WHERE player_id=? AND currency_code='point'", [playerId]), 3_500_000n);
    assert.equal(await scalar("SELECT COUNT(*) AS value FROM package_domain_uses WHERE request_key=?", [failedRequest]), 0n);
  });
});
