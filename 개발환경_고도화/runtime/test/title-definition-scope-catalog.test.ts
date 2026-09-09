import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import type { DatabaseClient } from "../src/database.js";
import { MariaTitleDefinitionScopeCatalogRepository } from "../src/title/maria-title-definition-scope-catalog-repository.js";
import {
  normalizeTitleAssetScope,
  TitleDefinitionScopeCatalogReadProvider,
  type TitleDefinitionScopeCatalogRepository,
} from "../src/title/title-definition-scope-catalog.js";

const migration = fs.readFileSync(new URL("../migrations/402_title_definition_scope_catalog.sql", import.meta.url), "utf8");
const rollback = fs.readFileSync(new URL("../../migration-control/rollback/402_title_definition_scope_catalog.sql", import.meta.url), "utf8");
const fixture = JSON.parse(fs.readFileSync(
  new URL("../../migration-control/fixtures/synthetic-relational/title-definition-scope-catalog-v1.json", import.meta.url),
  "utf8",
));

test("migration402 adds a versioned composite-identity catalog without changing legacy title definitions", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS title_definition_catalog_versions/);
  assert.match(migration, /UNIQUE KEY uq_title_catalog_identity\(source_scope,stable_code,definition_version,lifecycle_code\)/);
  assert.doesNotMatch(migration, /UNIQUE KEY[^\n]*\(stable_code\)/);
  assert.doesNotMatch(migration, /(?:ALTER|UPDATE|DELETE FROM)\s+title_definitions/i);
  assert.match(migration, /FROM title_definitions title_definition/);
  assert.match(migration, /ON DUPLICATE KEY UPDATE id=id/);
});

test("fixture freezes all five existing definitions while preserving source scope case", () => {
  assert.equal(fixture.headerRows, 1);
  assert.equal(fixture.definitionRows, 5);
  assert.deepEqual(fixture.sourceScopes, { PLAYER: 2, player: 3 });
  assert.deepEqual(fixture.normalizedAssetScopes, { PLAYER: 5 });
  assert.deepEqual(fixture.lifecycles, { ACTIVE: 3, RETIRED: 2 });
  assert.equal(new Set(fixture.definitions.map((row: unknown[]) => row.slice(0, 4).join("|"))).size, 5);
  assert.equal(new Set(fixture.definitions.map((row: unknown[]) => row[5])).size, 5);
  assert.equal(fixture.sameDisplayMerges, 0);
});

test("provider normalizes only asset scope filters and keeps exact source identity", async () => {
  let receivedScope = "";
  let receivedIdentity: unknown;
  const repository: TitleDefinitionScopeCatalogRepository = {
    async findPublished(_catalogCode, filter) {
      receivedScope = filter?.normalizedAssetScope ?? "";
      return { catalogCode: fixture.catalogCode, catalogVersion: 1, publishState: "PUBLISHED",
        sourceHash: fixture.sourceHash, entryCount: 5, definitions: [] };
    },
    async findPublishedDefinition(_catalogCode, identity) {
      receivedIdentity = identity;
      return undefined;
    },
  };
  const provider = new TitleDefinitionScopeCatalogReadProvider(repository);
  await provider.readPublished(undefined, { normalizedAssetScope: "mini-pet" });
  assert.equal(receivedScope, "MINI_PET");
  const identity = { sourceScope: "player", stableCode: "same-code", definitionVersion: 1, lifecycle: "ACTIVE" as const };
  await assert.rejects(() => provider.readExact(identity), /TITLE_DEFINITION_NOT_FOUND/);
  assert.deepEqual(receivedIdentity, identity);
  assert.equal(normalizeTitleAssetScope("PLAYER"), "PLAYER");
  assert.equal(normalizeTitleAssetScope("player"), "PLAYER");
});

test("Maria repository queries by the complete identity rather than display or global code", async () => {
  const calls: Array<{ sql: string; params?: readonly unknown[] }> = [];
  const database = {
    async query<T>(sql: string, params?: readonly unknown[]): Promise<T> {
      calls.push({ sql, params });
      if (calls.length === 1) return [{ id: 7n, catalog_code: fixture.catalogCode, catalog_version: 1,
        publish_state: "PUBLISHED", source_hash: fixture.sourceHash, entry_count: 5 }] as T;
      return [] as T;
    },
  } as unknown as DatabaseClient;
  await new MariaTitleDefinitionScopeCatalogRepository(database).findPublishedDefinition(fixture.catalogCode, {
    sourceScope: "player", stableCode: "TITLE-PUNCH-LEGEND", definitionVersion: 1, lifecycle: "ACTIVE",
  });
  assert.match(calls[1]!.sql, /source_scope=\? AND stable_code=\?/);
  assert.match(calls[1]!.sql, /definition_version=\? AND lifecycle_code=\?/);
  assert.doesNotMatch(calls[1]!.sql, /display_name=\?/);
  assert.deepEqual(calls[1]!.params, [7n, "player", "TITLE-PUNCH-LEGEND", 1, "ACTIVE"]);
});

test("rollback removes only migration402 catalog rows and deferred domains stay excluded", () => {
  assert.match(rollback, /DELETE entry_row[\s\S]*source_hash=/);
  assert.match(rollback, /DELETE FROM title_definition_catalog_versions/);
  assert.doesNotMatch(rollback, /(?:DELETE|UPDATE)\s+(?:FROM\s+)?(?:title_definitions|player_title_instances|player_pet_title_instances|mini_pet_title_assignments)/i);
  assert.doesNotMatch(migration, /(?:miniPetCollectionInfo|guild_rank_title_definitions|object_registry|player_title_instances|player_pet_title_instances|mini_pet_title_assignments)/);
  assert.deepEqual([fixture.consumerTransitions, fixture.miniCollectionDefinitionsSeeded, fixture.guildRankDefinitionsSeeded,
    fixture.objectLinksCreated, fixture.mutationAdminChanges, fixture.ownershipRowsMutated], [0, 0, 0, 0, 0, 0]);
});
