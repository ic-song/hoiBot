import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createMariaDbPackageRuntime } from "../src/mariadb-package-infrastructure.js";
import { INDEPENDENT_PACKAGE_FIXTURES } from "./fixtures/package-parity.js";

const databaseConfigured = ["DATABASE_HOST", "DATABASE_PORT", "DATABASE_USER", "DATABASE_PASSWORD", "DATABASE_NAME"]
  .every((name) => Boolean(process.env[name]));

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) return name === "DATABASE_PORT" ? "3306" : "integration-test-not-configured";
  return value;
};

const runtime = createMariaDbPackageRuntime({
  host: required("DATABASE_HOST"),
  port: Number(required("DATABASE_PORT")),
  user: required("DATABASE_USER"),
  password: required("DATABASE_PASSWORD"),
  database: required("DATABASE_NAME"),
  connectionLimit: 2
});

const userId = "fixture-package-user";
const committedRequest = "fixture-ruby-committed";
const rollbackRequest = "fixture-halloween-rollback";
const miniPetRequest = "fixture-mini-pet-capacity";
const lateRollbackRequest = "fixture-late-rollback";

async function scalar(sql: string, values: readonly unknown[] = []): Promise<bigint> {
  const rows = await runtime.pool.query<Array<Record<string, unknown>>>(sql, values);
  return BigInt(String(rows[0]?.value ?? 0));
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  return typeof value === "string" ? JSON.parse(value) as Record<string, unknown> : value as Record<string, unknown>;
}

