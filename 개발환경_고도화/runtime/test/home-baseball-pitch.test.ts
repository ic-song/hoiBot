import assert from "node:assert/strict";
import { describe,it } from "node:test";
import { isHomeBaseballPitchCommandCandidate,normalizeHomeBaseballPitchDispatchMessage,parseHomeBaseballPitchCommand } from "../src/home/home-baseball-pitch-command.js";
import { buildHomeBaseballPitchMessages,resolveBaseballPitch } from "../src/home/home-baseball-pitch-service.js";

describe("home baseball pitch",()=>{
  it("accepts the exact and full 1-100 count forms",()=>{assert.deepEqual(parseHomeBaseballPitchCommand("/투수던집니다"),{kind:"use",count:1n});assert.deepEqual(parseHomeBaseballPitchCommand("/투수던집니다 100"),{kind:"use",count:100n});assert.deepEqual(parseHomeBaseballPitchCommand("/투수던집니다 0"),{kind:"usage"});assert.deepEqual(parseHomeBaseballPitchCommand("/투수던집니다 101"),{kind:"limit"});});
  it("keeps malformed candidates on usage but blocks prefix collisions",()=>{assert.equal(isHomeBaseballPitchCommandCandidate("/투수던집니다 안내"),true);assert.deepEqual(parseHomeBaseballPitchCommand("/투수던집니다 1 안내"),{kind:"usage"});assert.equal(parseHomeBaseballPitchCommand("/투수던집니다abc"),undefined);assert.equal(isHomeBaseballPitchCommandCandidate("/투수던집니다abc"),false);});
  it("normalizes every candidate to one exact DB alias",()=>{assert.equal(normalizeHomeBaseballPitchDispatchMessage("/투수던집니다 10"),"/투수던집니다");assert.equal(normalizeHomeBaseballPitchDispatchMessage("/투수던집니다abc"),"/투수던집니다abc");});
  it("preserves all five cumulative probability boundaries",()=>{const result=resolveBaseballPitch([0,0.01,0.05,0.15,0.35]);assert.deepEqual(result,{grandSlam:1n,homerun:1n,triple:1n,double:1n,hit:1n,point:10_114_000_000n});});
  it("renders highest highlight, title count and delayed base rewards",()=>{const counts=resolveBaseballPitch([0,0]);const messages=buildHomeBaseballPitchMessages({displayName:"합성 타자",rankEmoji:"👑",useCount:2n,remaining:3n,counts});assert.equal(messages.length,2);assert.match(messages[0]!,/그랜드슬램: 2회/);assert.match(messages[0]!,/총 추가 포인트: 🅟20,000,000,000/);assert.match(messages[0]!,/타이틀 획득: 2개/);assert.match(messages[1]!,/인테리어샵.*60개/);assert.equal((messages[1]!.match(/\u200b/g)??[]).length,500);});
});
