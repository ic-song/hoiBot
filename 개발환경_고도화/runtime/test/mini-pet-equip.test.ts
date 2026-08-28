import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isMiniPetEquipCommandCandidate, normalizeMiniPetEquipDispatchMessage, parseMiniPetEquipIndex } from "../src/mini-pet/mini-pet-equip-service.js";

describe("mini pet equip command boundary",()=>{
  it("accepts only a complete numeric request and exact confirmations",()=>{assert.equal(isMiniPetEquipCommandCandidate("/미니펫장착 1"),true);assert.equal(isMiniPetEquipCommandCandidate("입양할래"),true);assert.equal(isMiniPetEquipCommandCandidate("생각해볼게"),true);assert.equal(isMiniPetEquipCommandCandidate("/미니펫장착"),false);assert.equal(isMiniPetEquipCommandCandidate("/미니펫장착 1 해봐"),false);});
  it("parses an unsigned stable bag index without Number conversion",()=>{assert.equal(parseMiniPetEquipIndex("/미니펫장착 0"),0n);assert.equal(parseMiniPetEquipIndex("/미니펫장착 9007199254740993"),9007199254740993n);assert.equal(parseMiniPetEquipIndex("/미니펫장착 -1"),null);});
  it("normalizes only executable numeric requests",()=>{assert.equal(normalizeMiniPetEquipDispatchMessage("/미니펫장착 3"),"/미니펫장착");assert.equal(normalizeMiniPetEquipDispatchMessage("입양할래"),"입양할래");assert.equal(normalizeMiniPetEquipDispatchMessage("/미니펫장착 안내"),"/미니펫장착 안내");});
});
