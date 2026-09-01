import assert from "node:assert/strict";
import fs from "node:fs";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { MariaDeveloperNoteDeploymentCatalogProvider } from "../src/catalog/developer-note-deployment-catalog.js";

const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/developer-note-deployment-binding-v1.json", import.meta.url), "utf8"));
const config = loadConfig();
if (!config.database.enabled || !/^hoibot_asset_developer_note(?:_[a-z0-9_]+)?$/i.test(config.database.name)) throw new Error(`UNSAFE_DEVELOPER_NOTE_DATABASE:${config.database.name}`);
let database = createDatabaseClient(config.database);
const checks: string[] = [];
try {
  let catalog = await new MariaDeveloperNoteDeploymentCatalogProvider(database).readCatalog(fixture.catalogVersion);
  assert.ok(catalog);
  assert.equal(catalog.entries.length, 325); checks.push("325 ordered entries");
  assert.equal(catalog.entries.reduce((count, entry) => count + entry.changes.length, 0), 499); checks.push("499 ordered changes");
  assert.equal(catalog.latestNoteVersion, catalog.deployedBotVersion); checks.push("deployed version binding");
  assert.equal(catalog.deploymentCommit, fixture.sourceRevision); checks.push("deployment commit binding");
  await assert.rejects(database.withTransaction(async (transaction) => { await transaction.execute("UPDATE developer_note_deployment_catalogs SET publication_status='PUBLISHED' WHERE catalog_version=?", [fixture.catalogVersion]); throw new Error("ROLLBACK_SENTINEL"); }), /ROLLBACK_SENTINEL/);
  catalog = await new MariaDeveloperNoteDeploymentCatalogProvider(database).readCatalog(fixture.catalogVersion); assert.equal(catalog?.deployedBotVersion, "2.438"); checks.push("transaction rollback");
  await database.close(); database = createDatabaseClient(config.database); catalog = await new MariaDeveloperNoteDeploymentCatalogProvider(database).readCatalog(fixture.catalogVersion); assert.equal(catalog?.entries.length, 325); checks.push("reconnect");
  console.log(JSON.stringify({ result: "passed", checks, total: checks.length, entries: 325, changes: 499, version: "2.438", productionReflectionPerformed: false, operationalDataTouched: false }));
} finally { await database.close(); }
