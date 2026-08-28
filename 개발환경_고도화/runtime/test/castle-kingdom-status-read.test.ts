import assert from "node:assert/strict";
import { describe,it } from "node:test";
import { formatCastleKingdomStatus,isCastleKingdomStatusReadCommand } from "../src/castle/castle-kingdom-status-read-service.js";

describe("castle kingdom status read",()=>{
  it("accepts only the exact command",()=>{
    assert.equal(isCastleKingdomStatusReadCommand("/호월킹덤"),true);
    for(const value of[undefined,"호월킹덤","/호월킹덤 ","/호월킹덤 1"]) assert.equal(isCastleKingdomStatusReadCommand(value),false);
  });
  it("formats stable lord guild tax charm and earnings fields",()=>{
    const data=formatCastleKingdomStatus({lordName:"영주",lordRank:"👑",petName:"펫",guildName:"호이",guildMark:"⭐",serverName:"호1",castleCharm:123456n,taxRateBasisPoints:1250,earnings:9007199254740993n});
    assert.match(data,/영주: 👑영주/);assert.match(data,/길드: 호이\(⭐\)/);assert.match(data,/캐슬 매력: 123,456💕/);
    assert.match(data,/세율: 12.5%/);assert.match(data,/수익: 9,007,199,254,740,993 Point/);
  });
  it("keeps the no-lord projection explicit",()=>assert.equal(formatCastleKingdomStatus(null),"🏰 호월킹덤 🏰\n\n현재 영주가 없습니다."));
});
