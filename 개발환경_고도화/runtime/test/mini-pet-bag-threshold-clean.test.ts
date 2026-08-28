import assert from "node:assert/strict";
import test from "node:test";
import { isMiniPetBagThresholdCleanCommand,parseMiniPetBagThreshold,planMiniPetBagThresholdClean,type MiniPetCleanupCandidate } from "../src/mini-pet/mini-pet-bag-threshold-clean-service.js";

function pet(overrides:Partial<MiniPetCleanupCandidate>={}):MiniPetCleanupCandidate{return{id:"1",definitionId:"10",displayName:"테스트",gradeDisplayName:"일반",battleExperience:10n,salePrice:500n,isElite:false,equipped:false,reserved:false,bagSequence:1n,...overrides};}

test("mini pet bag threshold clean command boundary",()=>{
  assert.equal(isMiniPetBagThresholdCleanCommand("/미니펫가방정리"),true);
  assert.equal(isMiniPetBagThresholdCleanCommand("/미니펫가방정리 10"),true);
  assert.equal(isMiniPetBagThresholdCleanCommand("/미니펫가방정리abc 10"),false);
  assert.equal(isMiniPetBagThresholdCleanCommand("/미니펫가방정리 10 추가"),false);
});

test("mini pet bag threshold parser accepts unsigned bigint only",()=>{
  assert.equal(parseMiniPetBagThreshold("/미니펫가방정리 0"),0n);
  assert.equal(parseMiniPetBagThreshold("/미니펫가방정리 18446744073709551615"),18_446_744_073_709_551_615n);
  assert.equal(parseMiniPetBagThreshold("/미니펫가방정리 -1"),null);
  assert.equal(parseMiniPetBagThreshold("/미니펫가방정리 18446744073709551616"),null);
});

test("cleanup plan preserves protected equipped reserved and high experience pets",()=>{
  const rows=[pet({id:"1"}),pet({id:"2",gradeDisplayName:"태초"}),pet({id:"3",isElite:true}),pet({id:"4",equipped:true}),pet({id:"5",reserved:true}),pet({id:"6",battleExperience:11n})];
  const plan=planMiniPetBagThresholdClean(rows,10n);
  assert.deepEqual(plan.removed.map(row=>row.id),["1"]);
  assert.deepEqual(plan.preserved.map(row=>row.id),["2","3","4","5","6"]);
});

test("cleanup plan keeps legacy fallback and signed sale price parity",()=>{
  const plan=planMiniPetBagThresholdClean([pet({id:"1",salePrice:null}),pet({id:"2",salePrice:0n}),pet({id:"3",salePrice:-50n})],10n);
  assert.equal(plan.pointDelta,199_950n);
});
