import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isEligibleGuildTerritoryAttacker, isGuildTerritoryWarReadyCommand, normalizeGuildTerritoryRole } from "../src/guild/guild-territory-war-ready-service.js";
describe("guild territory war ready boundary",()=>{
  it("accepts only the exact command",()=>{assert.equal(isGuildTerritoryWarReadyCommand("/길드영지준비"),true);for(const value of[undefined,"/길드영지준비 1","/길드영지준비확인","안내 /길드영지준비"])assert.equal(isGuildTerritoryWarReadyCommand(value),false);});
  it("normalizes legacy leadership role codes",()=>{assert.equal(normalizeGuildTerritoryRole("leader"),"master");assert.equal(normalizeGuildTerritoryRole("submaster"),"sub_master");assert.equal(normalizeGuildTerritoryRole("member"),"member");});
  it("accepts every current sword master",()=>{assert.equal(isEligibleGuildTerritoryAttacker("sword_master","member"),true);assert.equal(isEligibleGuildTerritoryAttacker("sword_master","sub_master"),true);});
  it("accepts combat commander only for the current guild master",()=>{assert.equal(isEligibleGuildTerritoryAttacker("combat_commander","master"),true);assert.equal(isEligibleGuildTerritoryAttacker("combat_commander","leader"),true);assert.equal(isEligibleGuildTerritoryAttacker("combat_commander","sub_master"),false);assert.equal(isEligibleGuildTerritoryAttacker("combat_commander","member"),false);});
});
