import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatGuildTerritoryBoosterContribution, normalizeGuildTerritoryBoosterContributeDispatchMessage, parseGuildTerritoryBoosterContributeCommand } from "../src/guild/guild-territory-booster-contribute-service.js";

describe("guild territory booster contribution", () => {
  it("accepts only exact bare or one unsigned integer argument", () => {
    assert.deepEqual(parseGuildTerritoryBoosterContributeCommand("/길드부스터공헌"), { requestedCount: null });
    assert.deepEqual(parseGuildTerritoryBoosterContributeCommand("/길드부스터공헌 12"), { requestedCount: 12n });
    assert.deepEqual(parseGuildTerritoryBoosterContributeCommand("/길드부스터공헌 0"), { requestedCount: 0n });
    for (const value of ["/길드부스터공헌 ", "/길드부스터공헌 -1", "/길드부스터공헌 1 추가", "/길드부스터공헌 1.5", " /길드부스터공헌 1", "/길드부스터공헌 18446744073709551616"]) assert.equal(parseGuildTerritoryBoosterContributeCommand(value), null);
  });

  it("normalizes only executable parameterized commands", () => {
    assert.equal(normalizeGuildTerritoryBoosterContributeDispatchMessage("/길드부스터공헌 3"), "/길드부스터공헌");
    assert.equal(normalizeGuildTerritoryBoosterContributeDispatchMessage("/길드부스터공헌 -1"), "/길드부스터공헌 -1");
  });

  it("formats stable contribution totals", () => {
    assert.equal(formatGuildTerritoryBoosterContribution({ displayName: "회원", guildName: "호이길드", requestedCount: 3n, guildBoosterAfter: 8n, memberContributionAfter: 13n }), "✅ [회원] 님이 [호이길드] 길드에 길드영지 부스터🔮 3개를 공헌했습니다.\n🏰 길드 보유 부스터: 8개\n🌟 누적 부스터 공헌: 13개");
  });
});
