import assert from "node:assert/strict";
import {describe,it} from "node:test";
import {formatCarrotBoard,isCarrotBoardReadCommand} from "../src/market/carrot-board-read-service.js";
describe("carrot board read",()=>{
 it("accepts only exact command",()=>{assert.equal(isCarrotBoardReadCommand("/당근게시판"),true);assert.equal(isCarrotBoardReadCommand("/당근게시판 "),false);assert.equal(isCarrotBoardReadCommand("/당근게시판 안내"),false);});
 it("renders empty state",()=>assert.match(formatCarrotBoard([]),/등록된 게시글이 없습니다/));
 it("preserves source order and rank",()=>{const data=formatCarrotBoard([{post_id:2n,author_name:"첫째",rank_emoji:"👑",body:"첫 글",legacy_date:"20260828"},{post_id:1n,author_name:"둘째",rank_emoji:null,body:"둘째 글",legacy_date:"20260827"}]);assert.ok(data.indexOf("첫째")<data.indexOf("둘째"));assert.match(data,/👑첫째/);});
 it("inserts exactly 500 allsee characters before post six",()=>{const posts=Array.from({length:6},(_,i)=>({post_id:BigInt(i+1),author_name:`작성자${i+1}`,rank_emoji:null,body:`글${i+1}`,legacy_date:"20260828"}));const data=formatCarrotBoard(posts);const marker="\u200b".repeat(500);assert.equal((data.match(/\u200b/g)||[]).length,500);assert.ok(data.indexOf(marker)<data.indexOf("작성자6"));});
});
