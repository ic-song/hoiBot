import assert from "node:assert/strict";
import { describe,it } from "node:test";
import { isCastleBattleResetAllCommand } from "../src/castle/castle-battle-reset-all-service.js";

describe("castle battle reset all boundary",()=>{
  it("accepts only the exact command",()=>assert.equal(isCastleBattleResetAllCommand("/캐슬대전초기화"),true));
  it("rejects whitespace suffix",()=>assert.equal(isCastleBattleResetAllCommand("/캐슬대전초기화 "),false));
  it("rejects argument and guide suffix",()=>{assert.equal(isCastleBattleResetAllCommand("/캐슬대전초기화 1"),false);assert.equal(isCastleBattleResetAllCommand("/캐슬대전초기화해줘"),false);});
  it("does not collide with battle or season commands",()=>{assert.equal(isCastleBattleResetAllCommand("/캐슬대전"),false);assert.equal(isCastleBattleResetAllCommand("/캐슬대전시즌시작"),false);});
});
