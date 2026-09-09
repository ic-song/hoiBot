import assert from "node:assert/strict";
import { describe,it } from "node:test";
import { buildCastleStateResetProjection,isCastleStateResetActor,isCastleStateResetCommand } from "../src/castle/castle-state-reset-service.js";

describe("castle state reset",()=>{
  it("accepts only the exact command",()=>{assert.equal(isCastleStateResetCommand("/캐슬초기화"),true);for(const value of ["/캐슬초기화 ","/캐슬초기화 1","캐슬초기화"])assert.equal(isCastleStateResetCommand(value),false);});
  it("keeps the fixed legacy operator identity",()=>{assert.equal(isCastleStateResetActor("호이 남"),true);assert.equal(isCastleStateResetActor("호이 남자"),false);assert.equal(isCastleStateResetActor("총괄"),false);});
  it("maps the legacy twelve-percent tax and zero counters",()=>{assert.deepEqual(buildCastleStateResetProjection("7"),{lordPlayerId:"7",lordGuildName:null,taxRateBasisPoints:1200,earnings:"0",defenseCount:"0"});});
  it("builds a fresh immutable projection for each reset",()=>{const first=buildCastleStateResetProjection("1"),second=buildCastleStateResetProjection("2");assert.notEqual(first,second);assert.equal(first.lordPlayerId,"1");assert.equal(second.lordPlayerId,"2");});
});
