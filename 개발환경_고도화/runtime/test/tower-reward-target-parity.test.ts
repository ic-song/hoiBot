import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const fixture=JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/tower-reward-target-parity-v2438.json",import.meta.url),"utf8"));
const migration=fs.readFileSync(new URL("../migrations/429_tower_reward_target_parity.sql",import.meta.url),"utf8");
const rollback=fs.readFileSync(new URL("../../migration-control/rollback/429_tower_reward_target_parity.sql",import.meta.url),"utf8");

describe("tower reward target parity",()=>{
  it("pins both approved sources and complete replacement counts",()=>{
    assert.equal(fixture.sourceRevision,"5925b83b1dbfb78ef583354604e112b9430003f3");
    assert.equal(fixture.sources.trial.operationalSha256,"363b92ed5a74c41e08fbf9f854a8eb7c008c45bb87cd27989dc30bf5d0eccb14");
    assert.equal(fixture.sources.event.operationalSha256,"b5661ba8572db6bb24d2ac10121281149dd3a2fefe932edd78af0983e625abbf");
    assert.deepEqual(fixture.counts,{trialBosses:120,eventBosses:7,bosses:127,trialRewards:377,eventRewards:7,rewards:384,eventFloorOccurrences:368,uniqueEventFloors:368,uniqueTargets:24,newTargets:2,trialChangedBossRewards:120,trialAddedTargetOccurrences:238,trialRemovedTargetOccurrences:242,eventChangedRewards:1,eventChangedFloorLists:0});
  });
  it("preserves source order, event precedence and first-range matching",()=>{
    assert.deepEqual(fixture.bosses.filter((row:{sourceKind:string})=>row.sourceKind==="TRIAL").map((row:{bossSequence:number})=>row.bossSequence),Array.from({length:120},(_,index)=>index+1));
    assert.ok(fixture.bosses.filter((row:{sourceKind:string})=>row.sourceKind==="EVENT").every((row:{precedenceRank:number;matchStrategy:string})=>row.precedenceRank===1&&row.matchStrategy==="EXACT_FLOOR"));
    assert.ok(fixture.bosses.filter((row:{sourceKind:string})=>row.sourceKind==="TRIAL").every((row:{precedenceRank:number;matchStrategy:string})=>row.precedenceRank===2&&row.matchStrategy==="FIRST_RANGE"));
  });
  it("keeps dense event floor and reward occurrences",()=>{
    for(const boss of fixture.bosses){const rewards=fixture.rewards.filter((row:{sourceKind:string;bossSequence:number})=>row.sourceKind===boss.sourceKind&&row.bossSequence===boss.bossSequence);assert.deepEqual(rewards.map((row:{rewardSequence:number})=>row.rewardSequence),Array.from({length:boss.rewardCount},(_,index)=>index+1));}
    assert.equal(new Set(fixture.eventFloors.map((row:{floorValue:number})=>row.floorValue)).size,368);
  });
  it("resolves 24 typed targets and adds only two STACK definitions",()=>{
    assert.equal(fixture.itemOccurrences.length,24);
    assert.deepEqual(fixture.itemOccurrences.filter((row:{isNew:boolean})=>row.isNew).map((row:{code:string})=>row.code),["tower_newbie_support_fund","pet_title_ticket"]);
    assert.match(migration,/BINARY item_row\.display_name=BINARY row_data\.source_item_name/);
  });
  it("records the complete event reward replacement",()=>{
    assert.deepEqual(fixture.eventRewardReplacement,{boss:"🧙‍♂️할법사",before:{item:"마정석🔮",quantity:100},after:{item:"펫스킬북 조각📙",quantity:3}});
    assert.equal(fixture.rewards.filter((row:{sourceKind:string;sourceItemName:string;quantity:number})=>row.sourceKind==="EVENT"&&row.sourceItemName==="펫스킬북 조각📙"&&row.quantity===3).length,1);
  });
  it("does not mutate tower consumers, ownership, operations or legacy tables",()=>{
    for(const table of ["trial_tower_boss_bands","trial_tower_event_bosses","inventory_stacks","inventory_ledger","operations","command_audit","outbox_messages","command_registry","command_aliases"])assert.doesNotMatch(migration,new RegExp(`(?:INSERT|UPDATE|DELETE)\\s+(?:INTO\\s+|FROM\\s+)?${table}\\b`,"i"));
  });
  it("is idempotent and narrowly reversible",()=>{
    assert.match(migration,/^SET NAMES utf8mb4;\s*START TRANSACTION;/);
    assert.match(migration,/ON DUPLICATE KEY UPDATE version_code=VALUES\(version_code\)/);
    assert.match(rollback,/version_code='ASSET-FREEZE-v2\.438-tower-reward-target-01'/);
    assert.match(rollback,/tower_newbie_support_fund','pet_title_ticket/);
    assert.doesNotMatch(rollback,/DELETE FROM (?:trial_tower_boss_bands|inventory_stacks|inventory_ledger)/i);
  });
});
