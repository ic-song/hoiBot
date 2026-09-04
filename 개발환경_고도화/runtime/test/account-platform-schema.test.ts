import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// 예약된 migration 파일을 UTF-8 원문으로 읽습니다.
const migration = (name: string) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
// 계정 플랫폼 Maria repository 원문을 읽습니다.
const repository = readFileSync(new URL("../src/account-platform/maria-account-platform-repository.ts", import.meta.url), "utf8");

describe("WBS746 account platform additive schema", () => {
  it("uses reserved migrations, descriptive CUID2 PKs, audit columns, and DB uniqueness guards", () => {
    const sql = [
      migration("467_account_portal_game_links.sql"),
      migration("468_account_platform_contexts.sql"),
      migration("469_account_active_player_verification.sql")
    ].join("\n");
    for (const pk of ["portal_account_id", "portal_game_account_link_id", "platform_identity_id", "platform_context_id", "platform_context_membership_id", "platform_nickname_observation_id", "active_player_selection_id", "account_platform_operation_id"]) {
      assert.match(sql, new RegExp(`${pk} CHAR\\(8\\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL`));
    }
    for (const table of ["canonical_portal_accounts", "portal_game_account_links", "account_platform_identities", "account_platform_contexts", "account_platform_context_memberships", "account_platform_nickname_observations", "account_platform_active_player_selections", "account_platform_operation_receipts"]) {
      const block = sql.slice(sql.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`), sql.indexOf("ENGINE=InnoDB", sql.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`)));
      for (const audit of ["INSERT_USER", "INSERT_TIME", "UPDATE_USER", "UPDATE_TIME"]) assert.match(block, new RegExp(audit));
    }
    assert.match(sql, /uq_amgp_467_one_representative/);
    assert.match(sql, /uq_amgp_467_one_portal_per_player/);
    assert.match(sql, /active_representative_portal_account_id VARCHAR\(8\)[\s\S]+RTRIM\(portal_account_id\)/);
    assert.match(sql, /uq_amgp_468_platform_identity \(platform_code, identity_scope_key, external_user_key\)/);
    assert.match(sql, /uq_amgp_469_one_selection_per_membership/);
    assert.doesNotMatch(sql, /CREATE TABLE[^;]+\n\s+id\s/i);
  });

  it("extends verification challenges additively for new and legacy targets without plaintext codes", () => {
    const sql = migration("469_account_active_player_verification.sql");
    assert.match(sql, /ADD COLUMN target_player_id BIGINT UNSIGNED NULL/);
    assert.match(sql, /ADD COLUMN expected_display_name/);
    assert.match(sql, /ADD COLUMN identity_scope_key/);
    assert.match(sql, /ADD COLUMN external_context_key/);
    assert.match(sql, /ADD COLUMN verified_platform_identity_id CHAR\(8\)/);
    assert.match(sql, /ADD COLUMN consumed_request_key/);
    assert.doesNotMatch(sql, /plaintext|verification_code\s/i);
  });

  it("keeps receipt, legacy audit, and outbox writes in the repository transaction", () => {
    assert.match(repository, /INSERT INTO account_platform_operation_receipts/);
    assert.match(repository, /INSERT INTO operations/);
    assert.match(repository, /INSERT INTO command_audit/);
    assert.match(repository, /INSERT INTO outbox_messages/);
    assert.match(repository, /withTransaction/);
  });
});
