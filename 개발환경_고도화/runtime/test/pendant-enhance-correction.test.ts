import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPendantEnhanceCorrectionCommandCandidate, normalizePendantEnhanceCorrectionDispatchMessage, parsePendantEnhanceCorrectionCommand } from "../src/pet/pendant-enhance-correction-service.js";

describe("pendant enhance correction command", () => {
  it("keeps the broad master candidate but requires the complete comma form", () => {
    assert.equal(isPendantEnhanceCorrectionCommandCandidate("/펜던트강화수정 대상 남, 0, 7"), true);
    assert.equal(isPendantEnhanceCorrectionCommandCandidate("/펜던트강화수정 대상 남 안내"), true);
    for (const value of ["/펜던트강화수정", "/펜던트강화수정 ", "펜던트강화수정 대상 남, 1, 2"]) assert.equal(isPendantEnhanceCorrectionCommandCandidate(value), false);
  });
  it("parses target, equipped zero and clamps oversized levels to thirty", () => {
    assert.deepEqual(parsePendantEnhanceCorrectionCommand("/펜던트강화수정 대상 남, 0, 7"), { targetName: "대상 남", index: 0n, level: 7 });
    assert.deepEqual(parsePendantEnhanceCorrectionCommand("/펜던트강화수정 대상 남, 12, 999999999999999999999"), { targetName: "대상 남", index: 12n, level: 30 });
    assert.equal(parsePendantEnhanceCorrectionCommand("/펜던트강화수정 대상 남 1 2"), undefined);
  });
  it("normalizes only recognized candidates", () => {
    assert.equal(normalizePendantEnhanceCorrectionDispatchMessage("/펜던트강화수정 대상 남, 1, 2"), "/펜던트강화수정");
    assert.equal(normalizePendantEnhanceCorrectionDispatchMessage("/펜던트강화수정"), "/펜던트강화수정");
  });
});
