import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isRingRewardUseCommand, parseRingRewardUseCount } from "../src/ring/ring-reward-use-service.js";

describe("ring reward use command", () => {
  it("accepts no argument or one full decimal integer only", () => {
    for (const value of ["/보상받기", "/보상받기 0", "/보상받기 123"]) assert.equal(isRingRewardUseCommand(value), true);
    for (const value of ["/보상받기 ", "/보상받기 -1", "/보상받기 1 해봐", "/보상받기 1.5"]) assert.equal(isRingRewardUseCommand(value), false);
  });
  it("defaults the no-argument form to one", () => assert.equal(parseRingRewardUseCount("/보상받기"), 1n));
  it("keeps zero for the legacy usage-error branch", () => assert.equal(parseRingRewardUseCount("/보상받기 0"), 0n));
  it("preserves integer precision beyond the JavaScript safe range", () => assert.equal(parseRingRewardUseCount("/보상받기 9007199254740993"), 9007199254740993n));
});
