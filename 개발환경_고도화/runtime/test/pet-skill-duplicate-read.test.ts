import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatPetSkillCompatibilityGroups, isPetSkillDuplicateReadCommand } from "../src/pet/pet-skill-duplicate-read-service.js";

describe("pet skill duplicate read", () => {
  it("accepts only the exact legacy command", () => {
    assert.equal(isPetSkillDuplicateReadCommand("/펫스킬중복"), true);
    for (const value of ["/펫스킬중복 1", "/펫스킬중복확인", "펫스킬중복"]) assert.equal(isPetSkillDuplicateReadCommand(value), false);
  });

  it("keeps the explicit empty projection", () => {
    assert.equal(formatPetSkillCompatibilityGroups([]), "📙 중복 장착 불가 목록 📙\n\n등록된 중복 장착 제한이 없습니다.");
  });

  it("renders stable group and member order in the legacy format", () => {
    assert.equal(formatPetSkillCompatibilityGroups([
      { code: "ten_won_salvation", skills: ["십원", "구원"] },
      { code: "hunter_max_level_hunter", skills: ["헌터📙", "만렙헌터"] },
    ]), "📙 중복 장착 불가 목록 📙\n\n- 십원📙 ↔ 구원📙\n- 헌터📙 ↔ 만렙헌터📙");
  });
});
