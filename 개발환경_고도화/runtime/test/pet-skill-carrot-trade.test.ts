import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPetSkillCarrotTradeCandidate, normalizePetSkillCarrotTradeDispatchMessage, parsePetSkillCarrotTrade } from "../src/pet/pet-skill-carrot-trade-service.js";

describe("pet skill carrot trade", () => {
  it("accepts a spaced nickname and positive bigint arguments", () => {
    assert.deepEqual(parsePetSkillCarrotTrade("/펫스킬당근 공백 포함 닉네임 12 9007199254740993"), {
      targetName: "공백 포함 닉네임", sourceIndex: 12n, quantity: 9007199254740993n,
    });
  });

  it("requires the full command pattern", () => {
    for (const value of ["/펫스킬당근", "/펫스킬당근 대상 0 1", "/펫스킬당근 대상 1 0", "/펫스킬당근 대상 1 2 해봐", "/펫스킬당근 대상 -1 2"]) {
      assert.equal(parsePetSkillCarrotTrade(value), null);
    }
  });

  it("enforces uint64 index and fee-safe uint64 quantity", () => {
    assert.notEqual(parsePetSkillCarrotTrade("/펫스킬당근 대상 18446744073709551615 368934881474191032"), null);
    assert.equal(parsePetSkillCarrotTrade("/펫스킬당근 대상 18446744073709551616 1"), null);
    assert.equal(parsePetSkillCarrotTrade("/펫스킬당근 대상 1 368934881474191033"), null);
  });

  it("keeps similar commands out and normalizes only valid trades", () => {
    assert.equal(isPetSkillCarrotTradeCandidate("/펫스킬당근 대상 1 2"), true);
    assert.equal(isPetSkillCarrotTradeCandidate("/펫스킬당근거래 대상 1 2"), false);
    assert.equal(normalizePetSkillCarrotTradeDispatchMessage("/펫스킬당근 대상 1 2"), "/펫스킬당근 [받을유저닉] [가방번호] [수량]");
    assert.equal(normalizePetSkillCarrotTradeDispatchMessage("/펫스킬당근 대상 1 2 해봐"), "/펫스킬당근 대상 1 2 해봐");
  });
});
