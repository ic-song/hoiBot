import assert from "node:assert/strict";
import {describe,it} from "node:test";
import {isHomeFurnitureInfoReadCandidate,normalizeHomeFurnitureInfoReadDispatchMessage,parseHomeFurnitureInfoTarget} from "./home-furniture-info-read-service.js";
describe("home furniture info read command",()=>{
 it("preserves the legacy prefix candidate",()=>{for(const value of ["/가구정보","/가구정보 대상","/가구정보해줘"])assert.equal(isHomeFurnitureInfoReadCandidate(value),true);assert.equal(isHomeFurnitureInfoReadCandidate(" /가구정보"),false);});
 it("parses the complete suffix as target",()=>{assert.equal(parseHomeFurnitureInfoTarget("/가구정보 호이 남"),"호이 남");assert.equal(parseHomeFurnitureInfoTarget("/가구정보"),"");});
 it("normalizes candidates only",()=>{assert.equal(normalizeHomeFurnitureInfoReadDispatchMessage("/가구정보 호이 남"),"/가구정보");assert.equal(normalizeHomeFurnitureInfoReadDispatchMessage("/가구순위"),"/가구순위");});
});
