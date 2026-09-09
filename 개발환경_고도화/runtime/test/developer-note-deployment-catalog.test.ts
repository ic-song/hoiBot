import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { MariaDeveloperNoteDeploymentCatalogProvider } from "../src/catalog/developer-note-deployment-catalog.js";

const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/developer-note-deployment-binding-v1.json", import.meta.url), "utf8"));
const migration = fs.readFileSync(new URL("../migrations/422_developer_note_deployment_binding.sql", import.meta.url), "utf8");
const rollback = fs.readFileSync(new URL("../../migration-control/rollback/422_developer_note_deployment_binding.sql", import.meta.url), "utf8");

describe("developer-note deployment binding", () => {
  it("pins the approved source and deployed main revision", () => {
    assert.equal(fixture.sourceRevision, "5925b83b1dbfb78ef583354604e112b9430003f3");
    assert.equal(fixture.sourceGitObjectSha256, "f8b81bc64654acef926dfec92a00968937df9d8397a5463cfd70d37427b0e7f9");
    assert.equal(fixture.mainGitObjectSha256, "a6527cde8df4e413e3296da976b89a95f49101dfc0f5c226e822a17e91b5fb07");
  });
  it("preserves 325 entries, 499 changes, unique versions, and order", () => {
    assert.deepEqual(fixture.counts, { entries: 325, changes: 499, duplicateVersions: 0 });
    assert.equal(new Set(fixture.entries.map((row: { version: string }) => row.version)).size, 325);
    assert.deepEqual(fixture.entries.map((row: { sourceOrder: number }) => row.sourceOrder), Array.from({ length: 325 }, (_, index) => index + 1));
  });
  it("fails closed unless latest note and deployed versions are identical", () => {
    assert.equal(fixture.entries[0].version, "2.438");
    assert.equal(fixture.deployedVersion, "2.438");
    assert.match(migration, /CHECK \(latest_note_version=deployed_bot_version\)/);
  });
  it("uses the existing developer-note definitions without changing its read consumer", () => {
    assert.match(migration, /INSERT INTO developer_note_entries/);
    assert.match(migration, /INSERT INTO developer_note_changes/);
    assert.doesNotMatch(migration, /command_registry|command_aliases|admin_permissions|outbox_messages|inventory_|currency_/i);
  });
  it("is transactional, idempotent, and narrowly reversible", () => {
    assert.match(migration, /^SET NAMES utf8mb4;\s*START TRANSACTION;/);
    assert.equal((migration.match(/ON DUPLICATE KEY UPDATE/g) ?? []).length, 4);
    assert.match(migration, /COMMIT;\s*$/);
    assert.match(rollback, /DROP TABLE IF EXISTS developer_note_deployment_entries/);
    assert.doesNotMatch(rollback, /command_registry|inventory_|currency_/i);
  });
  it("reads the complete immutable deployment projection", async () => {
    const rows = fixture.entries.flatMap((entry: Record<string, unknown>) => (entry.changes as string[]).map((change, index) => ({ source_order: BigInt(entry.sourceOrder as number), version: entry.version, released_on: entry.releasedOn, content_hash: entry.contentHash, change_index: BigInt(index), change_text: change })));
    const query = async <T>(sql: string): Promise<T> => sql.includes("FROM developer_note_deployment_catalogs") ? [{ id: 1n, catalog_version: fixture.catalogVersion, source_revision: fixture.sourceRevision, source_path: fixture.sourcePath, source_sha256: fixture.sourceGitObjectSha256, main_sha256: fixture.mainGitObjectSha256, entry_count: 325n, change_count: 499n, latest_note_version: "2.438", deployed_bot_version: "2.438", deployment_commit: fixture.deploymentCommit, publication_status: "SHADOW" }] as T : rows as T;
    const result = await new MariaDeveloperNoteDeploymentCatalogProvider({ query }).readCatalog(fixture.catalogVersion);
    assert.equal(result?.entries.length, 325);
    assert.equal(result?.entries.reduce((count, entry) => count + entry.changes.length, 0), 499);
    assert.equal(result?.latestNoteVersion, result?.deployedBotVersion);
  });
  it("keeps production reflection, Gate 8, and legacy data outside this slice", () => {
    assert.equal(fixture.deploymentCommit, fixture.sourceRevision);
    assert.doesNotMatch(migration, /feature\/prod|UPDATE\s+developer_note_entries|DELETE\s+FROM/i);
  });
});
