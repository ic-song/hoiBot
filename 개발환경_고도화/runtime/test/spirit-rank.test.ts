import assert from "node:assert/strict";
import {describe,it} from "node:test";
import {formatSpiritRanking,isSpiritRankCommand,type SpiritRankRow} from "../src/pet/spirit-rank-service.js";
const row=(name:string,gradeOrder:number,level:bigint,order:bigint):SpiritRankRow=>({playerId:order.toString(),displayName:name,rankEmoji:"⭐",gradeOrder,enhancementLevel:level,sourceOrder:order});
describe("spirit rank command",()=>{
 it("accepts the exact legacy command only",()=>{assert.equal(isSpiritRankCommand("/정령순위"),true);for(const v of ["/정령순위 1","/정령순위안내","정령순위"])assert.equal(isSpiritRankCommand(v),false);});
 it("renders legacy grade-index scores and preserves input tie order",()=>{const data=formatSpiritRanking([row("가",2,5n,2n),row("나",2,5n,1n),row("다",1,99n,3n)]);assert.match(data,/🥇⭐가 - 강화 레벨: 105🔯/);assert.ok(data.indexOf("가")<data.indexOf("나"));assert.match(data,/🥉⭐다 - 강화 레벨: 99🔯/);});
 it("always inserts the 500-character allsee boundary after the first ten rows",()=>{const data=formatSpiritRanking(Array.from({length:11},(_,i)=>row(`유저${i+1}`,1,BigInt(20-i),BigInt(i+1))));assert.equal((data.match(/\u200b/g)??[]).length,500);assert.ok(data.indexOf("유저10")<data.indexOf("\u200b")&&data.indexOf("\u200b")<data.indexOf("유저11"));});
});
