import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatHomeFurnitureSellReply, isHomeFurnitureSellCandidate, normalizeHomeFurnitureSellDispatchMessage, parseHomeFurnitureSellCommand } from "./home-furniture-sell-service.js";

describe("home furniture sell",()=>{
  it("accepts only exact usage and one full numeric argument",()=>{
    for(const value of["/가구판매","/가구판매 0","/가구판매 2","/가구판매 999999999999999999999"])assert.equal(isHomeFurnitureSellCandidate(value),true);
    for(const value of[undefined,"가구판매","/가구판매 ","/가구판매 -1","/가구판매 1 해봐","/가구판매2"])assert.equal(isHomeFurnitureSellCandidate(value),false);
  });
  it("parses usage, zero and bigint-safe indexes",()=>{
    assert.deepEqual(parseHomeFurnitureSellCommand("/가구판매"),{kind:"usage"});
    assert.deepEqual(parseHomeFurnitureSellCommand("/가구판매 0"),{kind:"index",index:0n});
    assert.deepEqual(parseHomeFurnitureSellCommand("/가구판매 18446744073709551615"),{kind:"index",index:18446744073709551615n});
  });
  it("normalizes every executable form to one stable DB alias",()=>{
    assert.equal(normalizeHomeFurnitureSellDispatchMessage("/가구판매 2"),"/가구판매");
    assert.equal(normalizeHomeFurnitureSellDispatchMessage("/가구판매 2 해봐"),"/가구판매 2 해봐");
  });
  it("preserves the legacy success reply and comma formatting",()=>{
    assert.equal(formatHomeFurnitureSellReply("🏆호이","황금 침대",123456n,100000n),"🏡[🏆호이]님,\n황금 침대(+123,456💕) 을(를)\n가구정리센터에 보냈습니다.\n\n🅟100,000 를 획득합니다.");
  });
});
