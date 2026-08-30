import assert from "node:assert/strict";
import fs from "node:fs";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { createCurrentDomainPackageRuntime } from "../src/package/current-domain-package-runtime.js";

interface Fixture { codes: string[]; objectlessCodes: string[]; forbiddenOwnershipWrites: string[]; canonicalReplacements: Record<string, string> }
interface StateRow { code: string; active: number; enabled: number }

const fixture = JSON.parse(fs.readFileSync(new URL(
  "../../migration-control/fixtures/synthetic-relational/package-canonical-item-dual-consumer-parity-v1.json",
  import.meta.url,
), "utf8")) as Fixture;
const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`missing ${name}`);
  return value;
};
const database = createDatabaseClient({
  enabled: true,
  host: required("DATABASE_HOST"),
  port: Number(required("DATABASE_PORT")),
  user: required("DATABASE_USER"),
  password: required("DATABASE_PASSWORD"),
  name: required("DATABASE_NAME"),
  connectionLimit: 2,
  connectTimeoutMs: 5_000,
});
const playerId = "900002388";
const committedRequest = "lease2388-committed";
const rollbackRequest = "lease2388-rollback";
const mutationCodes = ["ITEM-PACKAGE-209", "ITEM-RWD-042", "ITEM-RWD-065", "pet_enhance_stone"];
const checks: string[] = [];

async function scalar(sql: string, values: readonly unknown[] = []): Promise<bigint> {
  const rows = await database.query<Array<{ value: string | bigint }>>(sql, values);
  return BigInt(rows[0]?.value ?? 0);
}

async function cleanup(): Promise<void> {
  await database.execute("DELETE FROM package_item_effects WHERE player_id = ?", [playerId]);
  await database.execute("DELETE FROM inventory_ledger WHERE player_id = ?", [playerId]);
  await database.execute("DELETE FROM inventory_stacks WHERE player_id = ?", [playerId]);
  await database.execute("DELETE FROM package_domain_uses WHERE player_id = ?", [playerId]);
  await database.execute("DELETE FROM operations WHERE actor_type = 'player' AND actor_id = ?", [playerId]);
  await database.execute("DELETE FROM players WHERE id = ?", [playerId]);
}

async function legacyOwnershipCounts(): Promise<bigint[]> {
  return Promise.all(fixture.forbiddenOwnershipWrites.map((table) => scalar(`SELECT COUNT(*) AS value FROM ${table}`)));
}

