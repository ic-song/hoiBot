import assert from "node:assert/strict";
import { describe,it } from "node:test";
import { formatPunchActionReply,isPunchActionCommandCandidate,normalizePunchActionDispatchMessage,parsePunchActionCommand,resolvePunchRound } from "../src/battle/punch-action-service.js";

describe("punch action v2.400 contract",()=>{
  it("accepts trimmed exact and positive counts only",()=>{for(const value of ["/펀치"," /펀치 ","/펀치 1","/펀치 999"])assert.equal(isPunchActionCommandCandidate(value),true);for(const value of ["/펀치 0","/펀치 -1","/펀치 1 해봐","/펀치순위","/펀치\n1"])assert.equal(isPunchActionCommandCandidate(value),false);});
  it("defaults to one and clamps only the request at one hundred",()=>{assert.deepEqual(parsePunchActionCommand("/펀치"),{requestedCount:1n,clampedCount:1n});assert.deepEqual(parsePunchActionCommand("/펀치 999"),{requestedCount:999n,clampedCount:100n});assert.equal(normalizePunchActionDispatchMessage("/펀치 8"),"/펀치");});
  it("preserves every cumulative tier boundary",()=>{const samples=[0,0.35,0.60,0.78,0.88,0.94,0.97,0.985,0.993,0.998,0.9995],codes=["COTTON","BEAN","BEGINNER","LOCAL","MUSCLE","STEEL","POWER","CHAMPION","MONSTER","DESTROYER","LEGEND"];assert.deepEqual(samples.map((sample)=>resolvePunchRound(sample,0).outcomeCode),codes);});
  it("keeps inclusive score ranges and the legend storage bug",()=>{assert.equal(resolvePunchRound(0,0).score,0n);assert.equal(resolvePunchRound(0,0.999999).score,99n);assert.equal(resolvePunchRound(0.998,0).score,990n);assert.equal(resolvePunchRound(0.998,0.999999).score,999n);const legend=resolvePunchRound(0.9995,0.75);assert.equal(legend.score,2000n);assert.equal(legend.rewardQuantity,1000n);});
  it("rejects invalid injected samples",()=>{for(const value of [-1,1,Number.NaN])assert.throws(()=>resolvePunchRound(value,0),/RNG/);});
  it("exposes public 1000 and persisted 2000 legend parity",()=>{const legend=resolvePunchRound(0.9995,0),data=formatPunchActionReply({executedCount:1n,ticketAfter:0n,pointAfter:0n,reward:1000n,best:legend,last:legend,legendCount:1n,titleGranted:true});assert.match(data,/1,000점/);assert.match(data,/2,000점/);assert.match(data,/👑전설의 핵주먹/);});
});
