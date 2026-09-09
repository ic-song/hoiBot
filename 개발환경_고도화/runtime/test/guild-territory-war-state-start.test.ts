import assert from "node:assert/strict";
import { describe,it } from "node:test";
import { formatGuildTerritoryPrepareMessage,isGuildTerritoryWarStateStartCommand,shuffleGuildTerritoryAttackers,type GuildTerritoryAttacker } from "../src/guild/guild-territory-war-state-start-service.js";

const attackers:GuildTerritoryAttacker[]=[
  {guildId:1n,guildName:"첫길드",guildMark:"A",playerId:11n,playerName:"첫공격자",rankEmoji:"🥇"},
  {guildId:2n,guildName:"둘길드",guildMark:"B",playerId:22n,playerName:"둘공격자",rankEmoji:"🥈"},
  {guildId:3n,guildName:"셋길드",guildMark:null,playerId:33n,playerName:"셋공격자",rankEmoji:null}
];

describe("guild territory war state start",()=>{
  it("accepts only the exact command",()=>{assert.equal(isGuildTerritoryWarStateStartCommand("/길드영지시작"),true);assert.equal(isGuildTerritoryWarStateStartCommand("/길드영지시작 "),false);assert.equal(isGuildTerritoryWarStateStartCommand("/길드영지시작 1"),false);});
  it("records deterministic shuffle draws",()=>{const values=[0,0.5];let index=0;const result=shuffleGuildTerritoryAttackers(attackers,()=>values[index++]!);assert.deepEqual(result.rows.map(row=>row.guildId),[3n,2n,1n]);assert.deepEqual(result.draws.map(draw=>[draw.upperBound,draw.selectedIndex]),[[3,0],[2,1]]);});
  it("rejects out-of-range RNG samples",()=>assert.throws(()=>shuffleGuildTerritoryAttackers(attackers,()=>1),/표본/));
  it("preserves the twenty-second preparation notice",()=>assert.equal(formatGuildTerritoryPrepareMessage(),"[🏰 길드 영지전 준비 🏰]\n[길드 영지전 20초뒤 시작🏰]\n\n길드영지전쟁에 참여해주신\n길드 여러분 환영합니다.\n\n※ 20초뒤 길드영지전이 시작됩니다.\nhttps://open.kakao.com/o/gaP4Xybh"));
});
