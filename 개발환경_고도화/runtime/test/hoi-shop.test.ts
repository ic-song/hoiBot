import assert from "node:assert/strict";
import { describe,it } from "node:test";
import { formatHoiShopResult,isHoiShopCommand } from "../src/market/hoi-shop-service.js";
import { isFreeMarketLifecycleCandidate, isFreeMarketMutationDispatch, normalizeFreeMarketLifecycleDispatchMessage } from "../src/market/free-market-buy-service.js";

describe("hoi shop command boundary",()=>{
  it("accepts only the exact legacy command",()=>{assert.equal(isHoiShopCommand("/호이상점"),true);for(const value of ["/호이상점 ","/호이상점 안내","호이상점",undefined])assert.equal(isHoiShopCommand(value),false);});
  it("reuses the existing market dispatch boundary",()=>{assert.equal(isFreeMarketLifecycleCandidate("/호이상점"),true);assert.equal(normalizeFreeMarketLifecycleDispatchMessage("/호이상점"),"/호이상점");assert.equal(isFreeMarketMutationDispatch("/호이상점","MODERN","store_hoi_shop"),true);});
  it("formats active listing fields in stable order",()=>{const data=formatHoiShopResult([{id:2n,item_name:"합성 아이템",bidder_name:"입찰자",highest_bid:"1234000.000",remaining_seconds:59n}],[]);assert.match(data,/\[1\] 합성 아이템/);assert.match(data,/남은 시간: 59초/);assert.match(data,/현재 입찰자: 입찰자/);assert.match(data,/🅟1,234,000/);});
  it("keeps settlement notices before the empty projection",()=>{assert.equal(formatHoiShopResult([], ["✅ 합성 경매 정산"]),"✅ 합성 경매 정산\n\n🏪 호이상점\n━━━━━━━━━━━━\n등록된 경매 상품이 없습니다.");});
});
