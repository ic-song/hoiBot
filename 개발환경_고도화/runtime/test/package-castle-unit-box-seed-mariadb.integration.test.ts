import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { createCurrentDomainPackageRuntime } from "../src/package/current-domain-package-runtime.js";

const configured = ["DATABASE_HOST", "DATABASE_PORT", "DATABASE_USER", "DATABASE_PASSWORD", "DATABASE_NAME"]
  .every((name) => Boolean(process.env[name]));
const required = (name: string): string => process.env[name] ?? "integration-test-not-configured";
const playerId = "900000091";
const committedRequest = "fixture-castle-unit-package-committed";
const rollbackRequest = "fixture-castle-unit-package-rollback";
const rewardCodes = [
  "ITEM-RWD-CASTLE-MYTH", "ITEM-RWD-CASTLE-LEGEND", "ITEM-RWD-CASTLE-UNIQUE",
  "ITEM-RWD-CASTLE-RARE", "ITEM-RWD-CASTLE-ADVANCED",
];
let database: DatabaseClient;

async function scalar(sql: string, values: readonly unknown[] = []): Promise<bigint> {
  const rows = await database.query<Array<{ value: string | bigint }>>(sql, values);
  return BigInt(rows[0]?.value ?? 0);
}

(configured ? describe : describe.skip)("castle unit package seed", () => {
  before(async () => {
    database = createDatabaseClient({
      enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")),
      user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"),
      name: required("DATABASE_NAME"), connectionLimit: 2, connectTimeoutMs: 5_000,
    });
    await database.execute("DELETE FROM package_item_effects WHERE player_id=?", [playerId]);
    await database.execute("DELETE FROM inventory_ledger WHERE player_id=?", [playerId]);
    await database.execute("DELETE FROM inventory_stacks WHERE player_id=?", [playerId]);
    await database.execute("DELETE FROM package_domain_uses WHERE player_id=?", [playerId]);
    await database.execute("DELETE FROM operations WHERE actor_type='player' AND actor_id=?", [playerId]);
    await database.execute("DELETE FROM players WHERE id=?", [playerId]);
    await database.execute("INSERT INTO players(id,status,version,created_at,updated_at) VALUES (?, 'active', 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))", [playerId]);
  });

  after(async () => {
    await database.execute("DELETE FROM package_item_effects WHERE player_id=?", [playerId]);
    await database.execute("DELETE FROM inventory_ledger WHERE player_id=?", [playerId]);
    await database.execute("DELETE FROM inventory_stacks WHERE player_id=?", [playerId]);
    await database.execute("DELETE FROM package_domain_uses WHERE player_id=?", [playerId]);
    await database.execute("DELETE FROM operations WHERE actor_type='player' AND actor_id=?", [playerId]);
    await database.execute("DELETE FROM players WHERE id=?", [playerId]);
    await database.execute("UPDATE package_catalog SET definition_status='EXACT_LEGACY_DRAFT',enabled=0 WHERE package_id='PKG-CASTLE-UNIT-BOX'");
    await database.close();
  });

  it("stores only a disabled catalog source with five legacy weights", async () => {
    const catalog = await database.query<Array<{ source: string; enabled: number; blockCastle: number; aliases: string }>>(
      `SELECT source_legacy_command source,enabled,block_castle blockCastle,
              CAST((SELECT COUNT(*) FROM package_command_aliases WHERE package_id=package_catalog.package_id) AS CHAR) aliases
       FROM package_catalog WHERE package_id='PKG-CASTLE-UNIT-BOX'`,
    );
    assert.deepEqual(catalog, [{ source: "/캐슬오픈", enabled: 0, blockCastle: 1, aliases: "0" }]);
    const rules = await database.query<Array<{ itemId: string; weight: string }>>(
      `SELECT item_id itemId,CAST(weight AS CHAR) weight FROM package_reward_rules
       WHERE package_id='PKG-CASTLE-UNIT-BOX' ORDER BY reward_order`,
    );
    assert.deepEqual(rules.map((row) => row.itemId), rewardCodes);
    assert.deepEqual(rules.map((row) => Number(row.weight)), [0.0005, 0.003, 0.015, 0.1, 0.8815]);
    assert.equal(rules.reduce((sum, row) => sum + Number(row.weight), 0), 1);
  });

  it("leaves no executable command registry or alias", async () => {
    assert.equal(await scalar(
      `SELECT COUNT(*) value FROM (
         SELECT command_text FROM command_aliases WHERE command_text='/캐슬오픈'
         UNION ALL SELECT command_text FROM package_command_aliases WHERE command_text='/캐슬오픈'
         UNION ALL SELECT command_code FROM command_registry WHERE command_code='INVENTORY_CASTLE_UNIT_BOX_OPEN'
       ) direct_commands`,
    ), 0n);
  });

  it("uses the shared provider for weighted per-open grants and replay", async () => {
    await database.execute("UPDATE package_catalog SET definition_status='READY',enabled=1 WHERE package_id='PKG-CASTLE-UNIT-BOX'");
    await database.execute(
      `INSERT INTO inventory_stacks(player_id,item_id,quantity,version)
       SELECT ?,id,3,1 FROM item_definitions WHERE code='ITEM-PACKAGE-CASTLE-UNIT-BOX'`, [playerId],
    );
    const runtime = createCurrentDomainPackageRuntime(database);
    const result = await runtime.packages.use({ requestKey: committedRequest, userId: playerId, packageId: "PKG-CASTLE-UNIT-BOX", openCount: 2 });
    assert.equal(result.packageId, "PKG-CASTLE-UNIT-BOX");
    assert.equal(result.openCount, 2);
    assert.ok(result.rewardCount >= 1 && result.rewardCount <= 2);
    assert.equal(await scalar(
      `SELECT quantity value FROM inventory_stacks JOIN item_definitions ON item_definitions.id=inventory_stacks.item_id
       WHERE player_id=? AND item_definitions.code='ITEM-PACKAGE-CASTLE-UNIT-BOX'`, [playerId]), 1n);
    assert.equal(await scalar(
      `SELECT COALESCE(SUM(quantity),0) value FROM inventory_stacks JOIN item_definitions ON item_definitions.id=inventory_stacks.item_id
       WHERE player_id=? AND item_definitions.code IN (${rewardCodes.map(() => "?").join(",")})`, [playerId, ...rewardCodes]), 2n);
    const replay = await runtime.packages.use({ requestKey: committedRequest, userId: playerId, packageId: "PKG-CASTLE-UNIT-BOX", openCount: 2 });
    assert.deepEqual(replay, result);
    assert.equal(await scalar("SELECT COUNT(*) value FROM package_domain_uses WHERE request_key=?", [committedRequest]), 1n);
  });

  it("rolls consumer back when every weighted reward definition is disabled", async () => {
    await database.execute(`UPDATE item_definitions SET active=0 WHERE code IN (${rewardCodes.map(() => "?").join(",")})`, rewardCodes);
    try {
      await assert.rejects(
        createCurrentDomainPackageRuntime(database).packages.use({ requestKey: rollbackRequest, userId: playerId, packageId: "PKG-CASTLE-UNIT-BOX", openCount: 1 }),
        /PACKAGE_DOMAIN_DEFINITION_NOT_FOUND/,
      );
    } finally {
      await database.execute(`UPDATE item_definitions SET active=1 WHERE code IN (${rewardCodes.map(() => "?").join(",")})`, rewardCodes);
    }
    assert.equal(await scalar(
      `SELECT quantity value FROM inventory_stacks JOIN item_definitions ON item_definitions.id=inventory_stacks.item_id
       WHERE player_id=? AND item_definitions.code='ITEM-PACKAGE-CASTLE-UNIT-BOX'`, [playerId]), 1n);
    assert.equal(await scalar("SELECT COUNT(*) value FROM package_domain_uses WHERE request_key=?", [rollbackRequest]), 0n);
  });
});
