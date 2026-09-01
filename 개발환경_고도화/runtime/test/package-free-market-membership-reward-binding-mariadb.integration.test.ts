import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import mariadb from "mariadb";
import { describe, it } from "node:test";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { createCurrentDomainPackageRuntime } from "../src/package/current-domain-package-runtime.js";

const configured = process.env.PACKAGE_FREE_MARKET_MEMBERSHIP_MARIADB_TEST === "true"
  && ["DATABASE_HOST", "DATABASE_PORT", "DATABASE_USER", "DATABASE_PASSWORD", "DATABASE_NAME"].every((name) => Boolean(process.env[name]));
const required = (name: string): string => process.env[name] ?? "integration-test-not-configured";
const playerId = "900002417";
const migrationSql = readFileSync(fileURLToPath(new URL("../migrations/412_package_free_market_membership_reward_binding.sql", import.meta.url)), "utf8");
const rollbackSql = readFileSync(fileURLToPath(new URL("../../migration-control/rollback/412_package_free_market_membership_reward_binding.sql", import.meta.url)), "utf8");

const createClient = (): DatabaseClient => createDatabaseClient({
  enabled: true,
  host: required("DATABASE_HOST"),
  port: Number(required("DATABASE_PORT")),
  user: required("DATABASE_USER"),
  password: required("DATABASE_PASSWORD"),
  name: required("DATABASE_NAME"),
  connectionLimit: 2,
  connectTimeoutMs: 5_000,
});

async function scalar(database: DatabaseClient, sql: string, values: readonly unknown[] = []): Promise<bigint> {
  const rows = await database.query<Array<{ value: string | bigint }>>(sql, values);
  return BigInt(rows[0]?.value ?? 0);
}

async function quantity(database: DatabaseClient, code: string): Promise<bigint> {
  return scalar(database, `SELECT COALESCE(MAX(stack.quantity),0) value
    FROM inventory_stacks stack JOIN item_definitions definition_row ON definition_row.id=stack.item_id
    WHERE stack.player_id=? AND definition_row.code=?`, [playerId, code]);
}

async function cleanup(database: DatabaseClient): Promise<void> {
  await database.execute("DELETE FROM package_item_effects WHERE player_id=?", [playerId]);
  await database.execute("DELETE FROM inventory_ledger WHERE player_id=?", [playerId]);
  await database.execute("DELETE FROM inventory_stacks WHERE player_id=?", [playerId]);
  await database.execute("DELETE FROM package_domain_uses WHERE player_id=?", [playerId]);
  await database.execute("DELETE FROM operations WHERE actor_type='player' AND actor_id=?", [playerId]);
  await database.execute("DELETE FROM players WHERE id=?", [playerId]);
}

async function applySql(sql: string): Promise<void> {
  const connection = await mariadb.createConnection({
    host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"),
    password: required("DATABASE_PASSWORD"), database: required("DATABASE_NAME"), multipleStatements: true,
    bigIntAsNumber: false, charset: "utf8mb4", timezone: "Z",
  });
  try { await connection.query(sql); } finally { await connection.end(); }
}

