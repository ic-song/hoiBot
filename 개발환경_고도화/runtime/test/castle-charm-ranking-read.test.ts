import assert from "node:assert/strict";
import { describe,it } from "node:test";
import { calculateCastleCharmScore,formatCastleCharmRanking,isCastleCharmRankingReadCommand,type CastleCharmRankingRow } from "../src/castle/castle-charm-ranking-read-service.js";

function row(playerId:string,score:bigint,sourceOrder:bigint|null):CastleCharmRankingRow{return{playerId,petId:playerId,sourceOrder,petImage:"🐶",petTitle:"[용감한]",petName:`펫${playerId}`,itemCastleCharm:0n,petExperience:score,miniPetCastleCharm:0n,homeCharm:0n,intimacyCharm:0n,personalCubePercent:"0",guildCubeUnits:0n,finalCastleCharm:score};}

describe("castle charm ranking read",()=>{
  it("accepts only the exact command",()=>{assert.equal(isCastleCharmRankingReadCommand("/캐슬매력순위"),true);for(const input of ["/캐슬매력순위 1","/캐슬매력순위목록","캐슬매력순위"])assert.equal(isCastleCharmRankingReadCommand(input),false);});
  it("adds only the legacy components and floors personal plus guild cube percentages with bigint math",()=>{assert.equal(calculateCastleCharmScore({itemCastleCharm:1000000n,petExperience:1000n,miniPetCastleCharm:200n,homeCharm:300n,intimacyCharm:400n,personalCubePercent:"10.000",guildCubeUnits:50n}),1152185n);assert.equal(calculateCastleCharmScore({itemCastleCharm:9007199254740993n,petExperience:0n,miniPetCastleCharm:0n,homeCharm:0n,intimacyCharm:0n,personalCubePercent:"0",guildCubeUnits:0n}),9007199254740993n);});
  it("renders stable snapshot order and inserts allsee after ten rows",()=>{const rows=Array.from({length:11},(_,index)=>row(String(index+1),BigInt(100-index),BigInt(index+1)));const data=formatCastleCharmRanking(rows);assert.match(data,/🥇\. 🐶\[용감한\] 펫1 👾 100/);assert.equal((data.match(/\u200b/g)??[]).length,500);assert.ok(data.indexOf("펫10")<data.indexOf("\u200b"));assert.ok(data.indexOf("\u200b")<data.indexOf("펫11"));});
  it("renders an explicit empty result",()=>{assert.equal(formatCastleCharmRanking([]),"🏆 [캐슬]매력 순위 🏆\n\n순위 대상이 없습니다.");});
});


