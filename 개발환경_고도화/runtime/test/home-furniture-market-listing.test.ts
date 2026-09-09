import assert from "node:assert/strict";
import { describe,it } from "node:test";
import { isHomeFurnitureMarketListingCandidate,normalizeHomeFurnitureMarketListingDispatchMessage,parseHomeFurnitureMarketListingCommand } from "../src/market/home-furniture-market-listing-service.js";

describe("home furniture market listing command",()=>{
  it("accepts positive bigint index quantity and price",()=>assert.deepEqual(parseHomeFurnitureMarketListingCommand("/가구거래등록 12 9007199254740993 999999999999999999999999999"),{sourceIndex:12n,quantity:9007199254740993n,price:999999999999999999999999999n}));
  it("rejects incomplete zero and guide suffix forms",()=>{for(const v of ["/가구거래등록","/가구거래등록 1 1","/가구거래등록 0 1 1","/가구거래등록 1 0 1","/가구거래등록 1 1 0","/가구거래등록 1 1 1 안내"])assert.equal(parseHomeFurnitureMarketListingCommand(v),undefined);});
  it("enforces uint64 fee and decimal bounds",()=>{assert.notEqual(parseHomeFurnitureMarketListingCommand("/가구거래등록 18446744073709551615 3689348814741910323 999999999999999999999999999"),undefined);assert.equal(parseHomeFurnitureMarketListingCommand("/가구거래등록 18446744073709551616 1 1"),undefined);assert.equal(parseHomeFurnitureMarketListingCommand("/가구거래등록 1 3689348814741910324 1"),undefined);assert.equal(parseHomeFurnitureMarketListingCommand("/가구거래등록 1 1 1000000000000000000000000000"),undefined);});
  it("normalizes only a complete valid command",()=>{assert.equal(isHomeFurnitureMarketListingCandidate("/가구거래등록 1 2 3000"),true);assert.equal(normalizeHomeFurnitureMarketListingDispatchMessage("/가구거래등록 1 2 3000"),"/가구거래등록 [가구가방번호] [수량] [판매금액]");assert.equal(normalizeHomeFurnitureMarketListingDispatchMessage("/가구거래등록 1 2 3000 해봐"),"/가구거래등록 1 2 3000 해봐");});
});
