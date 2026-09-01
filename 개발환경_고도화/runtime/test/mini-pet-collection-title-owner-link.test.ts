import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  MiniPetCollectionTitleOwnerProvider,
  miniPetCollectionTitleStableCode,
} from "../src/mini-pet/mini-pet-collection-title-owner-provider.js";
import { MINI_PET_COLLECTION_TITLE_OWNER_FIXTURE } from "./fixtures/mini-pet-collection-title-owner-link.fixture.js";

const root = decodeURIComponent(new URL("../", import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1");
const migration = readFileSync(join(root, "migrations/406_mini_pet_collection_title_owner_link.sql"), "utf8");
const rollback = readFileSync(join(root, "migrations/rollback/406_mini_pet_collection_title_owner_link.rollback.sql"), "utf8");
const repository = readFileSync(join(root, "src/mini-pet/maria-mini-pet-collection-title-owner-repository.ts"), "utf8");

test("migration406 keeps collection ownership at player title instance level", () => {
  assert.match(migration, /player_title_instances/);
  assert.match(migration, /player_titles|title_definitions/);
  assert.doesNotMatch(migration, /INSERT\s+INTO\s+mini_pet_title_assignments/i);
  assert.equal(MINI_PET_COLLECTION_TITLE_OWNER_FIXTURE.definitionCount, 100);
  assert.equal(MINI_PET_COLLECTION_TITLE_OWNER_FIXTURE.rewardExclusionCount, 108);
});

test("migration406 rollback removes links before its compatibility source table", () => {
  const instanceDelete = rollback.indexOf("DELETE instance_row");
  const projectionDelete = rollback.indexOf("DELETE projection_row");
  const sourceDrop = rollback.indexOf("DROP TABLE IF EXISTS player_mini_pet_collection_title_sources");
  assert.ok(instanceDelete >= 0 && projectionDelete > instanceDelete && sourceDrop > projectionDelete);
  assert.doesNotMatch(rollback, /DELETE\s+FROM\s+title_definitions/i);
});

test("provider uses source scope plus stable row code instead of display-only identity", async () => {
  assert.equal(miniPetCollectionTitleStableCode(1), "MINI-PET-COLLECTION-TITLE-001");
  assert.equal(miniPetCollectionTitleStableCode(100), "MINI-PET-COLLECTION-TITLE-100");
  assert.throws(() => miniPetCollectionTitleStableCode(0));
  assert.match(repository, /source_scope = 'MINI_PET_COLLECTION'/);
  assert.match(repository, /catalog\.stable_code = \?/);
  assert.match(repository, /BINARY definition\.display_name = BINARY \?/);

  const calls: string[] = [];
  const provider = new MiniPetCollectionTitleOwnerProvider({
    execute: async (_transaction, _operationId, input) => {
      calls.push(input.action);
      return { status: "granted", playerId: input.playerId, sourceRow: 1, listIndex: 1, titleId: "1", instanceId: "1", version: "1", replayed: false };
    },
    readCompatibility: async () => [],
  });
  await provider.execute({ query: async <T>() => [] as T, execute: async () => ({ affectedRows: 0n, insertId: 0n }) }, "1", {
    eventId: "event-1", playerId: "1", action: "grant", sourceRow: 1,
    legacy: { sourceRow: 1, listIndex: 1, name: "title", inDate: "2026-08-31T00:00:00.000Z", price: "10000000000" },
  });
  assert.deepEqual(calls, ["grant"]);
});

test("repository preserves grant repeat select remove replay version and projection boundaries", () => {
  assert.match(repository, /status\(.*repeated|"repeated"/s);
  assert.match(repository, /MINI_PET_COLLECTION_TITLE_VERSION_CONFLICT/);
  assert.match(repository, /lifecycle_code = 'REMOVED'/);
  assert.match(repository, /player_title_instances/);
  assert.match(repository, /player_titles/);
  assert.doesNotMatch(repository, /mini_pet_title_assignments/);
});
