import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import mariadb from "mariadb";

const enabled = process.env.RUN_PACKAGE_REWARD_GAP_MARIADB === "1";
const migrationPath = path.resolve("migrations/382_package_reward_canonical_gap.sql");

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is required`);
  return value;
}

describe("package reward canonical gap MariaDB integration", { skip: !enabled }, () => {
  let connection: Awaited<ReturnType<typeof mariadb.createConnection>>;
  let migrationSql: string;

  before(async () => {
    migrationSql = await readFile(migrationPath, "utf8");
    connection = await mariadb.createConnection({
      host: required("DATABASE_HOST"),
      port: Number(required("DATABASE_PORT")),
      user: required("DATABASE_USER"),
      password: required("DATABASE_PASSWORD"),
      database: required("DATABASE_NAME"),
      charset: "utf8mb4",
      multipleStatements: true,
      bigIntAsNumber: false
    });
  });

  after(async () => {
    await connection.query("DROP TRIGGER IF EXISTS fail_package_reward_gap_rule_update");
    await connection.end();
  });

  it("connects every package reward gap to one active canonical definition", async () => {
    const rows = await connection.query<Array<{ code: string; active: number; enabled: number }>>(`
      SELECT canonical.code,canonical.active,compatibility.enabled
      FROM item_definitions canonical
      JOIN package_item_definitions compatibility ON compatibility.item_id=canonical.code
      WHERE canonical.code IN ('pet_enhance_stone','police_thief_ticket','free_market_membership','legacy-seasoned-chicken')
      ORDER BY canonical.code
    `);
    assert.deepEqual(rows.map((row) => [row.code, Number(row.active), Number(row.enabled)]), [
      ["free_market_membership", 1, 1],
      ["legacy-seasoned-chicken", 1, 1],
      ["pet_enhance_stone", 1, 1],
      ["police_thief_ticket", 1, 1]
    ]);

    const oldReferences = await connection.query<Array<{ count_value: bigint }>>(`
      SELECT
        (SELECT COUNT(*) FROM package_reward_rules WHERE item_id IN ('ITEM-RWD-026','ITEM-RWD-047','ITEM-RWD-SEASONED-CHICKEN'))
        +(SELECT COUNT(*) FROM package_rewards WHERE item_id IN ('ITEM-RWD-026','ITEM-RWD-047','ITEM-RWD-SEASONED-CHICKEN'))
        +(SELECT COUNT(*) FROM package_reward_bundle_items WHERE item_id IN ('ITEM-RWD-026','ITEM-RWD-047','ITEM-RWD-SEASONED-CHICKEN'))
        +(SELECT COUNT(*) FROM dynamic_item_catalog_entries WHERE item_id IN ('ITEM-RWD-026','ITEM-RWD-047','ITEM-RWD-SEASONED-CHICKEN')) count_value
    `);
    assert.equal(oldReferences[0]!.count_value, 0n);

    const targetCounts = await connection.query<Array<{ item_id: string; count_value: bigint }>>(`
      SELECT item_id,COUNT(*) count_value FROM package_reward_rules
      WHERE item_id IN ('pet_enhance_stone','police_thief_ticket','legacy-seasoned-chicken')
      GROUP BY item_id ORDER BY item_id
    `);
    assert.deepEqual(targetCounts.map((row) => [row.item_id, row.count_value]), [
      ["legacy-seasoned-chicken", 1n],
      ["pet_enhance_stone", 14n],
      ["police_thief_ticket", 1n]
    ]);
  });

  it("is idempotent when the migration is replayed", async () => {
    const beforeRows = JSON.stringify(await connection.query(`
      SELECT code,display_name,active,metadata_json FROM item_definitions
      WHERE code IN ('pet_enhance_stone','police_thief_ticket','free_market_membership','legacy-seasoned-chicken','ITEM-RWD-026','ITEM-RWD-047','ITEM-RWD-SEASONED-CHICKEN')
      ORDER BY code
    `), (_, value) => typeof value === "bigint" ? value.toString() : value);
    await connection.query(migrationSql);
    const afterRows = JSON.stringify(await connection.query(`
      SELECT code,display_name,active,metadata_json FROM item_definitions
      WHERE code IN ('pet_enhance_stone','police_thief_ticket','free_market_membership','legacy-seasoned-chicken','ITEM-RWD-026','ITEM-RWD-047','ITEM-RWD-SEASONED-CHICKEN')
      ORDER BY code
    `), (_, value) => typeof value === "bigint" ? value.toString() : value);
    assert.equal(afterRows, beforeRows);
  });

  it("rolls back definition changes when reward reference migration fails", async () => {
    const rule = (await connection.query<Array<{ rule_id: string }>>(
      "SELECT rule_id FROM package_reward_rules WHERE item_id='pet_enhance_stone' ORDER BY rule_id LIMIT 1"
    ))[0]!;
    await connection.query("UPDATE item_definitions SET active=0 WHERE code='free_market_membership'");
    await connection.query("UPDATE package_reward_rules SET item_id='ITEM-RWD-026' WHERE rule_id=?", [rule.rule_id]);
    await connection.query("COMMIT");
    await connection.query(`
      CREATE TRIGGER fail_package_reward_gap_rule_update
      BEFORE UPDATE ON package_reward_rules FOR EACH ROW
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic package reward gap failure'
    `);

    try {
      await assert.rejects(connection.query(migrationSql), /synthetic package reward gap failure/);
      await connection.query("ROLLBACK");
      const state = (await connection.query<Array<{ active: number }>>(
        "SELECT active FROM item_definitions WHERE code='free_market_membership'"
      ))[0]!;
      assert.equal(Number(state.active), 0);
      const retained = (await connection.query<Array<{ item_id: string }>>(
        "SELECT item_id FROM package_reward_rules WHERE rule_id=?", [rule.rule_id]
      ))[0]!;
      assert.equal(retained.item_id, "ITEM-RWD-026");
    } finally {
      await connection.query("DROP TRIGGER IF EXISTS fail_package_reward_gap_rule_update");
      await connection.query(migrationSql);
    }
  });
});
