import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPendantCarrotTradeCommandCandidate, normalizePendantCarrotTradeDispatchMessage, parsePendantCarrotTradeCommand } from "../src/market/pendant-carrot-trade-service.js";

describe("pendant carrot trade command", () => {
  it("keeps both legacy aliases and broad usage candidates", () => {
    for (const value of ["/펜던트당근", "/펜던트당근거래", "/펜던트당근 대상 남 2", "/펜던트당근거래 대상 남 안내"]) assert.equal(isPendantCarrotTradeCommandCandidate(value), true);
    assert.equal(isPendantCarrotTradeCommandCandidate("/펜던트당근추가 대상 1"), false);
  });
  it("parses a spaced target and final numeric stable index", () => {
    assert.deepEqual(parsePendantCarrotTradeCommand("/펜던트당근 대상 남 2"), { targetName: "대상 남", index: 2n });
    assert.deepEqual(parsePendantCarrotTradeCommand("/펜던트당근거래 대상 남 0"), { targetName: "대상 남", index: 0n });
    assert.equal(parsePendantCarrotTradeCommand("/펜던트당근 대상 남 안내"), undefined);
  });
  it("normalizes both aliases to one dispatch command", () => {
    assert.equal(normalizePendantCarrotTradeDispatchMessage("/펜던트당근거래 대상 남 2"), "/펜던트당근");
    assert.equal(normalizePendantCarrotTradeDispatchMessage("다른말"), "다른말");
  });
});
