import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatMatzangBattle, parseMatzangCommand } from "../src/battle/matzang-command-service.js";

describe("matzang command boundary", () => {
  it("accepts only exact legacy battle aliases and rank command", () => {
    assert.equal(parseMatzangCommand("/맞짱"), "battle"); assert.equal(parseMatzangCommand("ㅁㅁ"), "battle"); assert.equal(parseMatzangCommand("/맞짱순위"), "rank");
    assert.equal(parseMatzangCommand("/맞짱 1"), undefined); assert.equal(parseMatzangCommand("/맞짱순위 안내"), undefined);
  });
  it("formats the persisted projection without recalculating battle values", () => {
    const data = formatMatzangBattle({ attacker:{playerId:"1",displayName:"알파",base:100,petType:"하늘",upgrade:1,buffed:130,final:221,critical:true}, defender:{playerId:"2",displayName:"베타",base:100,petType:"땅",upgrade:1,buffed:100,final:100,critical:false}, attackerWin:true,gainedPt:12,rewardPoint:"50000000",count:1,pt:"12",remaining:9 });
    assert.match(data,/알파 VS 베타/); assert.match(data,/승자: 알파/); assert.match(data,/획득 PT: 12/); assert.match(data,/남은 횟수: 9/);
  });
});
