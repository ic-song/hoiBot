import assert from "node:assert/strict";
import test from "node:test";
import { formatForcedGreatRiftReply, formatForcedRiftReply, selectGreatRiftTarget } from "../src/guild/guild-territory-war-provider.js";

test("guild territory war provider policy",async t=>{
  await t.test("selects a stable great-rift target boundary",()=>{assert.equal(selectGreatRiftTarget(["a","b","c"],0.999)!.target,"c");});
  await t.test("returns no target for an empty ready set",()=>{assert.equal(selectGreatRiftTarget([],0.5),undefined);});
  await t.test("preserves the rift reset and limit projection",()=>{assert.match(formatForcedRiftReply(3),/점령 상태가 초기화/);assert.match(formatForcedRiftReply(3),/더 이상 균열 이벤트가 발생하지 않습니다/);});
  await t.test("preserves stable and selected great-rift projections",()=>{assert.match(formatForcedGreatRiftReply(),/전쟁불안정도 안정화/);assert.match(formatForcedGreatRiftReply("테스트 길드",1),/\[테스트 길드\] 길드/);});
});
