import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const migrationRoot = new URL("../migrations/", import.meta.url);
const migrationName = "466_object_db_transition_recovery_receipt_links.sql";
const rollbackName = "rollback/466_object_db_transition_recovery_receipt_links.rollback.sql";
const migration = readFileSync(new URL(migrationName, migrationRoot), "utf8");
const rollback = readFileSync(new URL(rollbackName, migrationRoot), "utf8");

const immutableMigrations = new Map<string, string>([
  ["461_object_db_transition_identity_crosswalk.sql", "a8baca4e97b4bad2913eed0a0a0842a712ebb32710737fef2939a265bad0f8e2"],
  ["462_object_db_transition_app_wiring_claim.sql", "07b31e996cc1f1c0b69b3cf8a61cf063fa068b7fbd0fde447dabcea3d815fa9c"],
  ["463_object_db_transition_operation_receipts.sql", "890873c7f0e2be445da5f0e46dbc6a8b68711063f97cd8cc76b7bf64a522e9e7"],
  ["464_object_db_transition_typed_asset_ledgers.sql", "16e3140a8a5dbec89f6ef37bf9d642de50f973c0b6d905434f1b4e1c2f3cef11"],
  ["465_object_db_transition_operation_participants.sql", "14d065fdd1d12782212e01ae74a9371d22f157450927fb39a9dee3b2af1964f0"]
]);

const typedReceipts = [
  ["DAILY_PRAYER", "daily_prayer_operation_id", "canonical_daily_prayer_operations"],
  ["HOME_AGGREGATE", "home_aggregate_operation_id", "canonical_home_aggregate_operations"],
  ["MARKET", "market_operation_id", "canonical_market_operations"],
  ["MEMBER_TITLE", "member_title_operation_id", "canonical_member_title_operations"],
  ["MINI_PET_TITLE", "mini_pet_title_operation_id", "canonical_mini_pet_title_operations"],
  ["PACKAGE_USE", "package_use_operation_id", "canonical_package_use_operations"],
  ["PET_EXPLORE", "pet_explore_operation_id", "canonical_pet_explore_operations"],
  ["PET_TITLE", "pet_title_operation_id", "canonical_pet_title_operations"],
  ["PLAYER_IDENTITY", "player_identity_operation_id", "canonical_player_identity_operations"]
] as const;

function position(source: string, fragment: string): number {
  const found = source.indexOf(fragment);
  assert.notEqual(found, -1, fragment);
  return found;
}