(configured ? describe : describe.skip)("Lease2417 package_5 Maria provider parity", () => {
  it("proves normal, replay, repeat, rollback, reconnect, ownership write0 and migration rollback/reapply", async () => {
    let database = createClient();
    try {
      await cleanup(database);
      await database.execute("INSERT INTO players(id,status,version,created_at,updated_at) VALUES (?,'active',1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [playerId]);
      await database.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) SELECT ?,id,3,1 FROM item_definitions WHERE code='package_5'", [playerId]);

      const legacyBefore = {
        balances: await scalar(database, "SELECT COUNT(*) value FROM package_item_balances"),
        instances: await scalar(database, "SELECT COUNT(*) value FROM package_item_instances"),
        ledger: await scalar(database, "SELECT COUNT(*) value FROM package_item_ledger"),
      };
      const runtime = createCurrentDomainPackageRuntime(database);
      const request = { requestKey: "lease2417-normal", userId: playerId, packageId: "package_5", openCount: 1 };
      const normal = await runtime.packages.use(request);
      assert.deepEqual(normal, { packageId: "package_5", openCount: 1, rewardCount: 1 });
      assert.equal(await quantity(database, "package_5"), 2n);
      assert.equal(await quantity(database, "free_market_membership"), 1n);
      assert.equal(await scalar(database, "SELECT COUNT(*) value FROM inventory_ledger WHERE player_id=?", [playerId]), 2n);

      const replay = await runtime.packages.use(request);
      assert.deepEqual(replay, normal);
      assert.equal(await quantity(database, "package_5"), 2n);
      assert.equal(await quantity(database, "free_market_membership"), 1n);
      assert.equal(await scalar(database, "SELECT COUNT(*) value FROM inventory_ledger WHERE player_id=?", [playerId]), 2n);

      const repeat = await runtime.packages.use({ ...request, requestKey: "lease2417-repeat" });
      assert.deepEqual(repeat, normal);
      assert.equal(await quantity(database, "package_5"), 1n);
      assert.equal(await quantity(database, "free_market_membership"), 2n);
      assert.equal(await scalar(database, "SELECT COUNT(*) value FROM inventory_ledger WHERE player_id=?", [playerId]), 4n);

      await database.execute("UPDATE package_item_definitions SET enabled=0 WHERE item_id='free_market_membership'");
      try {
        await assert.rejects(createCurrentDomainPackageRuntime(database).packages.use({ ...request, requestKey: "lease2417-rollback" }), /ITEM_NOT_AVAILABLE|ITEM_DISABLED|PACKAGE_ITEM_DISABLED/);
      } finally {
        await database.execute("UPDATE package_item_definitions SET enabled=1 WHERE item_id='free_market_membership'");
      }
      assert.equal(await quantity(database, "package_5"), 1n);
      assert.equal(await quantity(database, "free_market_membership"), 2n);
      assert.equal(await scalar(database, "SELECT COUNT(*) value FROM package_domain_uses WHERE request_key='lease2417-rollback'"), 0n);

      await database.close();
      database = createClient();
      await database.ping();
      const reconnectReplay = await createCurrentDomainPackageRuntime(database).packages.use({ ...request, requestKey: "lease2417-repeat" });
      assert.deepEqual(reconnectReplay, normal);
      assert.equal(await quantity(database, "package_5"), 1n);
      assert.equal(await quantity(database, "free_market_membership"), 2n);
      assert.deepEqual({
        balances: await scalar(database, "SELECT COUNT(*) value FROM package_item_balances"),
        instances: await scalar(database, "SELECT COUNT(*) value FROM package_item_instances"),
        ledger: await scalar(database, "SELECT COUNT(*) value FROM package_item_ledger"),
      }, legacyBefore);

      await cleanup(database);
      await database.close();
      await applySql(rollbackSql);
      database = createClient();
      assert.equal(await scalar(database, "SELECT COUNT(*) value FROM package_catalog WHERE package_id='package_5'"), 0n);
      assert.equal(await scalar(database, "SELECT COUNT(*) value FROM package_reward_rules WHERE rule_id='RULE-PACKAGE-5-FREE-MARKET-MEMBERSHIP-001'"), 0n);
      assert.equal(await scalar(database, "SELECT COUNT(*) value FROM item_definitions WHERE code='free_market_membership' AND active=1"), 1n);
      await database.close();
      await applySql(migrationSql);
      database = createClient();
      const restored = await database.query<Array<{ packageId: string; reward: string; quantity: string; enabled: number }>>(
        `SELECT catalog.package_id packageId,rule.item_id reward,CAST(rule.quantity AS CHAR) quantity,catalog.enabled
         FROM package_catalog catalog JOIN package_reward_rules rule ON rule.package_id=catalog.package_id
         WHERE catalog.package_id='package_5' AND rule.rule_id='RULE-PACKAGE-5-FREE-MARKET-MEMBERSHIP-001'`,
      );
      assert.deepEqual(restored, [{ packageId: "package_5", reward: "free_market_membership", quantity: "1", enabled: 1 }]);
    } finally {
      try { await cleanup(database); } catch { /* best-effort isolated fixture cleanup */ }
      try { await database.close(); } catch { /* already closed for reconnect/rollback */ }
      try { await applySql(migrationSql); } catch { /* leave the isolated migrated database recoverable */ }
    }
  });
});
