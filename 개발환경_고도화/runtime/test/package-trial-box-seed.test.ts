import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const migration = readFileSync(new URL("../migrations/153_package_trial_box_seed.sql", import.meta.url), "utf8");

describe("trial box catalog seed", () => {
  it("keeps the legacy command as source metadata without an executable alias", () => {
    assert.match(migration, /'PKG-TRIAL-BOX'.*'\/시련오픈'/s);
    assert.match(migration, /DELETE FROM command_aliases WHERE command_text='\/시련오픈'/);
    assert.match(migration, /DELETE FROM package_command_aliases WHERE package_id='PKG-TRIAL-BOX'/);
  });
  it("maps the exact four fixed rewards and quantities", () => {
    for (const expected of [
      /ITEM-RWD-TRIAL-TOWER-GUIDE',20/,
      /ITEM-RWD-038',15/,
      /ITEM-RWD-HAPPY-DICE',10/,
      /ITEM-RWD-TRIAL-TOWER-RESET',3/
    ]) assert.match(migration, expected);
    assert.equal((migration.match(/'RULE-PKG-TRIAL-BOX-00[1-4]'/g) ?? []).length, 4);
  });
  it("uses only the shared package route and remains disabled before Gate 8", () => {
    assert.match(migration, /'useRoute','\/패키지사용'/);
    assert.match(migration, /'EXACT_LEGACY_DRAFT',0,1/);
  });
});
