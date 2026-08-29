import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSupportPremiumNoticeCommandCandidate, normalizeSupportPremiumNoticeDispatchMessage, parseSupportPremiumNoticeCommand } from "../src/support/support-premium-notice-command.js";
import { formatSupportPremiumNoticeBroadcast } from "../src/support/support-premium-notice-service.js";

describe("support premium notice send v2.400", () => {
  it("keeps the candidate boundary without accepting prefix collisions", () => {
    for (const value of ["/알림", "/알림 ", "/알림 안녕하세요"]) assert.equal(isSupportPremiumNoticeCommandCandidate(value), true);
    for (const value of [undefined, " /알림 안녕", "/알림설정", "/알림이야"]) assert.equal(isSupportPremiumNoticeCommandCandidate(value), false);
    assert.equal(normalizeSupportPremiumNoticeDispatchMessage("/알림 안녕하세요"), "/알림");
  });
  it("requires a message after whitespace and preserves the complete body", () => {
    assert.deepEqual(parseSupportPremiumNoticeCommand("/알림"), { message: null });
    assert.deepEqual(parseSupportPremiumNoticeCommand("/알림 "), { message: null });
    assert.deepEqual(parseSupportPremiumNoticeCommand("/알림  공백도 보존"), { message: "공백도 보존" });
    assert.equal(parseSupportPremiumNoticeCommand("/알림설정"), null);
  });
  it("preserves the premium broadcast body", () => {
    assert.equal(formatSupportPremiumNoticeBroadcast("👑검증자", "테스트입니다"), "[👑호이패스 프리미엄👑]\n[👑검증자]\n[확성기📢]: 테스트입니다");
  });
});
