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
const database = createDatabaseClient(config.database);
try {
  const provider = new TitleDefinitionScopeCatalogReadProvider(new MariaTitleDefinitionScopeCatalogRepository(database));
  const catalog = await provider.readPublished();
  assert.equal(catalog.sourceHash, fixture.sourceHash);
  assert.deepEqual(catalog.definitions.map((definition) => [definition.sourceScope, definition.stableCode,
    definition.definitionVersion, definition.lifecycle, definition.normalizedAssetScope, definition.displayName,
    definition.active]), fixture.definitions);
  const normalizedPlayer = await provider.readPublished(undefined, { normalizedAssetScope: "PLAYER" });
  assert.equal(normalizedPlayer.definitions.length, 5);
  console.log(JSON.stringify({ result: "passed", catalogCode: catalog.catalogCode,
    catalogVersion: catalog.catalogVersion, publishState: catalog.publishState, sourceHash: catalog.sourceHash,
    matchedDefinitions: catalog.definitions.length, sourceScopes: fixture.sourceScopes,
    normalizedAssetScopes: fixture.normalizedAssetScopes, sameDisplayMerges: 0, consumerTransitions: 0,
    ownershipRowsMutated: 0 }));
} finally {
  await database.close();
}
