import assert from "node:assert/strict";
import {describe,it} from "node:test";
import {classifyGuildTerritoryWarFinish,isGuildTerritoryWarFinishCommand} from "../src/guild/guild-territory-war-finish-service.js";

describe("guild territory war finish boundary",()=>{
  it("accepts only the exact manual command",()=>{assert.equal(isGuildTerritoryWarFinishCommand("/길드영지종료"),true);for(const value of ["/길드영지종료 ","/길드영지종료 1","길드영지종료"," /길드영지종료",undefined])assert.equal(isGuildTerritoryWarFinishCommand(value),false);});
  it("settles active wars and only cancels pending inactive starts",()=>{assert.equal(classifyGuildTerritoryWarFinish(true,"ACTIVE_READY"),"settle");assert.equal(classifyGuildTerritoryWarFinish(false,"PENDING_START"),"cancel_pending");assert.equal(classifyGuildTerritoryWarFinish(false,"READY"),"inactive");});
});
