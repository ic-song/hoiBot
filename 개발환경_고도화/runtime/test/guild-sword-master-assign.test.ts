import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isGuildSwordMasterAssignCandidate, parseGuildSwordMasterAssign, resolveGuildSwordMasterCapacity } from "../src/guild/guild-sword-master-assign-service.js";

describe("guild sword-master assign boundary",()=>{
  it("recognizes only the exact namespace",()=>{assert.equal(isGuildSwordMasterAssignCandidate("/소드마스터"),true);assert.equal(isGuildSwordMasterAssignCandidate("/소드마스터 1 2 3"),true);for(const value of[undefined,"/소드마스터안내","안내 /소드마스터 1 2 3"])assert.equal(isGuildSwordMasterAssignCandidate(value),false);});
  it("accepts exactly three or four unique positive member numbers",()=>{assert.deepEqual(parseGuildSwordMasterAssign("/소드마스터 1 2 3").memberNumbers,[1,2,3]);assert.deepEqual(parseGuildSwordMasterAssign("/소드마스터 1 2 3 4").memberNumbers,[1,2,3,4]);for(const value of["/소드마스터","/소드마스터 1 2","/소드마스터 1 2 3 4 5","/소드마스터 1 1 2","/소드마스터 0 2 3","/소드마스터 1 2 안내"])assert.throws(()=>parseGuildSwordMasterAssign(value));});
  it("expands capacity only with 기사단 증원",()=>{assert.equal(resolveGuildSwordMasterCapacity(false),3);assert.equal(resolveGuildSwordMasterCapacity(true),4);});
});
