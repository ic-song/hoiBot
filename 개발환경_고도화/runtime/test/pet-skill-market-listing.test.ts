import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isPetSkillMarketListingCandidate,
  normalizePetSkillMarketListingDispatchMessage,
  parsePetSkillMarketListingCommand,
} from "../src/market/pet-skill-market-listing-service.js";

describe("pet skill market listing command", () => {
  it("accepts positive bigint index, quantity, and price", () => {
    assert.deepEqual(parsePetSkillMarketListingCommand("/스킬거래등록 12 9007199254740993 999999999999999999999999999"), {
      sourceIndex: 12n, quantity: 9007199254740993n, price: 999999999999999999999999999n,
    });
  });

  it("requires the complete three-argument pattern", () => {
    for (const value of ["/스킬거래등록", "/스킬거래등록 1 1", "/스킬거래등록 0 1 1", "/스킬거래등록 1 0 1", "/스킬거래등록 1 1 0", "/스킬거래등록 1 1 1 안내"]) {
      assert.equal(parsePetSkillMarketListingCommand(value), undefined);
    }
  });

  it("enforces uint64, fee-safe quantity, and DECIMAL(30,3) integer bounds", () => {
    assert.notEqual(parsePetSkillMarketListingCommand("/스킬거래등록 18446744073709551615 368934881474191032 999999999999999999999999999"), undefined);
    assert.equal(parsePetSkillMarketListingCommand("/스킬거래등록 18446744073709551616 1 1"), undefined);
    assert.equal(parsePetSkillMarketListingCommand("/스킬거래등록 1 368934881474191033 1"), undefined);
    assert.equal(parsePetSkillMarketListingCommand("/스킬거래등록 1 1 1000000000000000000000000000"), undefined);
  });

  it("normalizes only exact valid commands to the representative alias", () => {
    assert.equal(isPetSkillMarketListingCandidate("/스킬거래등록 1 2 3000"), true);
    assert.equal(isPetSkillMarketListingCandidate("/스킬거래등록안내 1 2 3000"), false);
    assert.equal(normalizePetSkillMarketListingDispatchMessage("/스킬거래등록 1 2 3000"), "/스킬거래등록 [가방번호] [수량] [판매금액]");
    assert.equal(normalizePetSkillMarketListingDispatchMessage("/스킬거래등록 1 2 3000 해봐"), "/스킬거래등록 1 2 3000 해봐");
  });
});
