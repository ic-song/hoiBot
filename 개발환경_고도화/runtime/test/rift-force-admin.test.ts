import assert from "node:assert/strict";
import test from "node:test";
import { isRiftForceAdminCommand, isRiftForceDevelopmentContext, parseRiftForceAdminCommand } from "../src/guild/rift-force-admin-service.js";

test("rift force admin command boundary",async t=>{
  await t.test("accepts only the two exact legacy commands",()=>{assert.equal(parseRiftForceAdminCommand("/강제균열"),"rift");assert.equal(parseRiftForceAdminCommand("/강제대균열"),"greatRift");});
  await t.test("rejects suffix text and similar user commands",()=>{assert.equal(isRiftForceAdminCommand("/강제균열 안내"),false);assert.equal(isRiftForceAdminCommand("/균열"),false);});
  await t.test("blocks production independently of rollout",()=>{assert.equal(isRiftForceDevelopmentContext("production"),false);assert.equal(isRiftForceDevelopmentContext("development"),true);});
});
