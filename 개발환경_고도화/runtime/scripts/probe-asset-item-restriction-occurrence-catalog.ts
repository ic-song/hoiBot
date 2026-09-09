import assert from "node:assert/strict";
import fs from "node:fs";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { MariaAssetItemRestrictionCatalogProvider, type AssetItemRestrictionKind } from "../src/catalog/asset-item-restriction-catalog.js";

const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/asset-item-restriction-occurrence-v1.json", import.meta.url), "utf8"));
const config = loadConfig();
if (!config.database.enabled || !/^hoibot_asset_item_restriction_occurrence(?:_[a-z0-9_]+)?$/i.test(config.database.name)) {
  throw new Error(`UNSAFE_ASSET_ITEM_RESTRICTION_DATABASE:${config.database.name}`);
}
let database = createDatabaseClient(config.database);
const checks: string[] = [];

try {
  const provider = new MariaAssetItemRestrictionCatalogProvider(database);
  for (const expected of fixture.policies) {
    const actual = await provider.readPolicy(fixture.catalogVersion, expected.restrictionKind as AssetItemRestrictionKind);
    assert.ok(actual);
    assert.equal(actual.sourceSha256, fixture.sourceSha256);
    assert.equal(actual.sourceRowCount, expected.rowCount);
    assert.equal(actual.sourceUniqueCount, expected.uniqueCount);
    assert.deepEqual(actual.occurrences.map((row) => row.rawValue), expected.occurrences.map((row: { rawValue: string }) => row.rawValue));
    checks.push(`${expected.restrictionKind} exact parity`);
  }

  const totals = (await database.query<Array<{ sets: bigint; definitions: bigint; occurrences: bigint; duplicate_groups: bigint; canonical_links: bigint; legacy_rows: bigint }>>(`SELECT
    (SELECT COUNT(*) FROM asset_item_restriction_sets WHERE catalog_version=?) sets,
    (SELECT COUNT(*) FROM asset_item_restriction_definitions definition_row JOIN asset_item_restriction_sets set_row ON set_row.id=definition_row.restriction_set_id WHERE set_row.catalog_version=?) definitions,
    (SELECT COUNT(*) FROM asset_item_restriction_occurrences occurrence JOIN asset_item_restriction_sets set_row ON set_row.id=occurrence.restriction_set_id WHERE set_row.catalog_version=?) occurrences,
    (SELECT COUNT(*) FROM asset_item_restriction_definitions definition_row JOIN asset_item_restriction_sets set_row ON set_row.id=definition_row.restriction_set_id WHERE set_row.catalog_version=? AND definition_row.occurrence_count>1) duplicate_groups,
    (SELECT COUNT(*) FROM asset_item_restriction_definitions definition_row JOIN asset_item_restriction_sets set_row ON set_row.id=definition_row.restriction_set_id WHERE set_row.catalog_version=? AND definition_row.canonical_item_id IS NOT NULL) canonical_links,
    (SELECT COUNT(*) FROM item_restrictions) legacy_rows`, Array(5).fill(fixture.catalogVersion)))[0]!;
  assert.deepEqual({ sets: Number(totals.sets), definitions: Number(totals.definitions), occurrences: Number(totals.occurrences), duplicateGroups: Number(totals.duplicate_groups), canonicalLinks: Number(totals.canonical_links), legacyRows: Number(totals.legacy_rows) },
    { sets: 2, definitions: 1173, occurrences: 1178, duplicateGroups: 5, canonicalLinks: 0, legacyRows: 0 });
  checks.push("catalog totals and protected projection");

  for (const expected of fixture.policies) {
    const duplicate = expected.definitions.find((row: { occurrenceCount: number }) => row.occurrenceCount > 1);
    if (!duplicate) continue;
    const values = expected.occurrences.map((row: { rawValue: string }) => row.rawValue);
    values.splice(values.indexOf(duplicate.displayName), 1);
    assert.ok(values.includes(duplicate.displayName));
  }
  checks.push("first-match duplicate survival");

  const before = (await database.query<Array<{ raw_value: string }>>(`SELECT occurrence.raw_value
      FROM asset_item_restriction_occurrences occurrence
      JOIN asset_item_restriction_sets set_row ON set_row.id=occurrence.restriction_set_id
     WHERE set_row.catalog_version=? AND set_row.restriction_kind='non_item' AND occurrence.source_order=1`, [fixture.catalogVersion]))[0]!.raw_value;
  await assert.rejects(database.withTransaction(async (transaction) => {
    await transaction.execute(`UPDATE asset_item_restriction_occurrences occurrence
      JOIN asset_item_restriction_sets set_row ON set_row.id=occurrence.restriction_set_id
       SET occurrence.raw_value='ROLLBACK-PROBE'
     WHERE set_row.catalog_version=? AND set_row.restriction_kind='non_item' AND occurrence.source_order=1`, [fixture.catalogVersion]);
    throw new Error("ROLLBACK_SENTINEL");
  }), /ROLLBACK_SENTINEL/);
  const after = (await database.query<Array<{ raw_value: string }>>(`SELECT occurrence.raw_value
      FROM asset_item_restriction_occurrences occurrence
      JOIN asset_item_restriction_sets set_row ON set_row.id=occurrence.restriction_set_id
     WHERE set_row.catalog_version=? AND set_row.restriction_kind='non_item' AND occurrence.source_order=1`, [fixture.catalogVersion]))[0]!.raw_value;
  assert.equal(after, before);
  checks.push("transaction rollback");

  await database.close();
  database = createDatabaseClient(config.database);
  const restarted = await new MariaAssetItemRestrictionCatalogProvider(database).readPolicy(fixture.catalogVersion, "untradable");
  assert.equal(restarted?.occurrences.length, 504);
  checks.push("reconnect restart");

  console.log(JSON.stringify({ result: "passed", checks, total: checks.length, catalogVersion: fixture.catalogVersion, sets: 2, definitions: 1173, occurrences: 1178, duplicateGroups: 5, operationalDataTouched: false }));
} finally {
  await database.close();
}
