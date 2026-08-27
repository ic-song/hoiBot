import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isCastleBattleExecuteCommand,
  resolveCastleBattle,
  type CastleBattleCombatant,
  type CastleBattleRankDefinition
} from "../src/castle/castle-battle-execute-service.js";

const ranks: CastleBattleRankDefinition[] = [
  { scoreRequirement:0,tierPoint:1,rankName:"👻루키♦️" },
  { scoreRequirement:30,tierPoint:2,rankName:"👻루키♥️" }
];

function fighter(playerId: string, overrides: Partial<CastleBattleCombatant> = {}): CastleBattleCombatant {
  return {
    playerId,displayName:`유저${playerId}`,level:10,experience:20,pointBalance:0n,score:0,wins:0,losses:0,tierPoint:1,
    battleCount:0,freeUsed:0,boosterCount:5,resetTicketItemId:"1",resetTicketCount:2,petId:playerId,
    petName:`펫${playerId}`,petImage:"🐶",petType:playerId === "1" ? "하늘" : "땅",petExperience:1000,
    castleCharm:playerId === "1" ? 2000 : 1000,effectiveUpgradeLevel:0,hasExperiencedWarrior:false,hasMindWin:false,...overrides
  };
}

describe("castle battle execute", () => {
  it("accepts only the exact command", () => {
    assert.equal(isCastleBattleExecuteCommand("/캐슬대전"),true);
    assert.equal(isCastleBattleExecuteCommand("/캐슬대전 1"),false);
    assert.equal(isCastleBattleExecuteCommand("/캐슬대전순위"),false);
  });

  it("deterministically settles matching, free use, point and experience", () => {
    const first = resolveCastleBattle({ attacker:fighter("1"),candidates:[fighter("1"),fighter("2")],rankDefinitions:ranks,seed:"fixed" });
    const replay = resolveCastleBattle({ attacker:fighter("1"),candidates:[fighter("1"),fighter("2")],rankDefinitions:ranks,seed:"fixed" });
    assert.deepEqual(first,replay);
    assert.equal(first.attacker.battleCount,1);
    assert.equal(first.attacker.freeUsed,1);
    assert.equal(first.resetTicketDelta,0);
    assert.equal(first.attacker.pointBalance,10_000_000n);
    assert.match(first.messages[0]!,/획득 포인트🤑: 🅟7,000,000/);
  });

  it("keeps direct 15 and internal auto 20 boundaries separate", () => {
    assert.throws(() => resolveCastleBattle({ attacker:fighter("1",{ battleCount:15,freeUsed:1 }),candidates:[fighter("2")],rankDefinitions:ranks,seed:"limit" }),/15회/);
    const auto = resolveCastleBattle({ attacker:fighter("1",{ battleCount:15,freeUsed:1 }),candidates:[fighter("2")],rankDefinitions:ranks,seed:"limit",maxRuns:20 });
    assert.equal(auto.attacker.battleCount,16);
    assert.equal(auto.resetTicketDelta,-1);
    assert.equal(auto.attacker.resetTicketCount,1);
  });
});
