import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveTrialTower, trialJunkReward } from "../src/trial/trial-tower-provider.js";

describe("trial tower policy", () => {
  it("keeps floor ties as boss wins", () => {
    const result = resolveTrialTower({ charm: 1000, petType: null, upgrade: 0, skills: [] }, { charm: 1000, petType: null }, [.9, .9, .9, .9, 0, .9], false);
    assert.equal(result.win, false); assert.equal(result.directWin, false);
  });
  it("applies salvation before type and critical multipliers", () => {
    const result = resolveTrialTower({ charm: 1000, petType: "하늘", upgrade: 100, skills: ["구원"] }, { charm: 900000, petType: "땅" }, [0, 0, .9, .9, 0, .9], false);
    assert.equal(result.triggeredSkill, "구원"); assert.equal(result.playerFinal, Math.round(Math.round(501000 * 1.3) * 1.7)); assert.equal(result.win, true);
  });
  it("consumes a guide on a direct loss and preserves 70 percent boundary", () => {
    assert.equal(resolveTrialTower({ charm: 1, petType: null, upgrade: 0, skills: [] }, { charm: 1000, petType: null }, [.9, .9, .9, .699, 0, .9], true).win, true);
    const fail = resolveTrialTower({ charm: 1, petType: null, upgrade: 0, skills: [] }, { charm: 1000, petType: null }, [.9, .9, .9, .7, 0, .9], true);
    assert.equal(fail.win, false); assert.equal(fail.guideUsed, true);
  });
  it("preserves junk roulette boundaries", () => {
    assert.deepEqual([trialJunkReward(0), trialJunkReward(.86), trialJunkReward(.96), trialJunkReward(.99), trialJunkReward(.999)], [1, 5, 20, 50, 300]);
  });
});
