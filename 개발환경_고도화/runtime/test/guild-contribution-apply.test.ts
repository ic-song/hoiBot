import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isGuildContributionApplyCandidate, normalizeGuildContributionApplyDispatchMessage, parseGuildContributionCount, rollGuildHeartBonus } from "../src/guild/guild-contribution-apply-service.js";

describe("guild contribution apply", () => {
  it("accepts only one positive integer and rejects the admin prefix collision", () => {
    assert.equal(parseGuildContributionCount("/길드공헌 1"), 1n);
    assert.equal(parseGuildContributionCount("/길드공헌 9007199254740993"), 9007199254740993n);
    for (const value of ["/길드공헌", "/길드공헌 0", "/길드공헌 -1", "/길드공헌 1 안내", "/길드공헌추가 회원 1"]) assert.equal(parseGuildContributionCount(value), null);
    assert.equal(isGuildContributionApplyCandidate("/길드공헌추가 회원 1"), false);
  });
  it("normalizes a valid numeric command to one stable DB alias", () => {
    assert.equal(normalizeGuildContributionApplyDispatchMessage("/길드공헌 3"), "/길드공헌 [숫자]");
    assert.equal(normalizeGuildContributionApplyDispatchMessage("/길드공헌추가 회원 3"), "/길드공헌추가 회원 3");
  });
  it("draws exactly below one percent only when the skill is equipped", () => {
    assert.equal(rollGuildHeartBonus(true, 0), true);
    assert.equal(rollGuildHeartBonus(true, 0.0099999999), true);
    assert.equal(rollGuildHeartBonus(true, 0.01), false);
    assert.equal(rollGuildHeartBonus(false, 0), false);
  });
});
