import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPetAppearanceCommandCandidate, normalizePetAppearanceDispatchMessage, parsePetAppearanceCommand } from "../src/pet/admin-pet-appearance-service.js";

describe("admin pet appearance",()=>{
  it("preserves the greedy last-space split",()=>{assert.deepEqual(parsePetAppearanceCommand("/외형 대상 이름 🐉"),{targetName:"대상 이름",newImage:"🐉"});assert.deepEqual(parsePetAppearanceCommand("/외형 대상 새 외형"),{targetName:"대상 새",newImage:"외형"});});
  it("rejects incomplete boundaries",()=>{assert.equal(isPetAppearanceCommandCandidate("/외형 대상"),false);assert.equal(isPetAppearanceCommandCandidate("/외형"),false);assert.equal(isPetAppearanceCommandCandidate(" /외형 대상 🐉"),false);});
  it("normalizes candidates only",()=>{assert.equal(normalizePetAppearanceDispatchMessage("/외형 대상 이름 🐉"),"/외형");assert.equal(normalizePetAppearanceDispatchMessage("/외형 대상"),"/외형 대상");});
});
