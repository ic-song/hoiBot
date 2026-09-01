import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isFreeMarketMiniPetRegisterCandidate, normalizeFreeMarketMiniPetRegisterDispatchMessage, parseFreeMarketMiniPetRegisterCommand } from "../src/market/free-market-mini-pet-register-service.js";

describe("free market mini pet register command", () => {
  it("accepts only a complete positive bag index, quantity, and price", () => {
    assert.deepEqual(parseFreeMarketMiniPetRegisterCommand("/미니펫거래등록 2 3 5000000"), { sourceIndex: 2n, quantity: 3n, price: 5000000n });
    for (const value of ["/미니펫거래등록", "/미니펫거래등록 0 1 1", "/미니펫거래등록 1 0 1", "/미니펫거래등록 1 1 0", "/미니펫거래등록 1 1 2 안내", "/미니펫거래등록 1 1 1.5", "/미니펫거래등록 1 -1 1"]) assert.equal(parseFreeMarketMiniPetRegisterCommand(value), undefined);
  });
  it("uses a full-pattern candidate and representative dispatch alias", () => {
    assert.equal(isFreeMarketMiniPetRegisterCandidate("/미니펫거래등록 1 2 100"), true);
    assert.equal(isFreeMarketMiniPetRegisterCandidate("/미니펫거래등록 1 2"), false);
    assert.equal(normalizeFreeMarketMiniPetRegisterDispatchMessage("/미니펫거래등록 1 2 100"), "/미니펫거래등록");
  });
});
