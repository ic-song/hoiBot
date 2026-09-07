import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const migration = fs.readFileSync(new URL("../migrations/483_pet_skill_probability_actual_ingress.sql", import.meta.url), "utf8");
const rollback = fs.readFileSync(new URL("../migrations/rollback/483_pet_skill_probability_actual_ingress.rollback.sql", import.meta.url), "utf8");

describe("pet skill probability ingress migration", () => {
  it("separates only the exact probability alias and defaults fail-closed to SHADOW", () => {
    assert.match(migration, /'PET_SKILL_PROBABILITY','pet_skill_probability','VERIFIED_USER','SHADOW'/);
    assert.match(migration, /VALUES\('\/펫스킬확률','PET_SKILL_PROBABILITY',TRUE\)/);
    assert.doesNotMatch(migration, /'\/펫스킬'(?:,|\))/);
    assert.doesNotMatch(migration, /'\/펫스킬정보/);
  });

  it("restores the historical aggregate alias before deleting the dedicated registry row", () => {
    assert.match(rollback, /SET command_code='PET_SKILL_READ',active=TRUE/);
    assert.match(rollback, /WHERE command_text='\/펫스킬확률' AND command_code='PET_SKILL_PROBABILITY'/);
    assert.ok(rollback.indexOf("UPDATE command_aliases") < rollback.indexOf("DELETE FROM command_registry"));
  });
});
