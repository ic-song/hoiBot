import assert from "node:assert/strict";
import test from "node:test";
import { formatGuildRankRewardPayout, isGuildRankRewardPayoutCommand } from "../src/guild/guild-rank-reward-payout-service.js";

test("길드보상지급은 exact 명령만 허용한다", () => {
  assert.equal(isGuildRankRewardPayoutCommand("/길드보상지급"), true);
  assert.equal(isGuildRankRewardPayoutCommand("/길드보상지급 1"), false);
  assert.equal(isGuildRankRewardPayoutCommand("/길드보상지급 안내"), false);
  assert.equal(isGuildRankRewardPayoutCommand("/길드보상"), false);
});

test("길드보상 응답은 길드별 회원 수와 총 지급량을 계산한다", () => {
  const data = formatGuildRankRewardPayout("2026-08-29", "합성 길드보상", [
    { ordinalValue: 1, guildName: "가 길드", memberCount: 2, rewardQuantity: 100n },
    { ordinalValue: 2, guildName: "나 길드", memberCount: 1, rewardQuantity: 50n }
  ]);
  assert.match(data, /1위 가 길드 - 2명 · 1인당 합성 길드보상 100개/);
  assert.match(data, /2위 나 길드 - 1명 · 1인당 합성 길드보상 50개/);
  assert.match(data, /총 지급: 합성 길드보상 250개/);
});

test("회원이 없는 snapshot 응답은 빈 지급 상태를 명시한다", () => {
  const data = formatGuildRankRewardPayout("2026-08-29", "합성 길드보상", []);
  assert.match(data, /지급 대상 길드원이 없습니다/);
  assert.match(data, /총 지급: 합성 길드보상 0개/);
});
