import assert from "node:assert/strict";
import fs from "node:fs";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { MariaTitleDefinitionScopeCatalogRepository } from "../src/title/maria-title-definition-scope-catalog-repository.js";
import { TitleDefinitionScopeCatalogReadProvider } from "../src/title/title-definition-scope-catalog.js";

const fixture = JSON.parse(fs.readFileSync(
  new URL("../../migration-control/fixtures/synthetic-relational/title-definition-scope-catalog-v1.json", import.meta.url),
  "utf8",
));
const config = loadConfig();
if (!config.database.enabled || config.database.name !== "hoibot_title_scope_catalog_probe") {
  throw new Error(`Blocked database:${config.database.name}`);
}
let database = createDatabaseClient(config.database);
const checks: string[] = [];

async function verify() {
  const provider = new TitleDefinitionScopeCatalogReadProvider(new MariaTitleDefinitionScopeCatalogRepository(database));
  const catalog = await provider.readPublished();
  assert.equal(catalog.catalogVersion, fixture.catalogVersion);
  assert.equal(catalog.publishState, fixture.publishState);
  assert.equal(catalog.sourceHash, fixture.sourceHash);
  assert.equal(catalog.entryCount, fixture.definitionRows);
  assert.deepEqual(catalog.definitions.map((definition) => [definition.sourceScope, definition.stableCode,
    definition.definitionVersion, definition.lifecycle, definition.normalizedAssetScope, definition.displayName,
    definition.active]), fixture.definitions);
  checks.push("repository exact five-definition parity");

  const exact = await provider.readExact({ sourceScope: "player", stableCode: "TITLE-PUNCH-LEGEND",
    definitionVersion: 1, lifecycle: "ACTIVE" });
  assert.equal(exact.displayName, "👑전설의 핵주먹");
  const player = await provider.readPublished(undefined, { normalizedAssetScope: "player" });
  assert.equal(player.definitions.length, 5);
  checks.push("case-compatible asset scope and exact source identity");

  const counts = (await database.query<Array<Record<string, bigint>>>(`SELECT
    (SELECT COUNT(*) FROM title_definition_catalog_versions WHERE catalog_code='TITLE_DEFINITION_SCOPE_LEGACY' AND catalog_version=1 AND publish_state='PUBLISHED' AND source_hash=?) headers,
    (SELECT COUNT(*) FROM title_definition_catalog_entries entry_row JOIN title_definition_catalog_versions version_row ON version_row.id=entry_row.catalog_version_id WHERE version_row.source_hash=?) definitions,
    (SELECT COUNT(DISTINCT legacy_title_definition_id) FROM title_definition_catalog_entries) legacy_links,
    (SELECT COUNT(*) FROM title_definition_catalog_entries WHERE source_scope='PLAYER') upper_source_scope,
    (SELECT COUNT(*) FROM title_definition_catalog_entries WHERE BINARY source_scope=BINARY 'player') lower_source_scope,
    (SELECT COUNT(*) FROM title_definition_catalog_entries WHERE normalized_asset_scope='PLAYER') normalized_player,
    (SELECT COUNT(*) FROM title_definitions) legacy_definitions,
    (SELECT COUNT(*) FROM player_title_instances) player_ownership,
    (SELECT COUNT(*) FROM player_pet_title_instances) pet_ownership,
    (SELECT COUNT(*) FROM mini_pet_title_assignments) mini_pet_ownership`, [fixture.sourceHash, fixture.sourceHash]))[0]!;
  const numeric = Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, Number(value)]));
  assert.deepEqual(numeric, { headers: 1, definitions: 5, legacy_links: 5, upper_source_scope: 2,
    lower_source_scope: 3, normalized_player: 5, legacy_definitions: 5, player_ownership: 0,
    pet_ownership: 0, mini_pet_ownership: 0 });
  checks.push("additive ownership boundary and source scope counts");
  assert.equal(await database.verifyRollback(), true);
  checks.push("transaction rollback");
  return numeric;
}

try {
  const counts = await verify();
  await database.close();
  database = createDatabaseClient(config.database);
  const reconnect = await new TitleDefinitionScopeCatalogReadProvider(
    new MariaTitleDefinitionScopeCatalogRepository(database),
  ).readPublished();
  assert.equal(reconnect.definitions.length, 5);
  checks.push("reconnect");
  console.log(JSON.stringify({ result: "passed", checks, total: checks.length, counts, sourceHash: reconnect.sourceHash }));
} finally {
  await database.close();
}
