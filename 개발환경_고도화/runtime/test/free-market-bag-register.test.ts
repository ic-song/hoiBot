import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isFreeMarketBagRegisterCandidate,
  normalizeFreeMarketBagRegisterDispatchMessage,
  parseFreeMarketBagRegisterCommand,
} from "../src/market/free-market-bag-register-service.js";

describe("free market bag register command", () => {
  it("accepts only positive bag index, quantity, and price", () => {
    assert.deepEqual(parseFreeMarketBagRegisterCommand("/가방거래등록 2 3 5000000"), { sourceIndex: 2n, quantity: 3n, price: 5000000n });
    for (const value of [
      "/가방거래등록", "/가방거래등록 0 1 1", "/가방거래등록 1 0 1", "/가방거래등록 1 1 0",
      "/가방거래등록 1 1 2 안내", "/가방거래등록 1 1 1.5", "/가방거래등록 1 -1 1",
    ]) assert.equal(parseFreeMarketBagRegisterCommand(value), undefined);
  });

  it("uses a full-pattern candidate and representative dispatch alias", () => {
    assert.equal(isFreeMarketBagRegisterCandidate("/가방거래등록 1 2 100"), true);
    assert.equal(isFreeMarketBagRegisterCandidate("/가방거래등록 1 2"), false);
    assert.equal(normalizeFreeMarketBagRegisterDispatchMessage("/가방거래등록 1 2 100"), "/가방거래등록");
  });
});