(databaseConfigured ? describe : describe.skip)("MariaDB package integration fixture", () => {
  before(async () => {
    await runtime.pool.query("DELETE FROM package_use_operations WHERE request_key IN (?, ?, ?, ?)", [committedRequest, rollbackRequest, miniPetRequest, lateRollbackRequest]);
    await runtime.pool.query("DELETE FROM item_ledger WHERE owner_type = 'USER' AND owner_id = ?", [userId]);
    await runtime.pool.query("DELETE FROM item_balances WHERE owner_type = 'USER' AND owner_id = ?", [userId]);
    await runtime.pool.query(
      "UPDATE item_definitions SET enabled = 1 WHERE item_id IN (SELECT consume_item_id FROM package_catalog WHERE package_id IN ('PKG-105','PKG-188','PKG-203','PKG-209')) OR item_id IN (SELECT item_id FROM package_reward_rules WHERE package_id IN ('PKG-105','PKG-188','PKG-203','PKG-209') AND item_id IS NOT NULL) OR item_id IN (SELECT item_id FROM dynamic_item_catalog_entries WHERE catalog_code='legacy-mini-pet') OR item_id LIKE 'ITEM-APPEARANCE-HALLOWEEN-%'"
    );
    await runtime.pool.query("UPDATE dynamic_item_catalog_entries SET enabled=1 WHERE catalog_code='legacy-mini-pet'");
    await runtime.pool.query(
      "UPDATE package_catalog SET definition_status = 'READY', enabled = 1 WHERE package_id IN ('PKG-105','PKG-188','PKG-203','PKG-209')"
    );
    await runtime.pool.query(
      "INSERT INTO item_balances(owner_type,owner_id,item_id,quantity) VALUES ('USER',?,'ITEM-PACKAGE-209',2),('USER',?,'ITEM-PACKAGE-188',1),('USER',?,'ITEM-PACKAGE-105',3),('USER',?,'ITEM-PACKAGE-203',1)",
      [userId, userId, userId, userId]
    );
    await runtime.pool.query(
      "INSERT INTO owner_item_capacities(owner_type,owner_id,item_type,capacity) VALUES ('USER',?,'MINI_PET',2) ON DUPLICATE KEY UPDATE capacity=VALUES(capacity)",
      [userId]
    );
  });

  after(async () => {
    await runtime.pool.query("DELETE FROM package_use_operations WHERE request_key IN (?, ?, ?, ?)", [committedRequest, rollbackRequest, miniPetRequest, lateRollbackRequest]);
    await runtime.pool.query("DELETE FROM item_ledger WHERE owner_type = 'USER' AND owner_id = ?", [userId]);
    await runtime.pool.query("DELETE FROM item_balances WHERE owner_type = 'USER' AND owner_id = ?", [userId]);
    await runtime.pool.query("DELETE FROM item_instances WHERE owner_type = 'USER' AND owner_id = ?", [userId]);
    await runtime.pool.query("DELETE FROM owner_item_capacities WHERE owner_type='USER' AND owner_id=?", [userId]);
    await runtime.pool.query("UPDATE package_reward_rules SET target_selector=NULL WHERE rule_id='RULE-PKG-203-007'");
    await runtime.pool.query("UPDATE package_catalog SET definition_status = 'EXACT_LEGACY_DRAFT', enabled = 0 WHERE package_id IN ('PKG-105','PKG-188','PKG-203','PKG-209')");
    await runtime.pool.query("UPDATE dynamic_item_catalog_entries SET enabled=0 WHERE catalog_code='legacy-mini-pet'");
    await runtime.pool.query(
      "UPDATE item_definitions SET enabled = 0 WHERE item_id IN (SELECT consume_item_id FROM package_catalog WHERE package_id IN ('PKG-105','PKG-188','PKG-203','PKG-209')) OR item_id IN (SELECT item_id FROM package_reward_rules WHERE package_id IN ('PKG-105','PKG-188','PKG-203','PKG-209') AND item_id IS NOT NULL) OR item_id IN (SELECT item_id FROM dynamic_item_catalog_entries WHERE catalog_code='legacy-mini-pet') OR item_id LIKE 'ITEM-APPEARANCE-HALLOWEEN-%'"
    );
    await runtime.pool.end();
  });

  it("stores all package aliases and reward rules with normalized fishing weight", async () => {
    assert.equal(await scalar("SELECT COUNT(*) AS value FROM package_command_aliases"), 29n);
    assert.equal(await scalar("SELECT COUNT(DISTINCT package_id) AS value FROM package_reward_rules"), 29n);
    assert.equal(await scalar("SELECT COUNT(*) AS value FROM package_reward_rules"), 158n);
    const rows = await runtime.pool.query<Array<Record<string, unknown>>>(
      "SELECT ROUND(SUM(weight), 9) AS value FROM package_reward_rules WHERE package_id = 'PKG-093'"
    );
    assert.equal(Number(rows[0]?.value), 1);
  });

  it("matches all 29 package catalogs and fixed DB reward rows to the exact legacy fixture", async () => {
    for (const fixture of INDEPENDENT_PACKAGE_FIXTURES) {
      const catalogRows = await runtime.pool.query<Array<Record<string, unknown>>>(
        "SELECT p.consume_item_id,p.max_open_count,a.command_text FROM package_catalog p JOIN package_command_aliases a ON a.package_id=p.package_id AND a.active=1 WHERE p.package_id=?",
        [fixture.packageId]
      );
      assert.equal(String(catalogRows[0]?.consume_item_id), fixture.consumeItemId, fixture.packageId);
      assert.equal(Number(catalogRows[0]?.max_open_count), fixture.maxOpenCount, fixture.packageId);
      assert.equal(String(catalogRows[0]?.command_text), fixture.legacyCommand, fixture.packageId);

      const rewardRows = await runtime.pool.query<Array<Record<string, unknown>>>(
        "SELECT r.item_id,r.quantity,r.owner_scope,i.item_type,i.item_name,i.metadata_json,r.metadata_override_json FROM package_reward_rules r JOIN item_definitions i ON i.item_id=r.item_id WHERE r.package_id=? AND r.rule_mode='ALL' AND r.enabled=1 ORDER BY r.reward_order",
        [fixture.packageId]
      );
      assert.equal(rewardRows.length, fixture.fixedRewards.length, fixture.legacyCommand);
      for (let index = 0; index < fixture.fixedRewards.length; index++) {
        const expected = fixture.fixedRewards[index]!;
        const actual = rewardRows[index]!;
        assert.equal(String(actual.item_id), expected.itemId, fixture.legacyCommand);
        assert.equal(String(actual.item_name), expected.name, fixture.legacyCommand);
        assert.equal(String(actual.item_type), expected.itemType, fixture.legacyCommand);
        assert.equal(BigInt(String(actual.quantity)), expected.quantity, fixture.legacyCommand);
        assert.equal(String(actual.owner_scope), expected.ownerScope ?? "USER", fixture.legacyCommand);
        const definition = jsonObject(actual.metadata_json);
        const override = jsonObject(actual.metadata_override_json);
        for (const [key, value] of Object.entries(expected.metadata ?? {})) {
          assert.deepEqual(override[key] ?? definition[key], value, fixture.legacyCommand + ":" + key);
        }
      }
    }
  });

  it("commits consumption, fixed rewards and operation record atomically", async () => {
    const result = await runtime.packages.use({
      requestKey: committedRequest,
      userId,
      packageId: "PKG-209",
      openCount: 1
    });
    assert.equal(result.rewardCount, 3);
    assert.equal(await scalar("SELECT quantity AS value FROM item_balances WHERE owner_type='USER' AND owner_id=? AND item_id='ITEM-PACKAGE-209'", [userId]), 1n);
    assert.equal(await scalar("SELECT COUNT(*) AS value FROM package_use_operations WHERE request_key=? AND status='COMMITTED'", [committedRequest]), 1n);
    assert.equal(await scalar("SELECT COUNT(*) AS value FROM item_ledger WHERE owner_type='USER' AND owner_id=?", [userId]), 4n);
  });

  it("returns a committed duplicate result without a second mutation", async () => {
    const beforeBalance = await scalar("SELECT quantity AS value FROM item_balances WHERE owner_type='USER' AND owner_id=? AND item_id='ITEM-PACKAGE-209'", [userId]);
    const replay = await runtime.packages.use({ requestKey: committedRequest, userId, packageId: "PKG-209", openCount: 1 });
    assert.deepEqual(replay, { packageId: "PKG-209", openCount: 1, rewardCount: 3 });
    assert.equal(await scalar("SELECT quantity AS value FROM item_balances WHERE owner_type='USER' AND owner_id=? AND item_id='ITEM-PACKAGE-209'", [userId]), beforeBalance);
  });

  it("replays the committed result after recreating the MariaDB runtime", async () => {
    const restartedRuntime = createMariaDbPackageRuntime({
      host: required("DATABASE_HOST"),
      port: Number(required("DATABASE_PORT")),
      user: required("DATABASE_USER"),
      password: required("DATABASE_PASSWORD"),
      database: required("DATABASE_NAME"),
      connectionLimit: 1
    });
    try {
      const replay = await restartedRuntime.packages.use({ requestKey: committedRequest, userId, packageId: "PKG-209", openCount: 1 });
      assert.deepEqual(replay, { packageId: "PKG-209", openCount: 1, rewardCount: 3 });
      assert.equal(await scalar("SELECT COUNT(*) AS value FROM package_use_operations WHERE request_key=? AND status='COMMITTED'", [committedRequest]), 1n);
    } finally {
      await restartedRuntime.pool.end();
    }
  });

  it("rolls back the operation and consumer when a dynamic reward cannot resolve", async () => {
    await assert.rejects(
      runtime.packages.use({ requestKey: rollbackRequest, userId, packageId: "PKG-188", openCount: 1, targetSelector: "missing-pet-instance" }),
      /PET_APPEARANCE_TARGET_NOT_FOUND/
    );
    assert.equal(await scalar("SELECT quantity AS value FROM item_balances WHERE owner_type='USER' AND owner_id=? AND item_id='ITEM-PACKAGE-188'", [userId]), 1n);
    assert.equal(await scalar("SELECT COUNT(*) AS value FROM package_use_operations WHERE request_key=?", [rollbackRequest]), 0n);
  });

  it("grants only remaining mini-pet capacity and consumes only the granted count", async () => {
    const result = await runtime.packages.use({
      requestKey: miniPetRequest,
      userId,
      packageId: "PKG-105",
      openCount: 3
    });
    assert.equal(result.openCount, 2);
    assert.equal(await scalar("SELECT quantity AS value FROM item_balances WHERE owner_type='USER' AND owner_id=? AND item_id='ITEM-PACKAGE-105'", [userId]), 1n);
    assert.equal(await scalar("SELECT COUNT(*) AS value FROM item_instances i JOIN item_definitions d ON d.item_id=i.item_id WHERE i.owner_type='USER' AND i.owner_id=? AND i.removed_at IS NULL AND d.item_type='MINI_PET'", [userId]), 2n);
  });

  it("rolls back consumer and earlier DB rewards after a late instance insert failure", async () => {
    await runtime.pool.query(
      "UPDATE package_reward_rules SET target_selector='00000000-0000-0000-0000-000000000099' WHERE rule_id='RULE-PKG-203-007'"
    );
    try {
      await assert.rejects(
        runtime.packages.use({ requestKey: lateRollbackRequest, userId, packageId: "PKG-203", openCount: 1 }),
        /foreign key constraint/i
      );
    } finally {
      await runtime.pool.query("UPDATE package_reward_rules SET target_selector=NULL WHERE rule_id='RULE-PKG-203-007'");
    }
    assert.equal(await scalar("SELECT quantity AS value FROM item_balances WHERE owner_type='USER' AND owner_id=? AND item_id='ITEM-PACKAGE-203'", [userId]), 1n);
    assert.equal(await scalar("SELECT COUNT(*) AS value FROM item_balances WHERE owner_type='USER' AND owner_id=? AND item_id='ITEM-RWD-001'", [userId]), 0n);
    assert.equal(await scalar("SELECT COUNT(*) AS value FROM package_use_operations WHERE request_key=?", [lateRollbackRequest]), 0n);
  });
});
