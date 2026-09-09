import assert from "node:assert/strict";
import { describe,it } from "node:test";
import { formatServerStats,isServerStatsCommand,projectLegacyMemberStats } from "../src/admin/server-stats-service.js";
import { sortServerStatCounts } from "../src/admin/server-stats-repository.js";
import { isPointEditCommandCandidate } from "../src/admin/iris-admin-command-service.js";

describe("admin server stats",()=>{
  it("accepts only the exact command through the common app candidate",()=>{assert.equal(isServerStatsCommand("/서버통계"),true);assert.equal(isPointEditCommandCandidate("/서버통계"),true);assert.equal(isServerStatsCommand("/서버통계 "),false);assert.equal(isPointEditCommandCandidate("/서버통계 "),false);assert.equal(isServerStatsCommand("/서버통계 안내"),false);});
  it("sorts by Korean display name and stable code",()=>{const rows=sortServerStatCounts([{serverCode:"B",serverDisplayName:"나 서버",activeMemberCount:2n},{serverCode:"A",serverDisplayName:"가 서버",activeMemberCount:1n},{serverCode:"C",serverDisplayName:"가 서버",activeMemberCount:3n}]);assert.deepEqual(rows.map(row=>row.serverCode),["A","C","B"]);});
  it("projects every legacy member and excludes only unregistered servers",()=>{const result=projectLegacyMemberStats(JSON.stringify({member:{가:{server:"서버 B"},나:{server:"서버 A"},다:{server:"서버 A"},라:{server:""},마:{}}}));assert.equal(result.memberCount,5);assert.equal(result.unregisteredMemberCount,2);assert.deepEqual(result.rows.map(row=>[row.serverDisplayName,row.activeMemberCount]),[["서버 A",2n],["서버 B",1n]]);});
  it("pins the legacy Korean punctuation and numeric collation fixture independently",()=>{const result=projectLegacyMemberStats(JSON.stringify({member:{a:{server:"나 서버"},b:{server:"가-서버"},c:{server:"2 서버"},d:{server:"가 서버"},e:{server:"10 서버"}}}));assert.deepEqual(result.rows.map(row=>row.serverDisplayName),["10 서버","2 서버","가 서버","가-서버","나 서버"]);});
  it("formats exact legacy output and empty state",()=>{const output=formatServerStats([{serverCode:"A",serverDisplayName:"가 서버",activeMemberCount:2n}],3,1);assert.equal(output,`📊 서버유저 통계 📊\n\n서버 전체인원: 2명\n\n${"\u200b".repeat(500)}가능 서버:\n- 가 서버: 2명\n\n※ 서버 미등록 인원: 1명`);assert.equal(formatServerStats([],0,0),"📭 등록된 유저가 없습니다.");assert.equal(formatServerStats([],2,2),`📊 서버유저 통계 📊\n\n서버 전체인원: 0명\n\n${"\u200b".repeat(500)}가능 서버:\n\n※ 서버 미등록 인원: 2명`);});
});
