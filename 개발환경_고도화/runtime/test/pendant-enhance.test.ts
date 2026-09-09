import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isPendantEnhanceCommandCandidate,
  normalizePendantEnhanceDispatchMessage,
  parsePendantEnhanceIndex
} from "../src/pet/pendant-enhance-service.js";

describe("pendant enhance command", () => {
  it("keeps the broad legacy candidate and exact confirmation aliases", () => {
    for (const value of ["/펜던트강화", "/펜던트강화 0", "/펜던트강화 안내", "진행시켜", "쫄았음"]) {
      assert.equal(isPendantEnhanceCommandCandidate(value), true);
    }
    assert.equal(isPendantEnhanceCommandCandidate("/펜던트강화 "), false);
    assert.equal(isPendantEnhanceCommandCandidate("진행시켜 "), false);
  });
  it("parses only a complete unsigned index and preserves equipped index zero", () => {
    assert.equal(parsePendantEnhanceIndex("/펜던트강화 0"), 0n);
    assert.equal(parsePendantEnhanceIndex("/펜던트강화 12"), 12n);
    for (const value of ["/펜던트강화", "/펜던트강화 -1", "/펜던트강화 1.0", "/펜던트강화 1 안내"]) {
      assert.equal(parsePendantEnhanceIndex(value), null);
    }
  });
  it("normalizes parameterized candidates without changing confirmation aliases", () => {
    assert.equal(normalizePendantEnhanceDispatchMessage("/펜던트강화 2"), "/펜던트강화");
    assert.equal(normalizePendantEnhanceDispatchMessage("진행시켜"), "진행시켜");
    assert.equal(normalizePendantEnhanceDispatchMessage("쫄았음"), "쫄았음");
  });
});
