import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isHomeHeartExpressionCommandCandidate, normalizeHomeHeartExpressionDispatchMessage, parseHomeHeartExpressionCommand } from "../src/home/home-heart-expression-command.js";
import { allocateHomeHeartExpressions, createHomeHeartExpressionSeed, formatHomeHeartAllocation, homeHeartExpressionSample } from "../src/home/home-heart-expression-service.js";

describe("home heart expression v2.400", () => {
  it("accepts only the five exact argument-bearing commands", () => {
    for (const value of ["/마음", "/마음 조사 남 2", "/귀여워 호이", "/멋져요 호이 1", "/사랑해 호이", "/응원해 호이 3"]) assert.equal(isHomeHeartExpressionCommandCandidate(value), true);
    for (const value of [undefined, "/마음대로", "/귀여워요 호이", " /마음 호이", "/마음 "]) assert.equal(isHomeHeartExpressionCommandCandidate(value), false);
    assert.equal(normalizeHomeHeartExpressionDispatchMessage("/귀여워 조사 남 2"), "/귀여워");
  });
  it("preserves command and the complete longest-name input remainder", () => { assert.deepEqual(parseHomeHeartExpressionCommand("/마음 조사 남 2"), { name: "마음", remainder: "조사 남 2" }); assert.deepEqual(parseHomeHeartExpressionCommand("/응원해"), { name: "응원해", remainder: null }); });
  it("keeps fixed allocation and legacy type order", () => { const fixed = allocateHomeHeartExpressions("사랑해", 3n, "unused"); assert.deepEqual(fixed.allocations.map(row => [row.code, row.quantity]), [["love", 3n]]); assert.equal(formatHomeHeartAllocation(fixed.allocations), "사랑해💖 x3"); assert.equal(formatHomeHeartAllocation([{ code: "love", label: "사랑해💖", quantity: 1n }, { code: "cute", label: "귀여워🐾", quantity: 2n }]), "귀여워🐾 x2 | 사랑해💖 x1"); });
  it("makes /마음 random allocation deterministic and count preserving", () => { const seed = createHomeHeartExpressionSeed("event-1", "1", "2", 20n); assert.equal(homeHeartExpressionSample(seed, 1n), homeHeartExpressionSample(seed, 1n)); const first = allocateHomeHeartExpressions("마음", 20n, seed), second = allocateHomeHeartExpressions("마음", 20n, seed); assert.deepEqual(first, second); assert.equal(first.allocations.reduce((sum, row) => sum + row.quantity, 0n), 20n); assert.equal(first.rolls.length, 20); });
  it("keeps the exact success allocation body", () => { const allocation = allocateHomeHeartExpressions("귀여워", 2n, "unused").allocations; assert.equal(`💞 왕검증자님의 펫홈에\n[${formatHomeHeartAllocation(allocation)}] 마음을 표현했습니다!\n\n남은 마음: 3개`, "💞 왕검증자님의 펫홈에\n[귀여워🐾 x2] 마음을 표현했습니다!\n\n남은 마음: 3개"); });
});
