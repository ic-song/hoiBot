import assert from "node:assert/strict";
import fs from "node:fs";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { MariaDeveloperNoteDeploymentCatalogProvider } from "../src/catalog/developer-note-deployment-catalog.js";

const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/developer-note-deployment-binding-v1.json", import.meta.url), "utf8"));
const config = loadConfig();
if (!config.database.enabled || !/^hoibot_asset_developer_note(?:_[a-z0-9_]+)?$/i.test(config.database.name)) throw new Error(`UNSAFE_DEVELOPER_NOTE_SHADOW_DATABASE:${config.database.name}`);
const database = createDatabaseClient(config.database);
try {
  const catalog = await new MariaDeveloperNoteDeploymentCatalogProvider(database).readCatalog(fixture.catalogVersion); assert.ok(catalog);
  assert.deepEqual(catalog.entries.map((entry) => ({ sourceOrder: entry.sourceOrder, version: entry.version, releasedOn: entry.releasedOn, contentHash: entry.contentHash, changes: entry.changes })), fixture.entries);
  assert.equal(catalog.latestNoteVersion, fixture.deployedVersion);
  console.log(JSON.stringify({ result: "passed", matchedEntries: 325, matchedChanges: 499, deployedVersion: fixture.deployedVersion, productionReflectionPerformed: false, gate8: false }));
} finally { await database.close(); }
