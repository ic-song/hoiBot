import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPlayerLevelResetCommand } from "../src/player/player-level-reset-service.js";

describe("player level reset command boundary", () => {
  it("accepts only the exact legacy command", () => {
    assert.equal(isPlayerLevelResetCommand("/레벨리셋"), true);
  });

  it("rejects suffix and argument forms", () => {
    assert.equal(isPlayerLevelResetCommand("/레벨리셋 1"), false);
    assert.equal(isPlayerLevelResetCommand("/레벨리셋해줘"), false);
  });

  it("rejects empty and similar reset commands", () => {
    assert.equal(isPlayerLevelResetCommand(undefined), false);
    assert.equal(isPlayerLevelResetCommand("/좋아리셋"), false);
  });
});
