import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPendantDurabilityCorrectionCommandCandidate, normalizePendantDurabilityCorrectionDispatchMessage, parsePendantDurabilityCorrectionCommand } from "../src/pet/pendant-durability-correction-service.js";

describe("pendant durability correction command", () => {
  it("keeps the broad master candidate but requires the complete comma form", () => {
    assert.equal(isPendantDurabilityCorrectionCommandCandidate("/펜던트내구도수정 대상 남, 0, 4"), true);
    assert.equal(isPendantDurabilityCorrectionCommandCandidate("/펜던트내구도수정 대상 남 안내"), true);
    for (const value of ["/펜던트내구도수정", "/펜던트내구도수정 ", "펜던트내구도수정 대상 남, 1, 2"]) assert.equal(isPendantDurabilityCorrectionCommandCandidate(value), false);
  });
  it("parses target, equipped zero and preserves oversized durability for target-specific clamping", () => {
    assert.deepEqual(parsePendantDurabilityCorrectionCommand("/펜던트내구도수정 대상 남, 0, 4"), { targetName: "대상 남", index: 0n, durability: 4n });
    assert.deepEqual(parsePendantDurabilityCorrectionCommand("/펜던트내구도수정 대상 남, 12, 999999999999999999999"), { targetName: "대상 남", index: 12n, durability: 999999999999999999999n });
    assert.equal(parsePendantDurabilityCorrectionCommand("/펜던트내구도수정 대상 남 1 2"), undefined);
  });
  it("normalizes only recognized candidates", () => {
    assert.equal(normalizePendantDurabilityCorrectionDispatchMessage("/펜던트내구도수정 대상 남, 1, 2"), "/펜던트내구도수정");
    assert.equal(normalizePendantDurabilityCorrectionDispatchMessage("/펜던트내구도수정"), "/펜던트내구도수정");
  });
});
