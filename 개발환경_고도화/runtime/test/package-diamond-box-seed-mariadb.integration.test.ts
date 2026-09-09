import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { createCurrentDomainPackageRuntime } from "../src/package/current-domain-package-runtime.js";

const configured = ["DATABASE_HOST", "DATABASE_PORT", "DATABASE_USER", "DATABASE_PASSWORD", "DATABASE_NAME"]
  .every((name) => Boolean(process.env[name]));
const required = (name: string): string => process.env[name] ?? "integration-test-not-configured";
const playerId = "900000015";
const committedRequest = "fixture-diamond-package-committed";
const rollbackRequest = "fixture-diamond-package-rollback";
let database: DatabaseClient;

async function scalar(sql: string, values: readonly unknown[] = []): Promise<bigint> {
  const rows = await database.query<Array<{ value: string | bigint }>>(sql, values);
  return BigInt(rows[0]?.value ?? 0);
}

(configured ? describe : describe.skip)("diamond package seed", () => {
  before(async () => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"),
      port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"),
      password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"),
      connectionLimit: 2, connectTimeoutMs: 5_000 });
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
    await database.execute("UPDATE package_catalog SET definition_status='EXACT_LEGACY_DRAFT',enabled=0 WHERE package_id='PKG-DIAMOND-BOX'");
    await database.execute("UPDATE package_item_definitions SET enabled=1 WHERE item_id IN ('ITEM-RWD-053','diamond')");
    await database.execute("UPDATE item_definitions SET active=1 WHERE code IN ('ITEM-RWD-053','diamond')");
    await database.close();
  });

  it("stores the command only as a disabled catalog source", async () => {
    const rows = await database.query<Array<{ package_id: string; source_legacy_command: string; consume_item_id: string; enabled: number }>>(
      "SELECT package_id,source_legacy_command,consume_item_id,enabled FROM package_catalog WHERE package_id='PKG-DIAMOND-BOX'",
    );
    assert.deepEqual(rows.map((row) => ({ ...row, enabled: Number(row.enabled) })), [{
      package_id: "PKG-DIAMOND-BOX", source_legacy_command: "/다이아상자오픈", consume_item_id: "ITEM-RWD-053", enabled: 0,
    }]);
  });

  it("maps one fixed POINT reward to the diamond currency", async () => {
    const rows = await database.query<Array<{ item_id: string; item_type: string; metadata_json: string | { currencyCode: string }; quantity: bigint }>>(
      `SELECT rule.item_id,item.item_type,item.metadata_json,rule.quantity
       FROM package_reward_rules rule JOIN package_item_definitions item ON item.item_id=rule.item_id
       WHERE rule.package_id='PKG-DIAMOND-BOX' AND rule.enabled=1`,
    );
    assert.deepEqual(rows.map((row) => ({ itemId: row.item_id, itemType: row.item_type,
      currencyCode: (typeof row.metadata_json === "string" ? JSON.parse(row.metadata_json) : row.metadata_json).currencyCode,
      quantity: Number(row.quantity) })), [{ itemId: "diamond", itemType: "POINT", currencyCode: "diamond", quantity: 1 }]);
  });

  it("leaves no executable or package alias", async () => {
    const aliases = await database.query<Array<{ command_text: string }>>(
      `SELECT command_text FROM command_aliases WHERE command_text='/다이아상자오픈'
       UNION ALL SELECT command_text FROM package_command_aliases WHERE command_text='/다이아상자오픈'`,
    );
    const registry = await database.query<Array<{ command_code: string }>>(
      "SELECT command_code FROM command_registry WHERE command_code='INVENTORY_DIAMOND_BOX_OPEN'",
    );
    assert.deepEqual(aliases, []);
    assert.deepEqual(registry, []);
  });

  it("uses the shared provider for box consumption and diamond credit", async () => {
    await database.execute("UPDATE package_catalog SET definition_status='READY',enabled=1 WHERE package_id='PKG-DIAMOND-BOX'");
    await database.execute(
      "INSERT INTO inventory_stacks(player_id,item_id,quantity,version) SELECT ?,id,3,1 FROM item_definitions WHERE code='ITEM-RWD-053'",
      [playerId],
    );
    const result = await createCurrentDomainPackageRuntime(database).packages.use({
      requestKey: committedRequest, userId: playerId, packageId: "PKG-DIAMOND-BOX", openCount: 2,
    });
    assert.deepEqual(result, { packageId: "PKG-DIAMOND-BOX", openCount: 2, rewardCount: 1 });
    assert.equal(await scalar(
      `SELECT quantity AS value FROM inventory_stacks JOIN item_definitions ON item_definitions.id=inventory_stacks.item_id
       WHERE player_id=? AND item_definitions.code='ITEM-RWD-053'`, [playerId]), 1n);
    assert.equal(await scalar("SELECT CAST(balance AS SIGNED) AS value FROM currency_accounts WHERE player_id=? AND currency_code='diamond'", [playerId]), 2n);
  });

  it("replays without another box consumption or diamond credit", async () => {
    const replay = await createCurrentDomainPackageRuntime(database).packages.use({
      requestKey: committedRequest, userId: playerId, packageId: "PKG-DIAMOND-BOX", openCount: 2,
    });
    assert.deepEqual(replay, { packageId: "PKG-DIAMOND-BOX", openCount: 2, rewardCount: 1 });
    assert.equal(await scalar("SELECT CAST(balance AS SIGNED) AS value FROM currency_accounts WHERE player_id=? AND currency_code='diamond'", [playerId]), 2n);
    assert.equal(await scalar("SELECT COUNT(*) AS value FROM currency_ledger WHERE player_id=? AND currency_code='diamond'", [playerId]), 1n);
  });

  it("rolls back consumption when the diamond reward definition is disabled", async () => {
    await database.execute("UPDATE package_item_definitions SET enabled=0 WHERE item_id='diamond'");
    try {
      await assert.rejects(createCurrentDomainPackageRuntime(database).packages.use({
        requestKey: rollbackRequest, userId: playerId, packageId: "PKG-DIAMOND-BOX", openCount: 1,
      }), /PACKAGE_ITEM_DISABLED|ITEM_DISABLED|ITEM_NOT_AVAILABLE/);
    } finally {
      await database.execute("UPDATE package_item_definitions SET enabled=1 WHERE item_id='diamond'");
    }
    assert.equal(await scalar(
      `SELECT quantity AS value FROM inventory_stacks JOIN item_definitions ON item_definitions.id=inventory_stacks.item_id
       WHERE player_id=? AND item_definitions.code='ITEM-RWD-053'`, [playerId]), 1n);
    assert.equal(await scalar("SELECT CAST(balance AS SIGNED) AS value FROM currency_accounts WHERE player_id=? AND currency_code='diamond'", [playerId]), 2n);
    assert.equal(await scalar("SELECT COUNT(*) AS value FROM package_domain_uses WHERE request_key=?", [rollbackRequest]), 0n);
  });
});
