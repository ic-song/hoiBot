import assert from "node:assert/strict";
import { describe,it } from "node:test";
import { isHomeFurnitureEquipCandidate,normalizeHomeFurnitureEquipDispatchMessage,parseHomeFurnitureEquipIndex } from "./home-furniture-equip-service.js";

describe("home furniture equip command",()=>{
  it("accepts only a complete numeric command",()=>{
    assert.equal(isHomeFurnitureEquipCandidate("/가구장착 1"),true);
    assert.equal(isHomeFurnitureEquipCandidate("/가구장착"),true);
    for(const value of ["/가구장착 -1","/가구장착 1 해봐"])assert.equal(isHomeFurnitureEquipCandidate(value),false);
  });
  it("parses uint64 indexes including legacy zero",()=>{
    assert.equal(parseHomeFurnitureEquipIndex("/가구장착 0"),0n);
    assert.equal(parseHomeFurnitureEquipIndex("/가구장착 18446744073709551615"),18446744073709551615n);
    assert.equal(parseHomeFurnitureEquipIndex("/가구장착 18446744073709551616"),null);
  });
  it("normalizes only valid dispatch candidates",()=>{
    assert.equal(normalizeHomeFurnitureEquipDispatchMessage("/가구장착 7"),"/가구장착");
    assert.equal(normalizeHomeFurnitureEquipDispatchMessage("/가구장착 7 안내"),"/가구장착 7 안내");
  });
});
