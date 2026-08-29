import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { createCurrentDomainPackageRuntime } from "../src/package/current-domain-package-runtime.js";

const configured = ["DATABASE_HOST", "DATABASE_PORT", "DATABASE_USER", "DATABASE_PASSWORD", "DATABASE_NAME"]
  .every((name) => Boolean(process.env[name]));

const required = (name: string): string => process.env[name] ?? "integration-test-not-configured";
const playerId = "900000001";
const committedRequest = "fixture-domain-package-committed";
const rollbackRequest = "fixture-domain-package-rollback";
let database: DatabaseClient;

async function scalar(sql: string, values: readonly unknown[] = []): Promise<bigint> {
  const rows = await database.query<Array<{ value: string | bigint }>>(sql, values);
  return BigInt(rows[0]?.value ?? 0);
}

(configured ? describe : describe.skip)("current domain MariaDB package runtime", () => {
  before(async () => {
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
    await database.execute("DELETE FROM package_item_effects WHERE player_id = ?", [playerId]);
    await database.execute("DELETE FROM inventory_ledger WHERE player_id = ?", [playerId]);
    await database.execute("DELETE FROM inventory_stacks WHERE player_id = ?", [playerId]);
    await database.execute("DELETE FROM package_domain_uses WHERE player_id = ?", [playerId]);
    await database.execute("DELETE FROM operations WHERE actor_type = 'player' AND actor_id = ?", [playerId]);
    await database.execute("DELETE FROM players WHERE id = ?", [playerId]);
    await database.execute(
      "INSERT INTO players(id,status,version,created_at,updated_at) VALUES (?, 'active', 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
      [playerId],
    );
    await database.execute(
      "UPDATE package_catalog SET definition_status='READY',enabled=1 WHERE package_id='PKG-209'",
    );
    await database.execute(
      `UPDATE package_item_definitions SET enabled=1
       WHERE item_id='ITEM-PACKAGE-209'
          OR item_id IN (SELECT item_id FROM package_reward_rules WHERE package_id='PKG-209' AND item_id IS NOT NULL)`,
    );
    await database.execute(
      `UPDATE item_definitions SET active=1
       WHERE code='ITEM-PACKAGE-209'
          OR code IN (SELECT item_id FROM package_reward_rules WHERE package_id='PKG-209' AND item_id IS NOT NULL)`,
    );
    await database.execute(
      `INSERT INTO inventory_stacks(player_id,item_id,quantity,version)
       SELECT ?,id,2,1 FROM item_definitions WHERE code='ITEM-PACKAGE-209'`,
      [playerId],
    );
  });

  after(async () => {
    await database.execute("DELETE FROM package_item_effects WHERE player_id = ?", [playerId]);
    await database.execute("DELETE FROM inventory_ledger WHERE player_id = ?", [playerId]);
    await database.execute("DELETE FROM inventory_stacks WHERE player_id = ?", [playerId]);
    await database.execute("DELETE FROM package_domain_uses WHERE player_id = ?", [playerId]);
    await database.execute("DELETE FROM operations WHERE actor_type = 'player' AND actor_id = ?", [playerId]);
    await database.execute("DELETE FROM players WHERE id = ?", [playerId]);
    await database.execute("UPDATE package_catalog SET definition_status='EXACT_LEGACY_DRAFT',enabled=0 WHERE package_id='PKG-209'");
    await database.execute(
      `UPDATE package_item_definitions SET enabled=0
       WHERE item_id='ITEM-PACKAGE-209'
          OR item_id IN (SELECT item_id FROM package_reward_rules WHERE package_id='PKG-209' AND item_id IS NOT NULL)`,
    );
    await database.execute(
      `UPDATE item_definitions SET active=0
       WHERE code='ITEM-PACKAGE-209'
          OR code IN (SELECT item_id FROM package_reward_rules WHERE package_id='PKG-209' AND item_id IS NOT NULL)`,
    );
    await database.close();
  });

  it("commits consumer and three stack rewards into current inventory tables", async () => {
    const runtime = createCurrentDomainPackageRuntime(database);
    const result = await runtime.packages.use({
      requestKey: committedRequest,
      userId: playerId,
      packageId: "PKG-209",
      openCount: 1,
    });
    assert.deepEqual(result, { packageId: "PKG-209", openCount: 1, rewardCount: 3 });
    assert.equal(await scalar(
      `SELECT quantity AS value FROM inventory_stacks
       JOIN item_definitions ON item_definitions.id=inventory_stacks.item_id
       WHERE player_id=? AND item_definitions.code='ITEM-PACKAGE-209'`, [playerId]), 1n);
    assert.equal(await scalar(
      `SELECT quantity AS value FROM inventory_stacks
       JOIN item_definitions ON item_definitions.id=inventory_stacks.item_id
       WHERE player_id=? AND item_definitions.code='ITEM-RWD-042'`, [playerId]), 120n);
    assert.equal(await scalar("SELECT COUNT(*) AS value FROM package_item_effects WHERE player_id=?", [playerId]), 4n);
  });

  it("replays a committed request without duplicate inventory mutation", async () => {
    const before = await scalar(
      `SELECT quantity AS value FROM inventory_stacks
       JOIN item_definitions ON item_definitions.id=inventory_stacks.item_id
       WHERE player_id=? AND item_definitions.code='ITEM-RWD-042'`, [playerId]);
    const replay = await createCurrentDomainPackageRuntime(database).packages.use({
      requestKey: committedRequest,
      userId: playerId,
      packageId: "PKG-209",
      openCount: 1,
    });
    assert.deepEqual(replay, { packageId: "PKG-209", openCount: 1, rewardCount: 3 });
    assert.equal(await scalar(
      `SELECT quantity AS value FROM inventory_stacks
       JOIN item_definitions ON item_definitions.id=inventory_stacks.item_id
       WHERE player_id=? AND item_definitions.code='ITEM-RWD-042'`, [playerId]), before);
  });

  it("rolls back consumer and earlier rewards after a later domain failure", async () => {
    await database.execute("UPDATE item_definitions SET active=0 WHERE code='ITEM-RWD-065'");
    const beforeConsumer = await scalar(
      `SELECT quantity AS value FROM inventory_stacks
       JOIN item_definitions ON item_definitions.id=inventory_stacks.item_id
       WHERE player_id=? AND item_definitions.code='ITEM-PACKAGE-209'`, [playerId]);
    const beforeReward = await scalar(
      `SELECT quantity AS value FROM inventory_stacks
       JOIN item_definitions ON item_definitions.id=inventory_stacks.item_id
       WHERE player_id=? AND item_definitions.code='ITEM-RWD-042'`, [playerId]);
    try {
      await assert.rejects(
        createCurrentDomainPackageRuntime(database).packages.use({
          requestKey: rollbackRequest,
          userId: playerId,
          packageId: "PKG-209",
          openCount: 1,
        }),
        /ITEM_NOT_AVAILABLE:ITEM-RWD-065/,
      );
    } finally {
      await database.execute("UPDATE item_definitions SET active=1 WHERE code='ITEM-RWD-065'");
    }
    assert.equal(await scalar(
      `SELECT quantity AS value FROM inventory_stacks
       JOIN item_definitions ON item_definitions.id=inventory_stacks.item_id
       WHERE player_id=? AND item_definitions.code='ITEM-PACKAGE-209'`, [playerId]), beforeConsumer);
    assert.equal(await scalar(
      `SELECT quantity AS value FROM inventory_stacks
       JOIN item_definitions ON item_definitions.id=inventory_stacks.item_id
       WHERE player_id=? AND item_definitions.code='ITEM-RWD-042'`, [playerId]), beforeReward);
    assert.equal(await scalar("SELECT COUNT(*) AS value FROM package_domain_uses WHERE request_key=?", [rollbackRequest]), 0n);
  });
});
