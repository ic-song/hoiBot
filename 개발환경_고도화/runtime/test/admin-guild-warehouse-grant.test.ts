import assert from "node:assert/strict";
import { describe,it } from "node:test";
import { isAdminGuildWarehouseGrantCommandCandidate,normalizeAdminGuildWarehouseGrantDispatchMessage,parseAdminGuildWarehouseGrantCommand } from "../src/admin/admin-guild-warehouse-grant-service.js";
describe("admin guild warehouse grant command",()=>{
  it("parses all five aliases, spaced guild names and comma amounts",()=>{for(const alias of ["/길드다이아창고","/길드자금","/길드펜던트창고","/길드펫강화석창고","/길드미니펫강화석창고"]){const parsed=parseAdminGuildWarehouseGrantCommand(`${alias} 호이 길드 1,234`);assert.equal(parsed?.kind,"grant");if(parsed?.kind==="grant"){assert.equal(parsed.guildName,"호이 길드");assert.equal(parsed.amount,1234n);}}});
  it("keeps exact aliases as usage and rejects suffix collisions",()=>{assert.equal(parseAdminGuildWarehouseGrantCommand("/길드자금")?.kind,"usage");assert.equal(parseAdminGuildWarehouseGrantCommand("/길드자금추가 길드 1"),null);assert.equal(isAdminGuildWarehouseGrantCommandCandidate("/길드다이아창고 길드 -1"),true);assert.equal(parseAdminGuildWarehouseGrantCommand("/길드다이아창고 길드 -1")?.kind,"usage");});
  it("normalizes parameterized aliases without merging resource identities",()=>{assert.equal(normalizeAdminGuildWarehouseGrantDispatchMessage("/길드펫강화석창고 호이 길드 10"),"/길드펫강화석창고 [길드명] [수량]");assert.equal(normalizeAdminGuildWarehouseGrantDispatchMessage("/길드미니펫강화석창고"),"/길드미니펫강화석창고");});
});
