import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPendantMarketRegisterCommandCandidate, normalizePendantMarketRegisterDispatchMessage, parsePendantMarketRegisterCommand } from "../src/market/pendant-market-register-service.js";

describe("pendant market register command", () => {
  it("accepts only index and positive price", () => {
    assert.deepEqual(parsePendantMarketRegisterCommand("/펜던트거래등록 2 5000000"), { index: 2n, price: 5000000n });
    for (const value of ["/펜던트거래등록", "/펜던트거래등록 0 1", "/펜던트거래등록 1 0", "/펜던트거래등록 1 2 안내"]) assert.equal(parsePendantMarketRegisterCommand(value), undefined);
  });
  it("uses the full-pattern guard and representative dispatch alias", () => {
    assert.equal(isPendantMarketRegisterCommandCandidate("/펜던트거래등록 1 100"), true);
    assert.equal(isPendantMarketRegisterCommandCandidate("/펜던트거래등록 1"), false);
    assert.equal(normalizePendantMarketRegisterDispatchMessage("/펜던트거래등록 1 100"), "/펜던트거래등록");
  });
});
