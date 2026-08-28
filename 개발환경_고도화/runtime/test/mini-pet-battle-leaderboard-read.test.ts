import assert from "node:assert/strict";
import { describe,it } from "node:test";
import {
  buildMiniPetLeaderboard,formatMiniPetLeaderboard,isMiniPetBattleLeaderboardCommand,miniPetLeaderboardMode,
  type MiniPetLeaderboardRow
} from "../src/mini-pet/mini-pet-battle-leaderboard-read-service.js";

function row(playerId:string,displayName:string,wins:bigint,losses:bigint):MiniPetLeaderboardRow {
  const total=wins+losses;
  return {playerId,displayName,miniPetName:null,wins,losses,roundedWinRate:total===0n?0:Number((wins*100n+total/2n)/total)};
}

describe("mini pet battle leaderboard read",()=>{
  it("accepts only two exact commands",()=>{
    assert.equal(isMiniPetBattleLeaderboardCommand("/미니펫대전순위"),true);
    assert.equal(isMiniPetBattleLeaderboardCommand("/미니펫대전승률"),true);
    assert.equal(isMiniPetBattleLeaderboardCommand("/미니펫대전순위 1"),false);
    assert.equal(miniPetLeaderboardMode("/미니펫대전승률"),"rate");
  });
  it("filters fifty wins and keeps win-loss-Korean tie chain",()=>{
    const ranked=buildMiniPetLeaderboard([row("1","하나",49n,0n),row("2","나",50n,3n),row("3","가",50n,3n),row("4","다",51n,9n)],"wins");
    assert.deepEqual(ranked.map(value=>value.playerId),["4","3","2"]);
  });
  it("filters fifty games and orders rounded rate before wins and losses",()=>{
    const ranked=buildMiniPetLeaderboard([row("1","가",40n,10n),row("2","나",80n,20n),row("3","다",41n,9n),row("4","라",30n,19n)],"rate");
    assert.deepEqual(ranked.map(value=>value.playerId),["3","2","1"]);
  });
  it("uses sequential rank and inserts allsee before the eleventh row",()=>{
    const values=Array.from({length:12},(_,index)=>row(String(index+1),`회원${index+1}`,BigInt(100-index),1n));
    const data=formatMiniPetLeaderboard("wins",values);
    assert.match(data,/10위\./);assert.match(data,/11위\./);assert.equal(data.includes("​".repeat(500)),true);
  });
  it("keeps the empty projection explicit",()=>{
    assert.match(formatMiniPetLeaderboard("rate",[]),/조건을 충족한 회원이 없습니다/);
  });
});
