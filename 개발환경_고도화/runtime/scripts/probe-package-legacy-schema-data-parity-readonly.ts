import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import mariadb, { type Connection } from "mariadb";

type Fixture = {
  databaseBoundary: { migrationCount: number; oldTables: string[]; currentTables: string[]; readOnly: boolean };
  counts: Record<string, number>;
  activeRows: { catalog: string[]; effectiveRewards: string[] };
  hashes: Record<string, string>;
  dropAssessment: { dropReady: boolean };
};
type Snapshot = {
  readOnly: number;
  counts: Record<string, number>;
  activeRows: { catalog: string[]; effectiveRewards: string[] };
  hashes: Record<string, string>;
};

const fixture = JSON.parse(readFileSync(new URL(
  "../../migration-control/fixtures/synthetic-relational/package-legacy-schema-data-parity-v1.json",
  import.meta.url,
), "utf8")) as Fixture;
const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`missing ${name}`);
  return value;
};
const sha256 = (rows: readonly string[]): string => createHash("sha256").update(rows.join("\n"), "utf8").digest("hex");

async function open(): Promise<Connection> {
  return mariadb.createConnection({
    host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"),
    password: required("DATABASE_PASSWORD"), database: required("DATABASE_NAME"), connectTimeout: 5_000,
    bigIntAsNumber: false, decimalAsNumber: false, charset: "utf8mb4", timezone: "Z",
  });
}

async function count(connection: Connection, sql: string): Promise<number> {
  const rows = await connection.query<Array<{ value: bigint | number | string }>>(sql);
  return Number(rows[0]?.value ?? 0);
}

