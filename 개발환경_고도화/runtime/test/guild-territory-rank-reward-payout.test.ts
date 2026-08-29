import assert from "node:assert/strict";
import test from "node:test";
import { formatGuildTerritoryRankRewardPayout, isGuildTerritoryRankRewardPayoutCommand } from "../src/guild/guild-territory-rank-reward-payout-service.js";

test("길드 영지 순위보상 지급은 두 exact 별칭만 허용한다", () => {
  assert.equal(isGuildTerritoryRankRewardPayoutCommand("/길드영지보상지급"), true);
  assert.equal(isGuildTerritoryRankRewardPayoutCommand("/영지순위보상지급"), true);
  assert.equal(isGuildTerritoryRankRewardPayoutCommand("/길드영지보상지급 1"), false);
  assert.equal(isGuildTerritoryRankRewardPayoutCommand("/영지순위보상지급 안내"), false);
  assert.equal(isGuildTerritoryRankRewardPayoutCommand("/길드영지보상"), false);
});

test("순위보상 응답은 snapshot 순서와 decimal 합계를 보존한다", () => {
  const data = formatGuildTerritoryRankRewardPayout("2026-08-29", "GUILD_FUND", [
    { ordinal_value: 1, guild_id: 1n, guild_name_snapshot: "가 길드", total_charm: 300n },
    { ordinal_value: 2, guild_id: 2n, guild_name_snapshot: "나 길드", total_charm: 200n }
  ], ["100.000", "50.500"]);
  assert.match(data, /1위 가 길드 - GUILD_FUND 100/);
  assert.match(data, /2위 나 길드 - GUILD_FUND 50.5/);
  assert.match(data, /총 지급: GUILD_FUND 150.5/);
});
