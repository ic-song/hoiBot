import assert from "node:assert/strict";import test from "node:test";
import{formatAdminFullSyncResult,isAdminFullSyncCommand}from"../src/admin/admin-full-sync-service.js";
test("exact /전체동기화",()=>{assert.equal(isAdminFullSyncCommand("/전체동기화"),true);for(const value of["/전체동기화 ","/전체동기화 1","/전체동기화추가","전체동기화"])assert.equal(isAdminFullSyncCommand(value),false)});
test("summary reply once",()=>{const text=formatAdminFullSyncResult({syncedCount:3,missingMembers:["x"],duplicatedMembers:[],petRemovedCount:2,petTitleMemberCount:1,petTitleRemovedCount:4,trialUserCount:1,trialProgressRemovedCount:2,sourceReused:false});assert.equal(text.split("\n").length,7);assert.match(text,/길드 동기화: 3명/);assert.match(text,/펫타이틀 정리: 4건/)});
