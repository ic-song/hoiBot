import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculatePetSkillSlotLimit, formatPetSkillStatus, isPetSkillReadCommand, type PetSkillViewRow } from "../src/pet/pet-skill-read-service.js";

const skill = (displayName: string, slotNo: number | null, quantity = 0n): PetSkillViewRow => ({
  code: displayName, displayName, grade: "희귀", level: 2n, quantity, slotNo,
});

describe("pet skill read command", () => {
  it("accepts only the exact legacy command", () => {
    assert.equal(isPetSkillReadCommand("/펫스킬"), true);
    for (const value of ["/펫스킬 1", "/펫스킬목록", "펫스킬"]) assert.equal(isPetSkillReadCommand(value), false);
  });

  it("keeps the intimacy slot boundary and textbook bonus", () => {
    assert.equal(calculatePetSkillSlotLimit(99n, false), 0);
    assert.equal(calculatePetSkillSlotLimit(100n, false), 1);
    assert.equal(calculatePetSkillSlotLimit(3000n, false), 30);
    assert.equal(calculatePetSkillSlotLimit(9007199254740993n, true), 33);
  });

  it("renders equipped order and BIGINT-safe inventory quantity", () => {
    const result = formatPetSkillStatus({
      ownerName: "테스터", petName: "호이", intimacyLevel: 3000n,
      equipped: [skill("펫스킬 학개론📙", 1), skill("돌진", 2)],
      inventory: [skill("회복", null, 9007199254740993n)],
    });
    assert.equal(result.slotLimit, 33);
    assert.match(result.reply, /장착 슬롯 2\/33/);
    assert.ok(result.reply.indexOf("1. [희귀] 펫스킬 학개론") < result.reply.indexOf("2. [희귀] 돌진"));
    assert.match(result.reply, /회복 x9007199254740993/);
  });
});
