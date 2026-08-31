import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("admin pet explore package grant data-only contract", () => {
  it("stores /펫탐 as a non-executable PKG-186 source using shared package routes", () => {
    const migration = readFileSync(new URL("../migrations/414_admin_pet_explore_package_grant_source.sql", import.meta.url), "utf8");
    assert.match(migration, /'PKG-186','\/펫탐','LEGACY_ADMIN_GRANT','\/패키지지급',0/);
    assert.match(migration, /'legacyPattern','\/펫탐\[N\], 대상'/);
    assert.match(migration, /'\$\.useRoute','\/패키지사용'/);
    assert.doesNotMatch(migration, /INSERT INTO command_registry/);
    assert.doesNotMatch(migration, /INSERT INTO (?:package_)?command_aliases/);
  });
});
