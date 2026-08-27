import assert from "node:assert/strict";
import { describe,it } from "node:test";
import { isPetSkillExtinctionCandidate,normalizePetSkillExtinctionDispatchMessage,parsePetSkillExtinction } from "../src/pet/pet-skill-extinction-service.js";
describe("pet skill extinction",()=>{
  it("keeps the candidate narrow",()=>{assert.equal(isPetSkillExtinctionCandidate("/펫스킬소멸 1"),true);assert.equal(isPetSkillExtinctionCandidate("/펫스킬소멸권"),false);});
  it("accepts only a full positive safe slot",()=>{assert.equal(parsePetSkillExtinction("/펫스킬소멸 12"),12);for(const value of["/펫스킬소멸","/펫스킬소멸 0","/펫스킬소멸 1 해봐","/펫스킬소멸 -1"])assert.equal(parsePetSkillExtinction(value),null);});
  it("normalizes only executable messages",()=>{assert.equal(normalizePetSkillExtinctionDispatchMessage("/펫스킬소멸 2"),"/펫스킬소멸 [번호]");assert.equal(normalizePetSkillExtinctionDispatchMessage("/펫스킬소멸 2 추가"),"/펫스킬소멸 2 추가");});
});
