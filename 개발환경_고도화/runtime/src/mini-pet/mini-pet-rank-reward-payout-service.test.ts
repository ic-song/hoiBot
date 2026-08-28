import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMiniPetRankRows,
  formatMiniPetRankRewardReply,
  isMiniPetRankRewardPayoutCommand,
  miniPetRankRewardQuantity,
  normalizeMiniPetRankRewardPayoutDispatchMessage,
  type MiniPetRankSourceRow
} from "./mini-pet-rank-reward-payout-service.js";

describe("mini pet rank reward payout", () => {
  it("accepts only the exact no-argument command", () => {
    assert.equal(isMiniPetRankRewardPayoutCommand("/연금지급"), true);
    for (const value of [undefined, "연금지급", "/연금지급 ", "/연금지급 1", "/연금지급 해봐"]) assert.equal(isMiniPetRankRewardPayoutCommand(value), false);
    assert.equal(normalizeMiniPetRankRewardPayoutDispatchMessage("/연금지급"), "/연금지급");
  });

  it("preserves every legacy reward boundary and total", () => {
    assert.deepEqual(
      [1, 2, 3, 4, 10, 11, 20, 21, 30, 161, 170, 171, 200, 201].map(miniPetRankRewardQuantity),
      [40n, 30n, 25n, 24n, 18n, 17n, 17n, 16n, 16n, 2n, 2n, 1n, 1n, 0n]
    );
    assert.equal(Array.from({ length: 200 }, (_, index) => miniPetRankRewardQuantity(index + 1)).reduce((sum, value) => sum + value, 0n), 1792n);
  });

  it("adds one stable equipped pet and only the top ten bag values before Korean-name ties", () => {
    const source: MiniPetRankSourceRow[] = [{ ownedId: 1n, playerId: 1n, displayName: "나", equipped: true, battleExperience: 5n }];
    for (let value = 1; value <= 12; value += 1) source.push({ ownedId: BigInt(value + 1), playerId: 1n, displayName: "나", equipped: false, battleExperience: BigInt(value) });
    source.push({ ownedId: 100n, playerId: 2n, displayName: "가", equipped: true, battleExperience: 80n });
    const ranked = buildMiniPetRankRows(source);
    assert.deepEqual(ranked.map((row) => [row.playerId, row.equippedCharm, row.bagCharm, row.bagPetCount, row.totalCharm]), [[2n, 80n, 0n, 0, 80n], [1n, 5n, 75n, 12, 80n]]);
  });

  it("keeps the top-ten fold and explicit empty payout", () => {
    const rows = Array.from({ length: 11 }, (_, index) => ({ playerId: BigInt(index + 1), displayName: `회원${index + 1}`, equippedCharm: 1n, bagCharm: 0n, bagPetCount: 0, totalCharm: 1n }));
    const message = formatMiniPetRankRewardReply("2026-08-29", rows, rows.map((_, index) => miniPetRankRewardQuantity(index + 1)));
    assert.equal(message.includes("\u200b".repeat(500)), true);
    assert.equal(formatMiniPetRankRewardReply("2026-08-29", [], []).includes("지급 대상자가 없습니다."), true);
  });
});
