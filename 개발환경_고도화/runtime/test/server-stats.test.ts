import assert from "node:assert/strict";
import { describe,it } from "node:test";
import { formatServerStats,isServerStatsCommand } from "../src/admin/server-stats-service.js";
import { sortServerStatCounts } from "../src/admin/server-stats-repository.js";

describe("admin server stats",()=>{
  it("accepts only the exact command",()=>{assert.equal(isServerStatsCommand("/서버통계"),true);assert.equal(isServerStatsCommand("/서버통계 "),false);assert.equal(isServerStatsCommand("/서버통계 안내"),false);});
  it("sorts by Korean display name and stable code",()=>{const rows=sortServerStatCounts([{serverCode:"B",serverDisplayName:"나 서버",activeMemberCount:2n},{serverCode:"A",serverDisplayName:"가 서버",activeMemberCount:1n},{serverCode:"C",serverDisplayName:"가 서버",activeMemberCount:3n}]);assert.deepEqual(rows.map(row=>row.serverCode),["A","C","B"]);});
  it("formats bigint counts, total and empty state",()=>{assert.equal(formatServerStats([{serverCode:"A",serverDisplayName:"가 서버",activeMemberCount:1234567n}]),"📊 서버 통계\n━━━━━━━━━━━━\n가 서버: 1,234,567명\n━━━━━━━━━━━━\n전체 활성 회원: 1,234,567명");assert.match(formatServerStats([]),/활성 서버 회원이 없습니다\.[\s\S]*전체 활성 회원: 0명/);});
});
