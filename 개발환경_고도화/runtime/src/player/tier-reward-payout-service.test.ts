import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTierRewardRanking, formatTierRewardPayoutMessages, isTierRewardPayoutCommand, normalizeTierRewardPayoutDispatchMessage, tierRewardPolicy, type TierRewardSourceRow } from "./tier-reward-payout-service.js";

describe("tier reward payout", () => {
  it("accepts only the exact no-argument command", () => {
    assert.equal(isTierRewardPayoutCommand("/티어보상지급"), true);
    for (const value of [undefined, "티어보상지급", "/티어보상지급 ", "/티어보상지급 1", "/티어보상지급 해봐"]) assert.equal(isTierRewardPayoutCommand(value), false);
    assert.equal(normalizeTierRewardPayoutDispatchMessage("/티어보상지급"), "/티어보상지급");
  });
  it("uses advanced tickets as 300 regular tickets and fixes Korean-name ties", () => {
    const source: TierRewardSourceRow[] = [
      { playerId: 1n, displayName: "다", itemCode: "tier_advanced_ticket", quantity: 1n },
      { playerId: 2n, displayName: "라", itemCode: "ITEM-RWD-022", quantity: 299n },
      { playerId: 3n, displayName: "나", itemCode: "ITEM-RWD-022", quantity: 250n },
      { playerId: 4n, displayName: "가", itemCode: "ITEM-RWD-022", quantity: 250n }
    ];
    const ranked = buildTierRewardRanking(source, new Map([["ITEM-RWD-022", 1n], ["tier_advanced_ticket", 300n]]));
    assert.deepEqual(ranked.map((row) => [row.playerId, row.regularQuantity, row.advancedQuantity, row.score]), [[1n, 0n, 1n, 300n], [2n, 299n, 0n, 299n], [4n, 250n, 0n, 250n], [3n, 250n, 0n, 250n]]);
  });
  it("preserves all fourteen top-ten reward rows and totals", () => {
    const rows = Array.from({ length: 10 }, (_, index) => tierRewardPolicy(index + 1));
    assert.deepEqual(rows[0], [{ itemCode: "pet_skill_book_fragment", quantity: 5n }, { itemCode: "ITEM-RWD-053", quantity: 3n }]);
    assert.deepEqual(rows[9], [{ itemCode: "ITEM-RWD-053", quantity: 1n }]);
    assert.equal(rows.flat().length, 14);
    assert.equal(rows.flat().filter((row) => row.itemCode === "pet_skill_book_fragment").reduce((sum, row) => sum + row.quantity, 0n), 11n);
    assert.equal(rows.flat().filter((row) => row.itemCode === "ITEM-RWD-053").reduce((sum, row) => sum + row.quantity, 0n), 13n);
    assert.deepEqual(tierRewardPolicy(11), []);
  });
  it("keeps the explicit empty message and planned notice headings", () => {
    const empty = formatTierRewardPayoutMessages("2026-08-29", [], new Map());
    assert.equal(empty.data, "현재 티어순위 데이터가 없어 보상을 지급할 수 없습니다.");
    const row = [{ playerId: 1n, displayName: "회원", regularQuantity: 1n, advancedQuantity: 0n, score: 1n }];
    const messages = formatTierRewardPayoutMessages("2026-08-29", row, new Map([[1, [{ displayName: "다이아상자💎", quantity: 3n }]]]));
    assert.equal(messages.notice.startsWith("[보상알림]\n🎟티어 보상 지급이 완료되었습니다.🎫\n(/티어순위) 를 기준으로 1등-10등 보상됩니다."), true);
  });
});
