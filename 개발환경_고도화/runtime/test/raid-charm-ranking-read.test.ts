import assert from "node:assert/strict";
import { describe,it } from "node:test";
import { calculateRaidCharmScore,formatRaidCharmRanking,isRaidCharmRankingReadCommand,type RaidCharmRankingRow } from "../src/raid/raid-charm-ranking-read-service.js";

function row(playerId:string,score:bigint,sourceOrder:bigint|null):RaidCharmRankingRow{return{playerId,petId:playerId,sourceOrder,petImage:"🐶",petTitle:"[용감한]",petName:`펫${playerId}`,itemRaidCharm:0n,petExperience:score,miniPetRaidCharm:0n,homeCharm:0n,personalCubePercent:"0",guildCubeUnits:0n,finalRaidCharm:score};}

describe("raid charm ranking read",()=>{
  it("accepts only the exact command",()=>{assert.equal(isRaidCharmRankingReadCommand("/레이드매력순위"),true);for(const input of ["/레이드매력순위 1","/레이드매력순위목록","레이드매력순위"])assert.equal(isRaidCharmRankingReadCommand(input),false);});
  it("adds only the legacy components and floors personal plus guild cube percentages with bigint math",()=>{assert.equal(calculateRaidCharmScore({itemRaidCharm:1000000n,petExperience:1000n,miniPetRaidCharm:200n,homeCharm:300n,personalCubePercent:"10.000",guildCubeUnits:50n}),1151725n);assert.equal(calculateRaidCharmScore({itemRaidCharm:9007199254740993n,petExperience:0n,miniPetRaidCharm:0n,homeCharm:0n,personalCubePercent:"0",guildCubeUnits:0n}),9007199254740993n);});
  it("renders stable snapshot order and inserts allsee after ten rows",()=>{const rows=Array.from({length:11},(_,index)=>row(String(index+1),BigInt(100-index),BigInt(index+1)));const data=formatRaidCharmRanking(rows);assert.match(data,/🥇\. 🐶\[용감한\] 펫1 👾 100/);assert.equal((data.match(/\u200b/g)??[]).length,500);assert.ok(data.indexOf("펫10")<data.indexOf("\u200b"));assert.ok(data.indexOf("\u200b")<data.indexOf("펫11"));});
  it("renders an explicit empty result",()=>{assert.equal(formatRaidCharmRanking([]),"🏆 [레이드]매력 순위 🏆\n\n순위 대상이 없습니다.");});
});
