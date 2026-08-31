import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatBotRecoverySetSuccess,
  isBotRecoverySetCommand,
} from "../src/admin/bot-recovery-set-service.js";

describe("bot recovery set command", () => {
  it("accepts only the exact legacy command", () => {
    assert.equal(isBotRecoverySetCommand("/봇살리기"), true);
    assert.equal(isBotRecoverySetCommand("/봇살리기 "), false);
    assert.equal(isBotRecoverySetCommand("/봇살리기 지금"), false);
    assert.equal(isBotRecoverySetCommand(undefined), false);
  });

  it("keeps the legacy success sentence", () => {
    assert.equal(
      formatBotRecoverySetSuccess("통합 운영자"),
      "통합 운영자님이 직전 데이터로 봇을 살립니다.",
    );
  });
});