try {
  const resolvedCodes = [...new Set(fixture.codes.map((code) => fixture.canonicalReplacements[code] ?? code))];
  const placeholders = resolvedCodes.map(() => "?").join(",");
  const identities = await database.query<Array<{ item_id: string; canonical_id: bigint; stackable: number }>>(
    `SELECT compatibility.item_id,canonical.id canonical_id,canonical.stackable
       FROM package_item_definitions compatibility
       JOIN item_definitions canonical ON canonical.code=compatibility.item_id
      WHERE compatibility.item_id IN (${placeholders})`, resolvedCodes,
  );
  assert.equal(
    identities.length,
    72,
    `missing canonical identities: ${resolvedCodes.filter((code) => !identities.some((row) => row.item_id === code)).join(",")}`,
  );
  assert.equal(new Set(identities.map((row) => row.canonical_id.toString())).size, 72);
  assert.equal(identities.every((row) => Boolean(row.stackable)), true);
  checks.push("B76 to 72 canonical item_definitions identities with five compatibility aliases");

  const references = await database.query<Array<{ code: string }>>(
    `SELECT DISTINCT code FROM (
       SELECT consume_item_id code FROM package_catalog
       UNION ALL SELECT item_id code FROM package_rewards WHERE item_id IS NOT NULL
       UNION ALL SELECT item_id code FROM package_reward_rules WHERE item_id IS NOT NULL
       UNION ALL SELECT item_id code FROM package_reward_bundle_items WHERE item_id IS NOT NULL
       UNION ALL SELECT asset_code code FROM package_contents WHERE asset_code IS NOT NULL
     ) package_refs WHERE code IN (${placeholders})`, resolvedCodes,
  );
  const referenceCodes = new Set(references.map((row) => row.code));
  assert.equal(
    referenceCodes.size,
    72,
    `missing package references: ${resolvedCodes.filter((code) => !referenceCodes.has(code)).join(",")}`,
  );
  checks.push("B76 package consume/reward reference");

  const objectPlaceholders = fixture.codes.map(() => "?").join(",");
  const metadataObjectRows = await database.query<Array<{ code: string; aliases: bigint; bindings: bigint }>>(
    `SELECT JSON_UNQUOTE(JSON_EXTRACT(registry.metadata_json,'$.definitionCode')) code,
            (SELECT COUNT(*) FROM object_aliases alias_row WHERE alias_row.object_id=registry.id AND alias_row.object_type=registry.object_type) aliases,
            (SELECT COUNT(*) FROM object_source_bindings binding_row WHERE binding_row.object_id=registry.id AND binding_row.object_type=registry.object_type) bindings
       FROM object_registry registry
      WHERE registry.object_type='ITEM'
        AND JSON_UNQUOTE(JSON_EXTRACT(registry.metadata_json,'$.definitionCode')) IN (${objectPlaceholders})`, fixture.codes,
  );
  const catalogObjectRows = await database.query<Array<{ code: string; aliases: bigint; bindings: bigint }>>(
    `SELECT definition_row.code,
            (SELECT COUNT(*) FROM object_aliases alias_row WHERE alias_row.object_id=registry.id AND alias_row.object_type=registry.object_type) aliases,
            (SELECT COUNT(*) FROM object_source_bindings binding_row WHERE binding_row.object_id=registry.id AND binding_row.object_type=registry.object_type) bindings
       FROM object_registry registry
       JOIN raid_item_bonus_definitions catalog_row ON catalog_row.object_id=registry.id
       JOIN item_definitions definition_row ON definition_row.id=catalog_row.item_id
      WHERE definition_row.code IN (${objectPlaceholders})
      UNION ALL
     SELECT definition_row.code,
            (SELECT COUNT(*) FROM object_aliases alias_row WHERE alias_row.object_id=registry.id AND alias_row.object_type=registry.object_type) aliases,
            (SELECT COUNT(*) FROM object_source_bindings binding_row WHERE binding_row.object_id=registry.id AND binding_row.object_type=registry.object_type) bindings
       FROM object_registry registry
       JOIN object_aliases catalog_row ON catalog_row.object_id=registry.id AND catalog_row.object_type=registry.object_type AND catalog_row.alias_type='item_code'
       JOIN item_definitions definition_row ON definition_row.code=catalog_row.alias_value
      WHERE definition_row.code IN (${objectPlaceholders})`, [...fixture.codes, ...fixture.codes],
  );
  const objectRows = [...metadataObjectRows, ...catalogObjectRows];
  assert.equal(objectRows.length, 61);
  assert.equal(objectRows.reduce((sum, row) => sum + Number(row.aliases), 0), 60);
  assert.equal(objectRows.reduce((sum, row) => sum + Number(row.bindings), 0), 72);
  const objectCodes = new Set(objectRows.map((row) => row.code));
  assert.deepEqual(fixture.objectlessCodes.filter((code) => objectCodes.has(code)), []);
  checks.push("object61 alias/source preservation and objectless15 zero");

  await cleanup();
  await database.execute("INSERT INTO players(id,status,version,created_at,updated_at) VALUES (?, 'active', 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))", [playerId]);
  await database.execute("UPDATE package_catalog SET definition_status='READY',enabled=1 WHERE package_id='PKG-209'");
  await database.execute(`UPDATE package_item_definitions SET enabled=1 WHERE item_id IN (${mutationCodes.map(() => "?").join(",")})`, mutationCodes);
  await database.execute(`UPDATE item_definitions SET active=1 WHERE code IN (${mutationCodes.map(() => "?").join(",")})`, mutationCodes);
  await database.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) SELECT ?,id,2,1 FROM item_definitions WHERE code='ITEM-PACKAGE-209'", [playerId]);
  const legacyBefore = await legacyOwnershipCounts();
  const runtime = createCurrentDomainPackageRuntime(database);
  const committed = await runtime.packages.use({ requestKey: committedRequest, userId: playerId, packageId: "PKG-209", openCount: 1 });
  assert.deepEqual(committed, { packageId: "PKG-209", openCount: 1, rewardCount: 3 });
  const ledgerAfterCommit = await scalar("SELECT COUNT(*) AS value FROM inventory_ledger WHERE player_id=?", [playerId]);
  assert.equal(ledgerAfterCommit, 4n);
  assert.equal(await scalar(`SELECT COUNT(*) AS value FROM inventory_stacks stack_row JOIN item_definitions definition_row ON definition_row.id=stack_row.item_id WHERE stack_row.player_id=? AND definition_row.code IN (${mutationCodes.map(() => "?").join(",")})`, [playerId, ...mutationCodes]), 4n);
  assert.deepEqual(await legacyOwnershipCounts(), legacyBefore);
  checks.push("inventory stack/ledger commit and legacy ownership writes zero");

  const replay = await createCurrentDomainPackageRuntime(database).packages.use({ requestKey: committedRequest, userId: playerId, packageId: "PKG-209", openCount: 1 });
  assert.deepEqual(replay, committed);
  assert.equal(await scalar("SELECT COUNT(*) AS value FROM inventory_ledger WHERE player_id=?", [playerId]), ledgerAfterCommit);
  assert.deepEqual(await legacyOwnershipCounts(), legacyBefore);
  checks.push("exact idempotent replay");

  const consumerBefore = await scalar("SELECT quantity AS value FROM inventory_stacks stack_row JOIN item_definitions definition_row ON definition_row.id=stack_row.item_id WHERE stack_row.player_id=? AND definition_row.code='ITEM-PACKAGE-209'", [playerId]);
  await database.execute("UPDATE item_definitions SET active=0 WHERE code='pet_enhance_stone'");
  try {
    await assert.rejects(
      createCurrentDomainPackageRuntime(database).packages.use({ requestKey: rollbackRequest, userId: playerId, packageId: "PKG-209", openCount: 1 }),
      /ITEM_NOT_AVAILABLE:pet_enhance_stone/,
    );
  } finally {
    await database.execute("UPDATE item_definitions SET active=1 WHERE code='pet_enhance_stone'");
  }
  assert.equal(await scalar("SELECT quantity AS value FROM inventory_stacks stack_row JOIN item_definitions definition_row ON definition_row.id=stack_row.item_id WHERE stack_row.player_id=? AND definition_row.code='ITEM-PACKAGE-209'", [playerId]), consumerBefore);
  assert.equal(await scalar("SELECT COUNT(*) AS value FROM inventory_ledger WHERE player_id=?", [playerId]), ledgerAfterCommit);
  assert.equal(await scalar("SELECT COUNT(*) AS value FROM package_domain_uses WHERE request_key=?", [rollbackRequest]), 0n);
  assert.deepEqual(await legacyOwnershipCounts(), legacyBefore);
  checks.push("transaction rollback and legacy ownership writes zero");

  console.log(JSON.stringify({ result: "passed", checks, total: checks.length, b: 76, objects: 61, objectless: 15, legacyOwnershipWrites: 0 }));
} finally {
  await cleanup().catch(() => undefined);
  await database.close();
}
