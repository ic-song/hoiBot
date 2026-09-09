import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { DatabaseTransaction } from "../src/database.js";
import {
  PET_ADMIN_CUSTOM_SCOPE, PET_USER_CUSTOM_SCOPE, PetTitleDefinitionLinkProvider,
  type PetTitleDefinitionLinkRepository,
} from "../src/pet/pet-title-definition-link.js";

const migration = readFileSync(new URL("../migrations/404_pet_title_definition_instance_link.sql", import.meta.url), "utf8");
const rollback = readFileSync(new URL("../../migration-control/rollback/404_pet_title_definition_instance_link.sql", import.meta.url), "utf8");
const lifecycle = readFileSync(new URL("../src/pet/pet-title-lifecycle-service.ts", import.meta.url), "utf8");

describe("pet title definition instance link", () => {
  it("keeps the legacy instance key while separating identical displays by source scope", async () => {
    const captured: Array<{ sourceScope: string; stableCode: string; definitionCode: string }> = [];
    const repository: PetTitleDefinitionLinkRepository = {
      async ensure(_transaction, input) {
        captured.push(input);
        return { ...input, titleId: BigInt(captured.length), catalogEntryId: BigInt(captured.length + 10) };
      },
    };
    const provider = new PetTitleDefinitionLinkProvider(repository);
    const tx = {} as DatabaseTransaction;
    const admin = await provider.ensureAdminCustom(tx, "같은 펫 타이틀");
    const user = await provider.ensureUserCustom(tx, "같은 펫 타이틀");
    assert.equal(admin.sourceScope, PET_ADMIN_CUSTOM_SCOPE);
    assert.equal(user.sourceScope, PET_USER_CUSTOM_SCOPE);
    assert.notEqual(admin.stableCode, user.stableCode);
    assert.notEqual(admin.definitionCode, user.definitionCode);
    assert.match(lifecycle, /legacyTitleKey = `PET_TITLE_\$\{createHash/);
  });

  it("adds only nullable definition links and backfills from source audit identity", () => {
    assert.match(migration, /ADD COLUMN IF NOT EXISTS legacy_title_definition_id[^;]+NULL/);
    assert.match(migration, /ADD COLUMN IF NOT EXISTS title_catalog_entry_id[^;]+NULL/);
    assert.match(migration, /PET_ADMIN_CUSTOM/);
    assert.match(migration, /PET_USER_CUSTOM/);
    assert.match(migration, /JSON_EXTRACT\(audit_row\.change_summary_json,'\$\.instanceKey'\)/);
    assert.match(migration, /JSON_EXTRACT\(audit_row\.change_summary_json,'\$\.instanceId'\)/);
    assert.doesNotMatch(migration, /INSERT INTO pet_titles/);
  });

  it("preserves lifecycle, version checks and the pet selection projection", () => {
    assert.match(lifecycle, /status='removed',equipped=FALSE,version=version\+1/);
    assert.match(lifecycle, /AND version=\?/);
    assert.match(lifecycle, /INSERT INTO pet_titles\(player_pet_id,title_id,acquired_at,equipped\)/);
    assert.match(lifecycle, /ON DUPLICATE KEY UPDATE equipped=TRUE/);
  });

  it("rolls back links before deleting only unreferenced dynamic definitions", () => {
    assert.ok(rollback.indexOf("DROP COLUMN IF EXISTS legacy_title_definition_id") < rollback.indexOf("DELETE FROM title_definition_catalog_entries"));
    assert.match(rollback, /projection\.title_id IS NULL AND catalog_entry\.id IS NULL/);
    assert.doesNotMatch(rollback, /DELETE FROM player_pet_title_instances/);
    assert.doesNotMatch(rollback, /DELETE FROM pet_titles/);
  });
});
