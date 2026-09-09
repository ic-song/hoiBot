import assert from"node:assert/strict";
import{describe,it}from"node:test";
import{isMiniPetDrawGrantCommandCandidate,parseMiniPetDrawGrantCommand}from"../src/admin/mini-pet-draw-grant-service.js";

describe("mini pet draw grant command boundary",()=>{
  it("preserves default and explicit quantities",()=>{assert.deepEqual(parseMiniPetDrawGrantCommand("/펫미니, 회원"),{amount:1n,targetLegacyKey:"회원"});assert.deepEqual(parseMiniPetDrawGrantCommand("/펫미니7, 여러 단어 회원"),{amount:7n,targetLegacyKey:"여러 단어 회원"});});
  it("keeps zero for the legacy validation reply",()=>assert.deepEqual(parseMiniPetDrawGrantCommand("/펫미니0, 회원"),{amount:0n,targetLegacyKey:"회원"}));
  it("rejects related mini-pet commands and suffix forms without a comma",()=>{for(const message of["/펫미니","/펫미니 7 회원","/펫미니강7, 회원","/미니펫오픈"])assert.equal(isMiniPetDrawGrantCommandCandidate(message),false);for(const message of["/펫미니, 회원","/펫미니7, 회원","/펫미니7,"])assert.equal(isMiniPetDrawGrantCommandCandidate(message),true);});
});
