import assert from "node:assert/strict";
import test from "node:test";
import { formatOverallRankRewardPayout, isOverallRankRewardPayoutCommand } from "../src/admin/overall-rank-reward-payout-service.js";
import type { PlayerOverallRankRow } from "../src/player/player-overall-rank-read-service.js";

const row=(id:number):PlayerOverallRankRow=>({playerId:String(id),displayName:`회원${id}`,rankEmoji:"",sourceOrder:null,totalCharm:String(1000-id),castleCharm:"0",raidCharm:"0",effectiveEnhancement:"0"});

test("종합 순위 보상은 exact 명령만 허용한다",()=>{
  assert.equal(isOverallRankRewardPayoutCommand("/보상지급"),true);
  for(const value of [undefined,"/보상지급 ","/보상지급 1","보상지급","/종합순위보상"]) assert.equal(isOverallRankRewardPayoutCommand(value),false);
});

test("종합 순위 보상 응답은 10위 뒤 allsee와 합계를 보존한다",()=>{
  const rows=Array.from({length:11},(_,index)=>row(index+1));
  const data=formatOverallRankRewardPayout("2026-08-29","펫 강화석⭐",rows,rows.map(()=>2n));
  assert.match(data,/1위 \[회원1\]/); assert.match(data,/11위 \[회원11\]/); assert.match(data,/총 지급: 펫 강화석⭐ 22개/);
  assert.equal((data.match(/\u200b/g)??[]).length,500);
});

test("대상이 없어도 완료와 0개를 명시한다",()=>{
  const data=formatOverallRankRewardPayout("2026-08-29","펫 강화석⭐",[],[]);
  assert.match(data,/지급 대상자가 없습니다/); assert.match(data,/총 지급: 펫 강화석⭐ 0개/);
});
