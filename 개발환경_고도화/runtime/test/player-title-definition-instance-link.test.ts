import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { PlayerTitleDefinitionLinkProvider } from "../src/player/player-title-definition-link.js";

const migration = fs.readFileSync(new URL("../migrations/403_player_title_definition_instance_link.sql", import.meta.url), "utf8");
const rollback = fs.readFileSync(new URL("../../migration-control/rollback/403_player_title_definition_instance_link.sql", import.meta.url), "utf8");
const adminService = fs.readFileSync(new URL("../src/admin/admin-member-title-mutate-service.ts", import.meta.url), "utf8");
const giftService = fs.readFileSync(new URL("../src/player/player-title-gift-service.ts", import.meta.url), "utf8");
const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/player-title-definition-instance-link-v1.json", import.meta.url), "utf8"));

test("migration403 links instances additively without rewriting instance truth", () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS title_catalog_entry_id/);
  assert.match(migration, /UPDATE player_title_instances instance_row[\s\S]*title_catalog_entry_id=catalog_entry\.id/);
  assert.doesNotMatch(migration, /SET instance_row\.(?:source_operation_id|source_sequence_no|display_order|status|equipped|version)=/);
  assert.doesNotMatch(migration, /(?:pet_titles|player_pet_title_instances|mini_pet|guild_rank|object_registry)/i);
});

test("admin and gift use separate source scopes and exact stable-code contracts", async () => {
  const received: Array<{ sourceScope: string; stableCode: string; displayName: string }> = [];
  const provider = new PlayerTitleDefinitionLinkProvider({ async ensure(_transaction, input) {
    received.push(input); return { titleId: 1n, catalogEntryId: 2n, ...input };
  }});
  const transaction = {} as never;
  await provider.ensureAdminCustom(transaction, fixture.dynamicDisplayName);
  await provider.ensureGift(transaction, fixture.dynamicDisplayName);
  assert.deepEqual(received, [
    { ...fixture.admin, displayName: fixture.dynamicDisplayName },
    { ...fixture.gift, displayName: fixture.dynamicDisplayName },
  ]);
  assert.notEqual(fixture.admin.stableCode, fixture.gift.stableCode);
});

test("admin and gift instances persist catalog identity and operation sequence", () => {
  assert.match(adminService, /title_catalog_entry_id/);
  assert.match(adminService, /definition\.catalogEntryId/);
  assert.match(giftService, /title_catalog_entry_id/);
  assert.match(giftService, /source_operation_id,source_sequence_no/);
  assert.match(giftService, /definition\.catalogEntryId/);
});

test("gift repeats create instances while player_titles stays a definition aggregate", () => {
  assert.match(giftService, /INSERT INTO player_title_instances/);
  assert.match(giftService, /const created = existing === undefined/);
  assert.match(giftService, /if \(existing === undefined\) \{[\s\S]*INSERT INTO player_titles/);
  assert.match(giftService, /else \{[\s\S]*UPDATE player_titles SET equipped=TRUE/);
});

test("rollback removes only migration403 links and dynamic catalog identities", () => {
  assert.match(rollback, /DROP COLUMN IF EXISTS title_catalog_entry_id/);
  assert.match(rollback, /source_scope IN \('PLAYER_ADMIN_CUSTOM','PLAYER_GIFT'\)/);
  assert.doesNotMatch(rollback, /(?:DELETE|UPDATE)\s+(?:FROM\s+)?(?:player_title_instances|player_titles|title_definitions)/i);
  assert.equal(fixture.expected.sameDisplayMerges, 0);
  assert.equal(fixture.expected.petMiniGuildObjectLinks, 0);
});
