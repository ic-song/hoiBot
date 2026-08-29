import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatGuildContributionCountResetReply,
  isGuildContributionCountResetCommand,
  parseGuildContributionCountResetCommand
} from "../src/guild/guild-contribution-count-reset-service.js";

describe("guild contribution purchase count reset command boundary", () => {
  it("preserves a spaced display name after the command token", () => {
    assert.deepEqual(parseGuildContributionCountResetCommand("/공헌구매초기화 합성 길드 회원"), { targetDisplayName: "합성 길드 회원" });
  });

  it("accepts only the bare guide or a single-line argument form", () => {
    assert.equal(isGuildContributionCountResetCommand("/공헌구매초기화"), true);
    assert.equal(isGuildContributionCountResetCommand("/공헌구매초기화 회원"), true);
    assert.equal(isGuildContributionCountResetCommand("/공헌구매초기화2 회원"), false);
    assert.equal(isGuildContributionCountResetCommand("/공헌구매초기화 회원\n추가"), false);
    assert.throws(() => parseGuildContributionCountResetCommand("/공헌구매초기화"), /사용법/);
  });

  it("projects the target and previous count in the completion reply", () => {
    assert.equal(formatGuildContributionCountResetReply("합성 길드 회원", 7n), "✅ [합성 길드 회원]님의 공헌훈장 구매횟수를 초기화했습니다.\n이전 구매횟수: 7회");
  });
});
