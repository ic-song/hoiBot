import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSpiritEnhanceCommand, parseSpiritEnhanceCount, resolveSpiritAttempt } from "../src/pet/spirit-enhance-service.js";

const policy = { grade_code: "ELEMENTAL-GRADE-012", grade_display_name: "대천사", grade_order: 11, names_json: '["미카엘라🪽"]', success_rate: "0.8", drop_rate: "0",
  item_cost: 20n, point_cost: "50000000.000", max_level: 100n, castle_exp: 0n, castle_upgrade_exp: 0n, raid_exp: 0n, raid_upgrade_exp: 0n };

describe("spirit enhance command", () => {
  it("accepts exact and one full decimal argument only", () => {
    for (const value of ["/정령강화", "/정령강화 0", "/정령강화 100"]) assert.equal(isSpiritEnhanceCommand(value), true);
    for (const value of ["/정령강화 ", "/정령강화 -1", "/정령강화 1 해봐", "/정령강화 1.5"]) assert.equal(isSpiritEnhanceCommand(value), false);
  });
  it("defaults to one and caps counts above one hundred", () => {
    assert.deepEqual(parseSpiritEnhanceCount("/정령강화"), { count: 1, capped: false });
    assert.deepEqual(parseSpiritEnhanceCount("/정령강화 101"), { count: 100, capped: true });
    assert.deepEqual(parseSpiritEnhanceCount("/정령강화 0"), { count: 0, capped: false });
  });
  it("adds smith and boost rates and succeeds at the capped probability", () => {
    const result = resolveSpiritAttempt({ state: { name: "미카엘라🪽", gradeCode: policy.grade_code, grade: "대천사", level: 3n }, policy, smith: true, artisan: false, boostRate: 0.3, random: () => 0.99 });
    assert.equal(result.effectiveRate, 1); assert.equal(result.success, true); assert.equal(result.state.level, 4n);
  });
  it("preserves the stone after a failed artisan roll", () => {
    const values = [0.9, 0.01, 0.5];
    const result = resolveSpiritAttempt({ state: { name: "미카엘라🪽", gradeCode: policy.grade_code, grade: "대천사", level: 3n }, policy, smith: false, artisan: true, boostRate: 0, random: () => values.shift()! });
    assert.equal(result.success, false); assert.equal(result.stonePreserved, true); assert.equal(result.dropped, false);
  });
  it("promotes after max level and chooses a next-grade name deterministically", () => {
    const next = { ...policy, grade_code: "ELEMENTAL-GRADE-013", grade_display_name: "서사급", grade_order: 12, names_json: '["오리온A","오리온B"]' };
    const values = [0.1, 0.9];
    const result = resolveSpiritAttempt({ state: { name: "미카엘라🪽", gradeCode: policy.grade_code, grade: "대천사", level: 100n }, policy: { ...policy, success_rate: "1" }, nextPolicy: next, smith: false, artisan: false, boostRate: 0, random: () => values.shift()! });
    assert.equal(result.promoted, true); assert.deepEqual(result.state, { name: "오리온B", gradeCode: "ELEMENTAL-GRADE-013", grade: "서사급", level: 0n });
  });
});
