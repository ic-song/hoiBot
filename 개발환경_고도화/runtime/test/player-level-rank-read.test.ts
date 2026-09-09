import assert from "node:assert/strict";
import {describe,it} from "node:test";
import {formatPlayerLevelRanking,isPlayerLevelRankReadCommand} from "../src/player/player-level-rank-read-service.js";
const row=(name:string,level:string,id:string,rankEmoji="")=>({displayName:name,level,playerId:id,rankEmoji});
describe("player level rank read command",()=>{
 it("accepts only the exact legacy command",()=>{assert.equal(isPlayerLevelRankReadCommand("/레벨순위"),true);for(const v of [undefined,"레벨순위","/레벨순위 ","/레벨순위 1","/누렙순위"])assert.equal(isPlayerLevelRankReadCommand(v),false);});
 it("preserves the empty legacy header",()=>{assert.equal(formatPlayerLevelRanking([]),"🏆 레벨 순위 🏆");});
 it("preserves DB order, level labels and the rank-eleven allsee boundary",()=>{const data=formatPlayerLevelRanking(Array.from({length:12},(_,i)=>row(`회원${i+1}`,String(100-i),String(i+1),i===0?"⭐":"")));assert.match(data,/🥇\. ⭐회원1 - LV\.100/);assert.equal((data.match(/\u200b/g)??[]).length,500);assert.ok(data.indexOf("10위. 회원10")<data.indexOf("\u200b"));assert.ok(data.indexOf("\u200b")<data.indexOf("11위. 회원11"));assert.match(data,/12위\. 회원12 - LV\.89/);});
});
