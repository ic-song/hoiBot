import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPetSkillOpenCandidate, normalizePetSkillOpenDispatchMessage, parsePetSkillOpenCount } from "../src/pet/pet-skill-open-service.js";

describe("pet skill open command", () => {
  it("accepts the exact command with a default count of one", () => {
    assert.equal(isPetSkillOpenCandidate("/펫스킬오픈"), true);
    assert.equal(parsePetSkillOpenCount("/펫스킬오픈"), 1n);
  });

  it("accepts one full positive numeric argument", () => {
    assert.equal(isPetSkillOpenCandidate("/펫스킬오픈 7"), true);
    assert.equal(parsePetSkillOpenCount("/펫스킬오픈 7"), 7n);
  });

  it("routes zero so the service can preserve the usage reply", () => {
    assert.equal(isPetSkillOpenCandidate("/펫스킬오픈 0"), true);
    assert.equal(normalizePetSkillOpenDispatchMessage("/펫스킬오픈 0"), "/펫스킬오픈 [숫자]");
    assert.equal(parsePetSkillOpenCount("/펫스킬오픈 0"), null);
  });

  it("caps a valid uint64 request at the legacy maximum of 100", () => {
    assert.equal(parsePetSkillOpenCount("/펫스킬오픈 18446744073709551615"), 100n);
    assert.equal(parsePetSkillOpenCount("/펫스킬오픈 18446744073709551616"), null);
  });

  it("rejects suffix text, signs, decimals and related commands", () => {
    for (const message of ["/펫스킬오픈 2 해봐", "/펫스킬오픈 -1", "/펫스킬오픈 1.5", "/펫스킬정보"]) {
      assert.equal(isPetSkillOpenCandidate(message), false);
      assert.equal(parsePetSkillOpenCount(message), null);
    }
  });

  it("normalizes exact and representative aliases independently", () => {
    assert.equal(normalizePetSkillOpenDispatchMessage("/펫스킬오픈"), "/펫스킬오픈");
    assert.equal(normalizePetSkillOpenDispatchMessage("/펫스킬오픈 3"), "/펫스킬오픈 [숫자]");
  });
});
