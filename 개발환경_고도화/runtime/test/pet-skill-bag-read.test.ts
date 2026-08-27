import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatPetSkillBag, isPetSkillBagReadCommand, type PetSkillBagRow } from "../src/pet/pet-skill-bag-read-service.js";

const row = (displayName: string, quantity: bigint): PetSkillBagRow => ({ code: displayName, displayName, grade: "A", quantity });

describe("pet skill bag read", () => {
  it("accepts only the exact active legacy command", () => {
    assert.equal(isPetSkillBagReadCommand("/펫스킬가방"), true);
    for (const value of ["/펫스킬가방 1", "/펫스킬가방추가", "펫스킬가방"]) assert.equal(isPetSkillBagReadCommand(value), false);
  });

  it("keeps an explicit empty bag projection", () => {
    assert.equal(formatPetSkillBag("테스터", []), "📙 테스터님의 펫스킬가방 📙\n\n보유한 펫스킬이 없습니다.");
  });

  it("renders stable order and BIGINT-safe quantities", () => {
    const data = formatPetSkillBag("테스터", [row("가속", 2n), row("회복", 9007199254740993n)]);
    assert.ok(data.indexOf("1. [A] 가속 x2") < data.indexOf("2. [A] 회복 x9007199254740993"));
  });
});
