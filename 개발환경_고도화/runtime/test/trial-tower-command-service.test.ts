import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatTrialTowerResult, isTrialTowerCommand } from "../src/trial/trial-tower-command-service.js";

describe("trial tower command boundary", () => {
  it("accepts only the exact legacy execution command", () => {
    assert.equal(isTrialTowerCommand("/시련의탑"), true);
    assert.equal(isTrialTowerCommand("/시련의탑 1"), false);
    assert.equal(isTrialTowerCommand(" /시련의탑"), false);
  });
  it("formats persisted policy without rerolling", () => {
    const data = formatTrialTowerResult({ status: "win", data: "", outboxId: "1", floor: "7", policy: { win: true, directWin: false, playerFinal: 1234567, triggeredSkill: "시련을 걷는 자", guideUsed: false, junkReward: 20, worship: true, samples: [0,0,0,0,0,0] } });
    assert.match(data, /시련의 탑 7층/); assert.match(data, /1,234,567/); assert.match(data, /시련을 걷는 자/); assert.match(data, /잡동사니 20개/); assert.equal((data.match(/​/g) ?? []).length, 500);
  });
});
