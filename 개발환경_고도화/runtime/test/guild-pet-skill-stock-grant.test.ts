import assert from "node:assert/strict";
import { describe,it } from "node:test";
import { normalizeGuildPetSkillStockGrantDispatchMessage,parseGuildPetSkillStockGrantCommand } from "../src/guild/guild-pet-skill-stock-grant-service.js";

describe("guild pet skill stock grant",()=>{
  it("separates exact usage from a free-form guild and positive bigint amount",()=>{
    assert.deepEqual(parseGuildPetSkillStockGrantCommand("/길드펫스킬창고"),{kind:"usage"});
    assert.deepEqual(parseGuildPetSkillStockGrantCommand("/길드펫스킬창고 대머리 길드 9007199254740993"),{kind:"grant",guildName:"대머리 길드",amount:9007199254740993n});
  });
  it("keeps malformed candidates on the legacy usage branch",()=>{
    assert.deepEqual(parseGuildPetSkillStockGrantCommand("/길드펫스킬창고 길드 -1"),{kind:"usage"});
    assert.deepEqual(parseGuildPetSkillStockGrantCommand("/길드펫스킬창고 길드 1 안내"),{kind:"usage"});
    assert.equal(parseGuildPetSkillStockGrantCommand("/길드펫스킬창고 "),null);
  });
  it("normalizes every non-exact candidate to one stable DB alias",()=>{
    assert.equal(normalizeGuildPetSkillStockGrantDispatchMessage("/길드펫스킬창고"),"/길드펫스킬창고");
    assert.equal(normalizeGuildPetSkillStockGrantDispatchMessage("/길드펫스킬창고 길드 10"),"/길드펫스킬창고 [길드명] [수량]");
  });
});
