import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateGuildShopTax } from "../src/guild/guild-medal-auto-purchase-service.js";
import { formatInventoryCleanupReply, isInventoryCleanupCommand } from "../src/inventory/inventory-cleanup-orchestration-service.js";
import { isQuestRewardClaimCommand } from "../src/quest/quest-reward-claim-service.js";

describe("inventory cleanup orchestration v2.400 contract", () => {
  it("accepts only the exact cleanup and quest aliases", () => {
    for (const value of ["/정리", "ㅇㅇㅇ"]) assert.equal(isInventoryCleanupCommand(value), true);
    for (const value of ["/정리 1", "/ㅇㅇㅇ", " ㅇㅇㅇ"]) assert.equal(isInventoryCleanupCommand(value), false);
    for (const value of ["/퀘스트완료", "ㅎㅎㅎ", "/ㅇ", "/ㅇㅇㅇ"]) assert.equal(isQuestRewardClaimCommand(value), true);
    for (const value of ["/퀘스트완료 안내", "ㅇㅇㅇ"]) assert.equal(isQuestRewardClaimCommand(value), false);
  });
  it("rounds castle tax in the same positive integer direction as legacy", () => {
    assert.equal(calculateGuildShopTax(1_005n, 1_000), 101n);
    assert.equal(calculateGuildShopTax(1_000n, 0), 0n);
  });
  it("keeps the ordered one-card cleanup summary", () => {
    const text = formatInventoryCleanupReply({ displayName: "합성 회원", notice: "점검", open: { status: "opened", playerId: "1", data: "오픈", auditId: "1", pointDelta: "0", randomTrace: [], openedBoxes: [], deferredGuildItems: [] }, combine: { status: "nothing_to_combine", data: "조합 없음" }, sell: { status: "nothing_to_sell", data: "판매 없음" }, booster: null, medal: null, quest: null });
    assert.ok(text.indexOf("전체 오픈") < text.indexOf("전체 조합"));
    assert.ok(text.indexOf("전체 조합") < text.indexOf("전체 판매"));
    assert.match(text, /\(알림\) 점검/);
  });
});
