import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { GuildRankTitleDefinitionReadModel } from "../src/guild/guild-rank-title-definition-read-model.js";
import {
  GUILD_RANK_TITLE_DEFINITIONS,
  GUILD_RANK_TITLE_SOURCE_HASH,
} from "./fixtures/guild-rank-title-definition-version.fixture.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migration = readFileSync(resolve(root, "migrations/407_guild_rank_title_definition_version.sql"), "utf8");
const rollback = readFileSync(resolve(root, "migrations/rollback/407_guild_rank_title_definition_version.sql"), "utf8");

test("guild rank source freezes 19 singleton ranges and one open-ended range", () => {
  assert.equal(GUILD_RANK_TITLE_DEFINITIONS.length, 20);
  assert.equal(new Set(GUILD_RANK_TITLE_DEFINITIONS.map((row) => row.stableCode)).size, 20);
  assert.equal(GUILD_RANK_TITLE_DEFINITIONS.filter((row) => row.maximumRank === null).length, 1);
  assert.deepEqual(GUILD_RANK_TITLE_DEFINITIONS.at(-1), {
    sourceRow: 20,
    stableCode: "GUILD-RANK-020-PLUS",
    displayName: "외곽민◻︎",
    minimumRank: 20,
    maximumRank: null,
    policyCode: "GUILD_RANK_TITLE",
    policyVersion: 1,
    lifecycle: "ACTIVE",
  });
});

test("read model resolves exact boundaries without display-name merging", () => {
  const model = new GuildRankTitleDefinitionReadModel(GUILD_RANK_TITLE_DEFINITIONS);
  assert.equal(model.resolve(1)?.displayName, "황제☬");
  assert.equal(model.resolve(19)?.displayName, "떠돌이◇");
  assert.equal(model.resolve(20)?.stableCode, "GUILD-RANK-020-PLUS");
  assert.equal(model.resolve(999)?.stableCode, "GUILD-RANK-020-PLUS");
  assert.equal(model.resolve(0), null);
});

test("migration407 is additive, identity-based, idempotent, and reversible", () => {
  assert.match(migration, /source_scope[\s\S]*'GUILD_RANK'/);
  assert.match(migration, /definition_version[\s\S]*1/);
  assert.match(migration, new RegExp(GUILD_RANK_TITLE_SOURCE_HASH));
  assert.match(migration, /ON DUPLICATE KEY UPDATE/g);
  assert.doesNotMatch(migration, /INSERT\s+INTO\s+(?:player_titles|player_title_instances|pet_titles|player_pet_title_instances|mini_pet_title_assignments)/i);
  assert.match(rollback, /DELETE FROM title_definition_catalog_entries/);
  assert.match(rollback, /DELETE FROM guild_rank_title_definitions/);
  assert.match(rollback, /NOT EXISTS[\s\S]*player_titles/);
});
