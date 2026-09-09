import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/pet-explore-notice-catalog-v2438.json", import.meta.url), "utf8"));
const migration = fs.readFileSync(new URL("../migrations/430_pet_explore_notice_catalog.sql", import.meta.url), "utf8");
const rollback = fs.readFileSync(new URL("../../migration-control/rollback/430_pet_explore_notice_catalog.sql", import.meta.url), "utf8");

describe("pet explore notice catalog", () => {
  it("pins the approved and baseline Git objects", () => {
    assert.equal(fixture.sourceRevision, "5925b83b1dbfb78ef583354604e112b9430003f3");
    assert.equal(fixture.sourceGitSha256, "5fd232c3840eb2a6b9628e703f505a9a1f98becd265c70b0914d524a3e4ba7f7");
    assert.equal(fixture.baselineGitSha256, "bc0138e8eacf4f71dae37405f6fb51d8f0e7627937c40ea422a014c7b5db4add");
    assert.equal(fixture.baselineNotice, "탐험하라");
  });

  it("preserves the exact three-line notice", () => {
    assert.equal(fixture.notice.value, "[🎇이벤트 진행중🎇]\n👾 길드레이드던전 이벤트 안내\nhttps://hoiland123.tistory.com/679");
    assert.deepEqual({ utf16Length: fixture.notice.utf16Length, utf8Bytes: fixture.notice.utf8Bytes, lineCount: fixture.notice.lineCount }, { utf16Length: 66, utf8Bytes: 108, lineCount: 3 });
    assert.equal(fixture.notice.valueSha256, "502c02bb0a67cee3b81a29ea939f069ef5b7e2527f5c7a925ec9461917fbfeb0");
  });

  it("binds to the existing operation notice configuration model", () => {
    assert.deepEqual(fixture.providerBinding, { setCode: "operation_notices", headTable: "operation_notice_heads", configurationTable: "configuration_values", mutationScope: "operation.notice.mutate", mode: "EXISTING_PROVIDER_DEPENDENCY" });
    assert.match(migration, /active_configuration_set_id FROM operation_notice_heads WHERE set_code='operation_notices'/);
    assert.match(migration, /'notice\.pet_explore','string'/);
  });

  it("keeps the frozen catalog linked to the exact seeded value", () => {
    assert.match(migration, /BINARY value_row\.string_value=BINARY '\[🎇이벤트 진행중🎇\]/);
    assert.match(migration, /configuration_set_id,config_key,notice_sha256/);
    assert.match(migration, /'EXISTING_PROVIDER_DEPENDENCY','SHADOW',TRUE/);
  });

  it("does not overwrite an already managed notice on replay", () => {
    assert.match(migration, /ON DUPLICATE KEY UPDATE config_key=VALUES\(config_key\)/);
    assert.doesNotMatch(migration, /ON DUPLICATE KEY UPDATE[^;]*string_value=VALUES\(string_value\)/s);
  });

  it("does not mutate providers, consumers, commands, ledgers or operational rows", () => {
    for (const table of ["operation_notice_heads", "operations", "command_audit", "outbox_messages", "command_registry", "command_aliases", "pet_explore_runtime_config", "pet_explore_participations", "inventory_stacks", "inventory_ledger"]) {
      assert.doesNotMatch(migration, new RegExp(`(?:INSERT|UPDATE|DELETE)\\s+(?:INTO\\s+|FROM\\s+)?${table}\\b`, "i"));
    }
  });

  it("is transactional, idempotent and narrowly reversible", () => {
    assert.match(migration, /^SET NAMES utf8mb4;\s*START TRANSACTION;/);
    assert.match(migration, /UNIQUE KEY uq_pet_explore_notice_catalog_version/);
    assert.match(rollback, /catalog_version='ASSET-FREEZE-v2\.438-pet-explore-notice-01'/);
    assert.match(rollback, /config_key='notice\.pet_explore'/);
    assert.doesNotMatch(rollback, /DELETE FROM (?:operation_notice_heads|operations|pet_explore_runtime_config|inventory_stacks)/i);
  });
});
