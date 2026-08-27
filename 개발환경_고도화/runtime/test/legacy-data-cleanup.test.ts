import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isLegacyDataCleanupCommand, normalizeLegacyDataCleanupDispatchMessage } from "../src/admin/legacy-data-cleanup-command.js";
import { buildLegacyDataCleanupMessage, formatMilli, parseDecimalToMilli, type LegacyDataCleanupSummary } from "../src/admin/legacy-data-cleanup-service.js";

const emptySummary = (): LegacyDataCleanupSummary => ({
  furnitureDisplayRemoved: "0", furnitureNullRemoved: "0", itemQuantityMoved: "0", itemLogs: [],
  petSkillMoved: "0", petCharRemoved: "0", petSkillContainersRemoved: "0",
  pointUserCount: "0", pointRemovedMilli: "0", pointLogs: [], legacyPassListsRemoved: "0",
  userRingRemoved: "0", ringRewardFlagsRemoved: "0", ringLogs: [],
  guildRingGuildCount: "0", guildRingQuantity: "0", guildRingLogs: [],
});

describe("legacy data cleanup", () => {
  it("accepts only the exact legacy command", () => {
    assert.equal(isLegacyDataCleanupCommand("/데이터정리"), true);
    for (const value of [undefined, "데이터정리", "/데이터정리 ", "/데이터정리 1", "/데이터정리해줘"]) {
      assert.equal(isLegacyDataCleanupCommand(value), false, String(value));
    }
  });

  it("normalizes only the exact dispatch alias", () => {
    assert.equal(normalizeLegacyDataCleanupDispatchMessage("/데이터정리"), "/데이터정리");
    assert.equal(normalizeLegacyDataCleanupDispatchMessage("/데이터정리 1"), "/데이터정리 1");
  });

  it("renders all seven legacy cleanup sections for a no-op normalized database", () => {
    const message = buildLegacyDataCleanupMessage(emptySummary());
    for (let section = 1; section <= 7; section += 1) assert.match(message, new RegExp(`\\[${section}\\]`));
    assert.match(message, /정규화된 펫·펫스킬 테이블로 이미 분리됨/);
    assert.match(message, /펜던트 강화석📿 수량으로 이전하지 않습니다/);
  });

  it("renders item, point, player-ring and guild-ring evidence logs", () => {
    const message = buildLegacyDataCleanupMessage({ ...emptySummary(), itemQuantityMoved: "6",
      itemLogs: ["사용자 : 캐슬공격권⚔ → 영지공격권⚔ x6"], pointUserCount: "1", pointRemovedMilli: "875",
      pointLogs: ["사용자 : 10.875 → 10"], userRingRemoved: "1", ringLogs: ["사용자 : 반지 삭제"],
      guildRingGuildCount: "1", guildRingQuantity: "7", guildRingLogs: ["합성길드(TEST) : 💍x7 삭제"] });
    assert.match(message, /변경된 아이템 수량 : 6개/);
    assert.match(message, /제거된 소수점 포인트 총합 : 🅟0.875/);
    assert.match(message, /반지 삭제 유저 : 1명/);
    assert.match(message, /삭제 수량 : 💍x7/);
  });

  it("converts DECIMAL values without floating-point loss", () => {
    assert.equal(parseDecimalToMilli("999999999999999999999999999.875"), 999999999999999999999999999875n);
    assert.equal(formatMilli(999999999999999999999999999875n), "999999999999999999999999999.875");
    assert.equal(formatMilli("1000"), "1");
  });
});
