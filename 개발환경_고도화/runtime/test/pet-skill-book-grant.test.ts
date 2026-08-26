import assert from"node:assert/strict";
import{describe,it}from"node:test";
import{isPetSkillBookGrantCommandCandidate,parsePetSkillBookGrantCommand}from"../src/admin/pet-skill-book-grant-service.js";

describe("pet skill book grant command boundary",()=>{
  it("preserves default and explicit quantities",()=>{assert.deepEqual(parsePetSkillBookGrantCommand("/펫북, 회원"),{amount:1n,targetLegacyKey:"회원"});assert.deepEqual(parsePetSkillBookGrantCommand("/펫북7, 여러 단어 회원"),{amount:7n,targetLegacyKey:"여러 단어 회원"});});
  it("keeps zero for the legacy validation reply",()=>assert.deepEqual(parsePetSkillBookGrantCommand("/펫북0, 회원"),{amount:0n,targetLegacyKey:"회원"}));
  it("rejects related pet-book commands and suffix forms without a comma",()=>{for(const message of["/펫북","/펫북 7 회원","/펫북강7, 회원","/펫스킬오픈"])assert.equal(isPetSkillBookGrantCommandCandidate(message),false);for(const message of["/펫북, 회원","/펫북7, 회원","/펫북7,"])assert.equal(isPetSkillBookGrantCommandCandidate(message),true);});
});
