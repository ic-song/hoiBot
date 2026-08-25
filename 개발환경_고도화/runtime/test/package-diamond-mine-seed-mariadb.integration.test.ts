import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { createCurrentDomainPackageRuntime } from "../src/package/current-domain-package-runtime.js";

const configured = ["DATABASE_HOST", "DATABASE_PORT", "DATABASE_USER", "DATABASE_PASSWORD", "DATABASE_NAME"]
  .every((name) => Boolean(process.env[name]));
const required = (name: string): string => process.env[name] ?? "integration-test-not-configured";
let database: DatabaseClient;
const playerId = "900000014";
const committedRequest = "fixture-diamond-mine-package-committed";
const rollbackRequest = "fixture-diamond-mine-package-rollback";

async function scalar(sql: string, values: readonly unknown[] = []): Promise<bigint> {
  const rows = await database.query<Array<{ value: string | bigint }>>(sql, values);
  return BigInt(rows[0]?.value ?? 0);
}

(configured ? describe : describe.skip)("diamond mine package seed", () => {
  before(async () => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"),
      port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"),
      password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"),
      connectionLimit: 2, connectTimeoutMs: 5_000 });
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
    await database.execute("UPDATE package_catalog SET definition_status='EXACT_LEGACY_DRAFT',enabled=0 WHERE package_id='PKG-DIAMOND-MINE-BOX'");
    await database.execute("UPDATE package_item_definitions SET enabled=0 WHERE item_id='ITEM-DIAMOND-MINE-BOX'");
    await database.execute("UPDATE package_item_definitions SET enabled=1 WHERE item_id='ITEM-RWD-053'");
    await database.execute("UPDATE item_definitions SET active=0 WHERE code='ITEM-DIAMOND-MINE-BOX'");
    await database.execute("UPDATE item_definitions SET active=1 WHERE code='ITEM-RWD-053'");
    await database.close();
  });

  it("stores the legacy command only as a disabled catalog source", async () => {
    const rows = await database.query<Array<{
      package_id: string; source_legacy_command: string; consume_item_id: string;
      max_open_count: bigint; enabled: number;
    }>>(
      `SELECT package_id,source_legacy_command,consume_item_id,max_open_count,enabled
       FROM package_catalog WHERE package_id='PKG-DIAMOND-MINE-BOX'`,
    );
    assert.deepEqual(rows.map((row) => ({ ...row, max_open_count: Number(row.max_open_count), enabled: Number(row.enabled) })), [{
      package_id: "PKG-DIAMOND-MINE-BOX", source_legacy_command: "/다이아박스오픈",
      consume_item_id: "ITEM-DIAMOND-MINE-BOX", max_open_count: 1000, enabled: 0,
    }]);
  });

  it("seeds one deterministic stack reward per open", async () => {
    const rows = await database.query<Array<{
      rule_mode: string; operation: string; owner_scope: string; item_id: string; quantity: bigint;
    }>>(
      `SELECT rule_mode,operation,owner_scope,item_id,quantity FROM package_reward_rules
       WHERE package_id='PKG-DIAMOND-MINE-BOX' AND enabled=1 ORDER BY reward_order`,
    );
    assert.deepEqual(rows.map((row) => ({ ...row, quantity: Number(row.quantity) })), [{
      rule_mode: "ALL", operation: "ADD", owner_scope: "USER", item_id: "ITEM-RWD-053", quantity: 1,
    }]);
  });

  it("leaves no executable or package alias for the legacy command", async () => {
    const rows = await database.query<Array<{ command_text: string }>>(
      `SELECT command_text FROM command_aliases WHERE command_text='/다이아박스오픈'
       UNION ALL
       SELECT command_text FROM package_command_aliases WHERE command_text='/다이아박스오픈'`,
    );
    const registry = await database.query<Array<{ command_code: string }>>(
      "SELECT command_code FROM command_registry WHERE command_code='INVENTORY_DIAMOND_MINE_BOX_OPEN'",
    );
    assert.deepEqual(rows, []);
    assert.deepEqual(registry, []);
  });

  it("uses the shared provider for fixed one-to-one consumption and reward", async () => {
    await database.execute("UPDATE package_catalog SET definition_status='READY',enabled=1 WHERE package_id='PKG-DIAMOND-MINE-BOX'");
    await database.execute("UPDATE package_item_definitions SET enabled=1 WHERE item_id IN ('ITEM-DIAMOND-MINE-BOX','ITEM-RWD-053')");
    await database.execute("UPDATE item_definitions SET active=1 WHERE code IN ('ITEM-DIAMOND-MINE-BOX','ITEM-RWD-053')");
    await database.execute(
      "INSERT INTO inventory_stacks(player_id,item_id,quantity,version) SELECT ?,id,3,1 FROM item_definitions WHERE code='ITEM-DIAMOND-MINE-BOX'",
      [playerId],
    );
    const result = await createCurrentDomainPackageRuntime(database).packages.use({
      requestKey: committedRequest, userId: playerId, packageId: "PKG-DIAMOND-MINE-BOX", openCount: 2,
    });
    assert.deepEqual(result, { packageId: "PKG-DIAMOND-MINE-BOX", openCount: 2, rewardCount: 1 });
    assert.equal(await scalar(
      `SELECT quantity AS value FROM inventory_stacks JOIN item_definitions ON item_definitions.id=inventory_stacks.item_id
       WHERE player_id=? AND item_definitions.code='ITEM-DIAMOND-MINE-BOX'`, [playerId]), 1n);
    assert.equal(await scalar(
      `SELECT quantity AS value FROM inventory_stacks JOIN item_definitions ON item_definitions.id=inventory_stacks.item_id
       WHERE player_id=? AND item_definitions.code='ITEM-RWD-053'`, [playerId]), 2n);
  });

  it("replays one request without consuming or granting again", async () => {
    const replay = await createCurrentDomainPackageRuntime(database).packages.use({
      requestKey: committedRequest, userId: playerId, packageId: "PKG-DIAMOND-MINE-BOX", openCount: 2,
    });
    assert.deepEqual(replay, { packageId: "PKG-DIAMOND-MINE-BOX", openCount: 2, rewardCount: 1 });
    assert.equal(await scalar("SELECT COUNT(*) AS value FROM package_domain_uses WHERE request_key=?", [committedRequest]), 1n);
    assert.equal(await scalar(
      `SELECT quantity AS value FROM inventory_stacks JOIN item_definitions ON item_definitions.id=inventory_stacks.item_id
       WHERE player_id=? AND item_definitions.code='ITEM-RWD-053'`, [playerId]), 2n);
  });

  it("rolls back package consumption when the reward definition is unavailable", async () => {
    await database.execute("UPDATE item_definitions SET active=0 WHERE code='ITEM-RWD-053'");
    try {
      await assert.rejects(createCurrentDomainPackageRuntime(database).packages.use({
        requestKey: rollbackRequest, userId: playerId, packageId: "PKG-DIAMOND-MINE-BOX", openCount: 1,
      }), /PACKAGE_DOMAIN_DEFINITION_NOT_FOUND/);
    } finally {
      await database.execute("UPDATE item_definitions SET active=1 WHERE code='ITEM-RWD-053'");
    }
    assert.equal(await scalar(
      `SELECT quantity AS value FROM inventory_stacks JOIN item_definitions ON item_definitions.id=inventory_stacks.item_id
       WHERE player_id=? AND item_definitions.code='ITEM-DIAMOND-MINE-BOX'`, [playerId]), 1n);
    assert.equal(await scalar(
      `SELECT quantity AS value FROM inventory_stacks JOIN item_definitions ON item_definitions.id=inventory_stacks.item_id
       WHERE player_id=? AND item_definitions.code='ITEM-RWD-053'`, [playerId]), 2n);
    assert.equal(await scalar("SELECT COUNT(*) AS value FROM package_domain_uses WHERE request_key=?", [rollbackRequest]), 0n);
  });
});
