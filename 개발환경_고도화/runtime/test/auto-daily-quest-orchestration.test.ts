import assert from "node:assert/strict";
import { describe,it } from "node:test";
import type { DatabaseTransaction } from "../src/database.js";
import { createScopedDatabaseClient } from "../src/database.js";
import { buildAutoDailyQuestPlan,formatAutoDailyQuestResult,isAutoDailyQuestCommand } from "../src/quest/auto-daily-quest-orchestration-service.js";

describe("auto daily quest orchestration",()=>{
  it("accepts only the two exact legacy triggers",()=>{for(const value of ["/자동일퀘","ㅇㅋㅋ"])assert.equal(isAutoDailyQuestCommand(value),true);for(const value of [" /자동일퀘","/자동일퀘 1","ㅇㅋㅋㅋ",undefined])assert.equal(isAutoDailyQuestCommand(value),false);});
  it("plans only the remaining runs through the bonus limit",()=>{assert.deepEqual(buildAutoDailyQuestPlan({tower:15n,castle:19n,mini:20n}),{towerRuns:5,castleRuns:1,miniRuns:0});assert.deepEqual(buildAutoDailyQuestPlan({tower:21n,castle:20n,mini:30n}),{towerRuns:0,castleRuns:0,miniRuns:0});});
  it("reuses one transaction and rolls back a failed child to its savepoint",async()=>{const calls:string[]=[];const tx:DatabaseTransaction={query:async<T>()=>[] as T,execute:async(sql)=>{calls.push(sql);return{affectedRows:0n,insertId:0n};}};const scoped=createScopedDatabaseClient(tx);await assert.rejects(()=>scoped.withTransaction(async nested=>{await nested.execute("CHILD_MUTATION");throw new Error("child failure");}),/child failure/);assert.deepEqual(calls,["SAVEPOINT scoped_provider_1","CHILD_MUTATION","ROLLBACK TO SAVEPOINT scoped_provider_1","RELEASE SAVEPOINT scoped_provider_1"]);});
  it("keeps the bonus and concise aggregate result visible",()=>{const text=formatAutoDailyQuestResult({runs:{towerRuns:5,castleRuns:1,miniRuns:0},claimedScopes:["DAILY"],stopReasons:[]});assert.match(text,/자동일퀘 보너스 발동/);assert.match(text,/시련의탑: 5회/);assert.match(text,/퀘스트 보상: DAILY/);});
});
