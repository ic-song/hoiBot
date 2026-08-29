import assert from "node:assert/strict";
import { describe,it } from "node:test";
import { isGuildTerritoryOccupationResetCommand,resolveTerritoryResetLifecycle } from "../src/guild/guild-territory-occupation-reset-service.js";

describe("guild territory occupation reset boundary",()=>{
  it("accepts only the exact command",()=>{assert.equal(isGuildTerritoryOccupationResetCommand("/길드영지초기화"),true);for(const value of[undefined,"/길드영지초기화 ","/길드영지초기화 1","/길드영지초기화확인","안내 /길드영지초기화"])assert.equal(isGuildTerritoryOccupationResetCommand(value),false);});
  it("cancels only a non-active pending start",()=>{assert.equal(resolveTerritoryResetLifecycle(false,"PENDING_START"),"READY");assert.equal(resolveTerritoryResetLifecycle(true,"ACTIVE_OPENING"),"ACTIVE_OPENING");assert.equal(resolveTerritoryResetLifecycle(true,"ACTIVE_READY"),"ACTIVE_READY");assert.equal(resolveTerritoryResetLifecycle(false,"READY"),"READY");});
});
