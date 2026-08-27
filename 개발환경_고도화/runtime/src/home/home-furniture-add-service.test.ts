import assert from "node:assert/strict";
import {describe,it} from "node:test";
import {isHomeFurnitureAddCandidate,normalizeHomeFurnitureAddDispatchMessage,parseHomeFurnitureAddDetails} from "./home-furniture-add-service.js";

describe("home furniture add command",()=>{
 it("preserves the legacy prefix candidate",()=>{assert.equal(isHomeFurnitureAddCandidate("/가구추가 대상 의자 100 일반"),true);assert.equal(isHomeFurnitureAddCandidate("/가구추가 "),true);for(const value of[undefined,"/가구추가","가구추가 대상 의자 100 일반"," /가구추가 대상 의자 100 일반"])assert.equal(isHomeFurnitureAddCandidate(value),false);});
 it("uses the first Number token between a multi-word name and grade",()=>{assert.deepEqual(parseHomeFurnitureAddDetails("샤넬 컬렉션💎 56050 쥬 엘"),{kind:"valid",furnitureName:"샤넬 컬렉션💎",charmNumber:56050,grade:"쥬 엘"});assert.deepEqual(parseHomeFurnitureAddDetails("의자 1e3 특별 등급"),{kind:"valid",furnitureName:"의자",charmNumber:1000,grade:"특별 등급"});});
 it("keeps usage and format branches separate",()=>{assert.deepEqual(parseHomeFurnitureAddDetails("의자 일반"),{kind:"usage"});assert.deepEqual(parseHomeFurnitureAddDetails("의자 일반 등급"),{kind:"format"});assert.deepEqual(parseHomeFurnitureAddDetails("100 의자 일반"),{kind:"format"});});
 it("normalizes candidates only",()=>{assert.equal(normalizeHomeFurnitureAddDispatchMessage("/가구추가 대상 의자 100 일반"),"/가구추가");assert.equal(normalizeHomeFurnitureAddDispatchMessage("/가구추가"),"/가구추가");});
});