async function takeSnapshot(): Promise<Snapshot> {
  const connection = await open();
  await connection.query("SET SESSION TRANSACTION READ ONLY");
  await connection.query("START TRANSACTION");
  try {
    const readOnlyRows = await connection.query<Array<{ value: bigint | number | string }>>("SELECT @@session.tx_read_only value");
    const counts: Record<string, number> = {
      oldDefinitions: await count(connection, "SELECT COUNT(*) value FROM package_definitions"),
      oldActiveDefinitions: await count(connection, "SELECT COUNT(*) value FROM package_definitions WHERE active=1"),
      oldContents: await count(connection, "SELECT COUNT(*) value FROM package_contents"),
      oldPurchases: await count(connection, "SELECT COUNT(*) value FROM package_purchases"),
      currentCatalogTotal: await count(connection, "SELECT COUNT(*) value FROM package_catalog"),
      currentActiveCatalog: await count(connection, "SELECT COUNT(*) value FROM package_catalog WHERE enabled=1 AND definition_status='READY'"),
      currentEnabledRules: await count(connection, "SELECT COUNT(*) value FROM package_reward_rules WHERE enabled=1"),
      currentEffectiveRules: await count(connection, "SELECT COUNT(*) value FROM package_reward_rules r JOIN package_catalog c ON c.package_id=r.package_id WHERE r.enabled=1 AND c.enabled=1 AND c.definition_status='READY'"),
      directStableMappings: await count(connection, "SELECT COUNT(*) value FROM package_definitions d JOIN package_catalog c ON c.package_id=d.code"),
      oldActiveWithoutCurrent: await count(connection, "SELECT COUNT(*) value FROM package_definitions d LEFT JOIN package_catalog c ON c.package_id=d.code AND c.enabled=1 AND c.definition_status='READY' WHERE d.active=1 AND c.package_id IS NULL"),
      currentActiveWithoutOld: await count(connection, "SELECT COUNT(*) value FROM package_catalog c LEFT JOIN package_definitions d ON d.code=c.package_id WHERE c.enabled=1 AND c.definition_status='READY' AND d.id IS NULL"),
      sourceBackedCurrentWithoutOld: await count(connection, "SELECT COUNT(*) value FROM package_catalog c LEFT JOIN package_definitions d ON d.code=c.package_id WHERE c.enabled=1 AND c.definition_status='READY' AND d.id IS NULL AND c.source_legacy_command IS NOT NULL"),
      oldContentOrphans: await count(connection, "SELECT COUNT(*) value FROM package_contents x LEFT JOIN package_definitions d ON d.id=x.package_id WHERE d.id IS NULL"),
      oldPurchaseOrphans: await count(connection, "SELECT COUNT(*) value FROM package_purchases p LEFT JOIN package_definitions d ON d.id=p.package_id WHERE d.id IS NULL"),
      currentRuleOrphans: await count(connection, "SELECT COUNT(*) value FROM package_reward_rules r LEFT JOIN package_catalog c ON c.package_id=r.package_id WHERE r.enabled=1 AND c.package_id IS NULL"),
      oldCodeDuplicates: await count(connection, "SELECT COUNT(*) value FROM (SELECT code FROM package_definitions GROUP BY code HAVING COUNT(*)>1) q"),
      currentPackageDuplicates: await count(connection, "SELECT COUNT(*) value FROM (SELECT package_id FROM package_catalog GROUP BY package_id HAVING COUNT(*)>1) q"),
      currentRuleIdDuplicates: await count(connection, "SELECT COUNT(*) value FROM (SELECT rule_id FROM package_reward_rules GROUP BY rule_id HAVING COUNT(*)>1) q"),
      oldSequenceGaps: await count(connection, "SELECT COUNT(*) value FROM (SELECT package_id FROM package_contents GROUP BY package_id HAVING MIN(sequence_no)<>1 OR MAX(sequence_no)<>COUNT(*)) q"),
      currentEffectiveSequenceGaps: await count(connection, "SELECT COUNT(*) value FROM (SELECT r.package_id FROM package_reward_rules r JOIN package_catalog c ON c.package_id=r.package_id WHERE r.enabled=1 AND c.enabled=1 AND c.definition_status='READY' GROUP BY r.package_id HAVING MIN(r.reward_order)<>1 OR MAX(r.reward_order)<>COUNT(*)) q"),
      mappedSequenceMismatches: await count(connection, "SELECT COUNT(*) value FROM package_definitions d JOIN package_catalog c ON c.package_id=d.code JOIN package_contents x ON x.package_id=d.id LEFT JOIN package_reward_rules r ON r.package_id=c.package_id AND r.reward_order=x.sequence_no AND r.enabled=1 WHERE d.active=1 AND c.enabled=1 AND c.definition_status='READY' AND (r.rule_id IS NULL OR r.item_id<>x.asset_code OR CAST(r.quantity AS DECIMAL(30,3))<>x.quantity)"),
      runtimeSourceRefs: 0,
    };
    const catalogRows = await connection.query<Array<{ package_id: string; catalog_version: string; consume_item_id: string; max_open_count: number; definition_status: string; enabled: number }>>(
      "SELECT package_id,catalog_version,consume_item_id,max_open_count,definition_status,enabled FROM package_catalog WHERE enabled=1 AND definition_status='READY' ORDER BY package_id",
    );
    const rewardRows = await connection.query<Array<{ package_id: string; reward_order: number; operation: string; owner_scope: string; item_id: string | null; quantity: string; enabled: number }>>(
      "SELECT r.package_id,r.reward_order,r.operation,r.owner_scope,r.item_id,CAST(r.quantity AS CHAR) quantity,r.enabled FROM package_reward_rules r JOIN package_catalog c ON c.package_id=r.package_id WHERE r.enabled=1 AND c.enabled=1 AND c.definition_status='READY' ORDER BY r.package_id,r.reward_order,r.rule_id",
    );
    const oldDefinitionRows = await connection.query<Array<{ row_value: string }>>("SELECT CONCAT_WS('|',code,display_name,COALESCE(price_currency_code,''),COALESCE(CAST(price_amount AS CHAR),''),COALESCE(CAST(purchase_limit AS CHAR),''),active) row_value FROM package_definitions ORDER BY code");
    const oldContentRows = await connection.query<Array<{ row_value: string }>>("SELECT CONCAT_WS('|',d.code,x.sequence_no,x.asset_type_code,x.asset_code,CAST(x.quantity AS CHAR)) row_value FROM package_contents x JOIN package_definitions d ON d.id=x.package_id ORDER BY d.code,x.sequence_no");
    const oldPurchaseRows = await connection.query<Array<{ row_value: string }>>("SELECT CONCAT_WS('|',p.id,p.operation_id,d.code,p.player_id,p.quantity,DATE_FORMAT(p.purchased_at,'%Y-%m-%dT%H:%i:%s.%fZ')) row_value FROM package_purchases p JOIN package_definitions d ON d.id=p.package_id ORDER BY p.id");
    const mappingRows = await connection.query<Array<{ row_value: string }>>("SELECT CONCAT_WS('|',d.code,c.package_id) row_value FROM package_definitions d JOIN package_catalog c ON c.package_id=d.code ORDER BY d.code");
    const activeRows = {
      catalog: catalogRows.map((row) => [row.package_id, row.catalog_version, row.consume_item_id, row.max_open_count, row.definition_status, row.enabled].join("|")),
      effectiveRewards: rewardRows.map((row) => [row.package_id, row.reward_order, row.operation, row.owner_scope, row.item_id ?? "", row.quantity, row.enabled].join("|")),
    };
    return {
      readOnly: Number(readOnlyRows[0]?.value ?? 0), counts, activeRows,
      hashes: {
        oldDefinitionsSha256: sha256(oldDefinitionRows.map((row) => row.row_value)),
        oldContentsSha256: sha256(oldContentRows.map((row) => row.row_value)),
        oldPurchasesSha256: sha256(oldPurchaseRows.map((row) => row.row_value)),
        activeCatalogSha256: sha256(activeRows.catalog),
        effectiveRewardsSha256: sha256(activeRows.effectiveRewards),
        directMappingsSha256: sha256(mappingRows.map((row) => row.row_value)),
      },
    };
  } finally {
    await connection.rollback();
    await connection.end();
  }
}

const first = await takeSnapshot();
const reconnect = await takeSnapshot();
assert.equal(first.readOnly, 1);
assert.deepEqual(reconnect, first);
assert.deepEqual(first.counts, fixture.counts);
assert.deepEqual(first.activeRows, fixture.activeRows);
for (const [key, value] of Object.entries(first.hashes)) assert.equal(value, fixture.hashes[key], key);
assert.equal(fixture.dropAssessment.dropReady, false);
process.stdout.write(`${JSON.stringify({ ...first, reconnectEqual: true, dropReady: false })}\n`);
process.stdout.write("package-legacy-schema-data-parity-shadow readonly=1 reconnect=1 drop-ready=0\n");
