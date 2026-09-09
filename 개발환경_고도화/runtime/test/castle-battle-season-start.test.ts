import assert from "node:assert/strict";
import { describe,it } from "node:test";
import { isCastleBattleSeasonStartCommand } from "../src/castle/castle-battle-season-start-service.js";

describe("castle battle season start boundary",()=>{
  it("accepts only the exact command",()=>assert.equal(isCastleBattleSeasonStartCommand("/캐슬대전시즌시작"),true));
  it("rejects whitespace suffix",()=>assert.equal(isCastleBattleSeasonStartCommand("/캐슬대전시즌시작 "),false));
  it("rejects argument and guide suffix",()=>{assert.equal(isCastleBattleSeasonStartCommand("/캐슬대전시즌시작 1"),false);assert.equal(isCastleBattleSeasonStartCommand("/캐슬대전시즌시작해줘"),false);});
  it("does not collide with battle execution",()=>assert.equal(isCastleBattleSeasonStartCommand("/캐슬대전"),false));
});
