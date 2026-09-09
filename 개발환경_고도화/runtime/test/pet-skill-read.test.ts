import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculatePetSkillSlotLimit, formatPetSkillCatalogInfo, formatPetSkillProbability, formatPetSkillStatus, parsePetSkillReadCommand, type PetSkillCatalogRow, type PetSkillViewRow } from "../src/pet/pet-skill-read-service.js";

const skill = (displayName: string, slotNo: number | null, quantity = 0n): PetSkillViewRow => ({ code: displayName, displayName, grade: "희귀", level: 2n, quantity, slotNo });
const catalog = (displayName: string, grade: string, rate: number): PetSkillCatalogRow => ({ code: displayName, displayName, grade, rate, effect: "효과", tierInfo: "\n티어: 1" });

describe("pet skill read aggregate", () => {
  it("accepts three full legacy command families without prefix collisions", () => {
    assert.deepEqual(parsePetSkillReadCommand("/펫스킬"), { kind: "status" });
    assert.deepEqual(parsePetSkillReadCommand("/펫스킬확률"), { kind: "probability" });
    assert.deepEqual(parsePetSkillReadCommand("/펫스킬정보"), { kind: "info", query: null });
    assert.deepEqual(parsePetSkillReadCommand("/펫스킬정보 회복"), { kind: "info", query: "회복" });
    for (const value of ["/펫스킬 1", "/펫스킬확률 안내", "/펫스킬정보회복", "펫스킬"]) assert.equal(parsePetSkillReadCommand(value), undefined);
  });

  it("keeps the intimacy slot boundary and textbook bonus", () => {
    assert.equal(calculatePetSkillSlotLimit(99n, false), 0);
    assert.equal(calculatePetSkillSlotLimit(100n, false), 1);
    assert.equal(calculatePetSkillSlotLimit(3000n, false), 30);
    assert.equal(calculatePetSkillSlotLimit(9007199254740993n, true), 33);
  });

  it("renders equipped order and BIGINT-safe inventory quantity", () => {
    const result = formatPetSkillStatus({ ownerName: "테스터", petName: "호이", intimacyLevel: 3000n, equipped: [skill("펫스킬 학개론📙", 1), skill("돌진", 2)], inventory: [skill("회복", null, 9007199254740993n)] });
    assert.equal(result.slotLimit, 33);
    assert.match(result.reply, /장착 슬롯 2\/33/);
    assert.ok(result.reply.indexOf("1. [희귀] 펫스킬 학개론") < result.reply.indexOf("2. [희귀] 돌진"));
    assert.match(result.reply, /회복 x9007199254740993/);
  });

  it("groups probability by SS-to-D order and keeps one-decimal total", () => {
    const data = formatPetSkillProbability([catalog("회복", "A", 98.5), catalog("학개론", "SS", 1.5)]);
    assert.ok(data.indexOf("SS 등급") < data.indexOf("A 등급"));
    assert.match(data, /학개론 \(확률: 1\.5%\)/);
    assert.match(data, /총 확률: 100\.0%/);
    assert.equal((data.match(/\u200b/g) ?? []).length, 500);
  });

  it("renders catalog grade, rate, effect and tier information", () => {
    assert.equal(formatPetSkillCatalogInfo(catalog("회복", "A", 12.34)), "회복\n등급: A\n확률: 12.3%\n효과: 효과\n티어: 1");
  });
});
