import assert from "node:assert/strict";
import { describe,it } from "node:test";
import { isMiniPetBattleCommand,resolveMiniPetBattle,type MiniPetBattleCombatant } from "../src/mini-pet/mini-pet-battle-execute-service.js";

const reward={itemId:"1",itemCode:"junk",itemName:"잡템☠️",quantity:1};
function fighter(id:string,overrides:Partial<MiniPetBattleCombatant>={}):MiniPetBattleCombatant{return{playerId:id,displayName:`유저${id}`,level:10,experience:0,pointBalance:0n,wins:0,losses:0,battleCount:0,freeUsed:0,boosterCount:5,resetTicketItemId:"2",resetTicketCount:2,premium:false,equippedId:id,miniName:`미니${id}`,miniEmoji:"🐹",miniGrade:"A",miniUpgrade:0,equippedCharm:1000,bagCount:5,totalCharm:id==="1"?6000:3000,effectiveUpgradeLevel:0,hasHunter:false,hasMaxHunter:false,hasRobber:false,hasMindWin:false,hasBeastInstinct:false,...overrides};}

describe("mini pet battle execute",()=>{
  it("accepts only the exact command",()=>{assert.equal(isMiniPetBattleCommand("/미니펫대전"),true);assert.equal(isMiniPetBattleCommand("/미니펫대전 1"),false);assert.equal(isMiniPetBattleCommand("/미니펫대전순위"),false);});
  it("replays deterministic battle policy without reordering stable bag ids",()=>{const input={attacker:fighter("1"),candidates:[fighter("1"),fighter("2")],rewards:[reward],seed:"fixed"};const a=resolveMiniPetBattle(input),b=resolveMiniPetBattle(input);assert.deepEqual(a,b);assert.equal(a.attacker.battleCount,1);assert.equal(a.attacker.freeUsed,1);assert.equal(a.resetTicketDelta,0);assert.match(a.messages[0]!,/미니펫 대전/);});
  it("separates direct 15 and auto 20 while preserving ticket use",()=>{assert.throws(()=>resolveMiniPetBattle({attacker:fighter("1",{battleCount:15,freeUsed:1}),candidates:[fighter("2")],rewards:[reward],seed:"limit"}),/15회/);const auto=resolveMiniPetBattle({attacker:fighter("1",{battleCount:15,freeUsed:1}),candidates:[fighter("2")],rewards:[reward],seed:"limit",maxRuns:20});assert.equal(auto.attacker.battleCount,16);assert.equal(auto.resetTicketDelta,-1);assert.equal(auto.attacker.resetTicketCount,1);});
});
