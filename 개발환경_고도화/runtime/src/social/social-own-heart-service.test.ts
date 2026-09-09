import assert from "node:assert/strict";
import test from "node:test";
import { formatSocialOwnHeartReply, isSocialOwnHeartCandidate, normalizeSocialOwnHeartDispatchMessage } from "./social-own-heart-service.js";

test("social own heart", async (t) => {
  await t.test("accepts only the exact legacy command", () => {
    assert.equal(isSocialOwnHeartCandidate("/내마음"), true);
    for (const value of ["/내마음 ", " /내마음", "/내마음 1", "/내마음확인", undefined]) assert.equal(isSocialOwnHeartCandidate(value), false);
  });
  await t.test("normalizes only the executable form", () => {
    assert.equal(normalizeSocialOwnHeartDispatchMessage("/내마음"), "/내마음");
    assert.equal(normalizeSocialOwnHeartDispatchMessage("/내마음 1"), "/내마음 1");
  });
  await t.test("preserves premium, mutual and skill projection order", () => {
    assert.equal(formatSocialOwnHeartReply({
      displayName: "마음 사용자", rankEmoji: "🌱", premium: true, base: 1n, mutualBonus: 2n,
      premiumBonus: 15n, skillBonus: 5n, used: 3n, remaining: 20n, limit: 23n,
    }), "[👑호이패스 프리미엄👑]\n[🌱마음 사용자] 님\n💞 맞팔 마음표현 혜택\n━━━━━━━━━━━━\n기본 사용 가능 횟수: 1회\n맞팔 보너스: +2회\n호이패스 프리미엄: +15회\n망므📙: +5회\n오늘 사용: 3회\n남은 마음: 20회\n최종 사용 가능 횟수: 23회");
  });
  await t.test("omits inactive bonuses and keeps zero remaining", () => {
    const reply = formatSocialOwnHeartReply({ displayName: "기본 사용자", premium: false, base: 1n, mutualBonus: 0n, premiumBonus: 0n, skillBonus: 0n, used: 4n, remaining: 0n, limit: 1n });
    assert.doesNotMatch(reply, /프리미엄:/);
    assert.doesNotMatch(reply, /망므📙:/);
    assert.match(reply, /남은 마음: 0회/);
  });
});