describe("WBS743 migration 466 recovery and receipt-link contract", () => {
  it("does not mutate the applied 461 through 465 migrations", () => {
    for (const [name, expected] of immutableMigrations) {
      const source = readFileSync(new URL(name, migrationRoot), "utf8").replace(/\r\n/g, "\n");
      const actual = createHash("sha256").update(source, "utf8").digest("hex");
      assert.equal(actual, expected, name);
    }
  });

  it("adds replay-safe columns, preflights legacy payloads, and backfills existing rows", () => {
    for (const column of ["effect_mode", "lease_token", "lease_generation", "lease_expires_time", "attempt_count", "recovery_status", "recovery_code"]) {
      assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}\\b`));
    }
    assert.ok(position(migration, "AS odbt_466_claim_preflight") < position(migration, "ALTER TABLE canonical_app_wiring_operations"));
    assert.ok(position(migration, "ALTER TABLE canonical_app_wiring_operations") < position(migration, "UPDATE canonical_app_wiring_operations"));
    assert.ok(position(migration, "UPDATE canonical_app_wiring_operations") < position(migration, "ADD KEY IF NOT EXISTS ix_odbt_466_01_01"));
    assert.match(migration, /ER_SUBQUERY_NO_1_ROW/);
    const beforeFirstDdl = migration.slice(0, position(migration, "ALTER TABLE canonical_app_wiring_operations"))
      .replace(/^--.*$/gm, "");
    assert.doesNotMatch(beforeFirstDdl, /\b(?:ALTER|CREATE|DROP|INSERT|UPDATE|DELETE)\b/i);
    assert.doesNotMatch(beforeFirstDdl, /\b(?:effect_mode|lease_token|lease_generation|lease_expires_time|attempt_count|recovery_status|recovery_code)\b/);
    assert.match(migration, /claim_state = 'COMPLETED' AND \(/);
    assert.match(migration, /claim_state = 'FAILED' AND \(result_json IS NOT NULL OR error_code IS NULL\)/);
    assert.match(migration, /claim_state = 'MUTATION_STARTED' AND route IN \('SHADOW','REJECT'\)/);
    assert.match(migration, /JSON_VALID\(result_json\) <> 1/);
    assert.match(migration, /JSON_TYPE\(JSON_EXTRACT\(result_json, '\$'\)\) <> 'OBJECT'/);
    assert.match(migration, /JSON_LENGTH\(JSON_KEYS\(result_json\)\) <> 1/);
    assert.match(migration, /JSON_UNQUOTE\(JSON_EXTRACT\(result_json, '\$\.status'\)\) NOT REGEXP '\^\[A-Z\]\[A-Z0-9_\]\{0,63\}\$'/);
    assert.match(migration, /referenceId'[\s\S]*NOT REGEXP '\^\[A-Za-z0-9\._:@\/-\]\{1,191\}\$'/);
    assert.match(migration, /resultFingerprint'[\s\S]*NOT REGEXP '\^\[0-9a-f\]\{64\}\$'/);
    assert.match(migration, /effect_mode=COALESCE\(effect_mode, CASE WHEN route IN \('SHADOW','REJECT'\) THEN 'READ_ONLY' ELSE 'MUTATION' END\)/);
    assert.match(migration, /lease_generation=COALESCE\(lease_generation, 0\)[\s\S]*attempt_count=COALESCE\(attempt_count, 1\)/);
    assert.match(migration, /recovery_status=COALESCE\(recovery_status, 'NONE'\)/);
    assert.match(migration, /WHERE effect_mode IS NULL OR lease_generation IS NULL OR attempt_count IS NULL OR recovery_status IS NULL/);
    assert.match(migration, /UPDATE_USER='migration:466'[\s\S]*UPDATE_TIME=DATE_FORMAT\(DATE_ADD\(UTC_TIMESTAMP\(\), INTERVAL 9 HOUR\), '%Y-%m-%d %H:%i:%s'\)/);
    assert.match(migration, /effect_mode IS NULL OR effect_mode IN \('READ_ONLY','MUTATION'\)/);
    assert.match(migration, /effect_mode IS NULL OR route NOT IN \('SHADOW','REJECT'\) OR effect_mode = 'READ_ONLY'/);
    assert.match(migration, /effect_mode IS NULL OR claim_state <> 'MUTATION_STARTED' OR effect_mode = 'MUTATION'/);
    assert.match(migration, /claim_state IN \('CLAIMED','MUTATION_STARTED'\) AND result_json IS NULL AND error_code IS NULL/);
    assert.match(migration, /claim_state = 'COMPLETED' AND result_json IS NOT NULL AND error_code IS NULL/);
    assert.match(migration, /claim_state = 'FAILED' AND result_json IS NULL AND error_code IS NOT NULL/);
    assert.match(migration, /claim_state NOT IN \('COMPLETED','FAILED'\) OR \(lease_token IS NULL AND lease_expires_time IS NULL\)/);
    assert.match(migration, /lease_generation >= 0 AND attempt_count >= 1/);
    assert.match(migration, /recovery_status IS NULL OR \(recovery_status = 'NONE' AND recovery_code IS NULL\)/);
    assert.match(migration, /recovery_status IN \('PENDING','FAILED'\) AND claim_state = 'MUTATION_STARTED'/);
    assert.match(migration, /recovery_status = 'RECOVERED' AND claim_state IN \('CLAIMED','COMPLETED','FAILED'\)/);
    assert.match(migration, /claim_state = 'MUTATION_STARTED' AND lease_token IS NULL AND lease_generation = 0/);
    assert.match(migration, /lease_token IS NULL OR lease_generation >= 1/);
    assert.match(migration, /ADD KEY IF NOT EXISTS ix_odbt_466_01_01 \(claim_state, lease_expires_time\)/);
  });

  it("keeps the pre-cutover writer compatible through one explicit all-null transition bundle", () => {
    assert.match(migration, /pre-cutover writer may still insert an all-NULL/);
    assert.match(migration, /storage compatibility only:[\s\S]*must drain\/fence it and never auto-adopt or execute it/);
    assert.match(migration, /post-provider-cutover migration must[\s\S]*make the four required metadata columns NOT NULL/);
    assert.doesNotMatch(migration, /MODIFY (?:effect_mode|lease_generation|attempt_count|recovery_status)[^,;]*NOT NULL/);
    assert.match(migration, /effect_mode IS NULL AND lease_token IS NULL AND lease_generation IS NULL AND lease_expires_time IS NULL AND attempt_count IS NULL AND recovery_status IS NULL AND recovery_code IS NULL/);
    assert.match(migration, /effect_mode IS NOT NULL AND lease_generation IS NOT NULL AND attempt_count IS NOT NULL AND recovery_status IS NOT NULL/);
    assert.match(migration, /\(lease_token IS NULL AND lease_expires_time IS NULL\) OR \(lease_token IS NOT NULL AND lease_expires_time IS NOT NULL\)/);
  });

  it("makes every non-table DDL clause safe to replay after a partial implicit commit", () => {
    assert.equal([...migration.matchAll(/ADD COLUMN IF NOT EXISTS /g)].length, 7);
    assert.equal([...migration.matchAll(/ADD KEY IF NOT EXISTS /g)].length, 2);
    assert.equal([...migration.matchAll(/ADD CONSTRAINT IF NOT EXISTS chk_odbt_466_01_rule_/g)].length, 16);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS canonical_app_wiring_receipt_links/);
  });

  it("creates one typed CUID2 receipt link with exact FK types and uniqueness", () => {
    assert.match(migration, /CREATE TABLE IF NOT EXISTS canonical_app_wiring_receipt_links/);
    assert.match(migration, /canonical_app_wiring_receipt_link_id CHAR\(8\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL/);
    assert.match(migration, /app_wiring_operation_id CHAR\(8\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL/);
    assert.match(migration, /PRIMARY KEY \(canonical_app_wiring_receipt_link_id\)/);
    assert.match(migration, /UNIQUE KEY uq_odbt_466_02_01 \(app_wiring_operation_id, receipt_kind\)/);
    assert.match(migration, /FOREIGN KEY \(app_wiring_operation_id\) REFERENCES canonical_app_wiring_operations \(app_wiring_operation_id\) ON DELETE RESTRICT/);
    for (const [kind, column, table] of typedReceipts) {
      assert.match(migration, new RegExp(`${column} CHAR\\(8\\) CHARACTER SET ascii COLLATE ascii_bin NULL`));
      assert.match(migration, new RegExp(`UNIQUE KEY [a-z0-9_]+ \\(${column}\\)`));
      assert.match(migration, new RegExp(`FOREIGN KEY \\(${column}\\) REFERENCES ${table} \\(${column}\\) ON DELETE RESTRICT`));
      assert.match(migration, new RegExp(`receipt_kind = '${kind}' AND ${column} IS NOT NULL`));
    }
    assert.match(migration, /\(daily_prayer_operation_id IS NOT NULL\) \+ [\s\S]*\(player_identity_operation_id IS NOT NULL\) = 1/);
    assert.match(migration, /result_fingerprint REGEXP '\^\[0-9a-f\]\{64\}\$'/);
    assert.match(migration, /Equality with the selected heterogeneous operation table's fingerprint is a runtime insert\/replay responsibility/);
    assert.equal([...migration.matchAll(/(?:INSERT|UPDATE)_(?:USER|TIME) (?:VARCHAR\(100\)|CHAR\(19\)) NOT NULL/g)].length, 4);
    assert.equal([...migration.matchAll(/chk_odbt_466_02_(?:insert|update)_time CHECK/g)].length, 2);
  });

  it("rolls back the link table, constraints, indexes, and columns in exact reverse order", () => {
    const expected = [
      "DROP TABLE IF EXISTS canonical_app_wiring_receipt_links",
      "ALTER TABLE IF EXISTS canonical_app_wiring_operations",
      ...Array.from({ length: 16 }, (_, index) => `DROP CONSTRAINT IF EXISTS chk_odbt_466_01_rule_${String(16 - index).padStart(2, "0")}`),
      "DROP INDEX IF EXISTS ix_odbt_466_01_02",
      "DROP INDEX IF EXISTS ix_odbt_466_01_01",
      "DROP COLUMN IF EXISTS recovery_code",
      "DROP COLUMN IF EXISTS recovery_status",
      "DROP COLUMN IF EXISTS attempt_count",
      "DROP COLUMN IF EXISTS lease_expires_time",
      "DROP COLUMN IF EXISTS lease_generation",
      "DROP COLUMN IF EXISTS lease_token",
      "DROP COLUMN IF EXISTS effect_mode"
    ];
    const positions = expected.map((fragment) => position(rollback, fragment));
    assert.deepEqual(positions, positions.slice().sort((left, right) => left - right));
  });
});
