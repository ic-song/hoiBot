import assert from "node:assert/strict";
import { describe,it } from "node:test";
import { isCastleBattleSeasonCloseCommand } from "../src/castle/castle-battle-season-close-service.js";

describe("castle battle season close boundary",()=>{
  it("accepts only the exact command",()=>assert.equal(isCastleBattleSeasonCloseCommand("/캐슬대전시즌종료"),true));
  it("rejects whitespace suffix",()=>assert.equal(isCastleBattleSeasonCloseCommand("/캐슬대전시즌종료 "),false));
  it("rejects argument and guide suffix",()=>{assert.equal(isCastleBattleSeasonCloseCommand("/캐슬대전시즌종료 1"),false);assert.equal(isCastleBattleSeasonCloseCommand("/캐슬대전시즌종료해줘"),false);});
  it("does not collide with season start or reset",()=>{assert.equal(isCastleBattleSeasonCloseCommand("/캐슬대전시즌시작"),false);assert.equal(isCastleBattleSeasonCloseCommand("/캐슬대전초기화"),false);});
});
