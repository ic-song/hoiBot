import assert from "node:assert/strict";
import { describe,it } from "node:test";
import { buildGuildLegacyFundCleanupMessage,isGuildLegacyFundCleanupCommand } from "../src/guild/guild-legacy-fund-cleanup-service.js";

describe("guild legacy fund cleanup boundary",()=>{
  it("accepts only the exact command",()=>{assert.equal(isGuildLegacyFundCleanupCommand("/길드fund삭제"),true);for(const value of [undefined,"길드fund삭제","/길드fund삭제 ","/길드fund삭제 1","/길드fund삭제안내"])assert.equal(isGuildLegacyFundCleanupCommand(value),false);});
  it("renders scanned, deleted and skipped counts",()=>{const message=buildGuildLegacyFundCleanupMessage({scannedCount:4n,deletedCount:2n,skippedCount:2n,deletedSourceKeys:["G1","G2"]});assert.match(message,/총 길드 : 4/);assert.match(message,/삭제 : 2/);assert.match(message,/건너뜀 : 2/);});
  it("renders every deleted source key",()=>{const message=buildGuildLegacyFundCleanupMessage({scannedCount:2n,deletedCount:2n,skippedCount:0n,deletedSourceKeys:["OWN","INHERITED"]});assert.match(message,/OWN/);assert.match(message,/INHERITED/);});
  it("keeps an explicit no-op projection",()=>assert.match(buildGuildLegacyFundCleanupMessage({scannedCount:3n,deletedCount:0n,skippedCount:3n,deletedSourceKeys:[]}),/삭제 내역 없음/));
});
