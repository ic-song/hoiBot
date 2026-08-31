import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTierRanking, formatTierRoster, isTierRosterReadCommand, parseTierRosterReadCommand, type TierRosterMember } from "./tier-roster-read-service.js";
import type { TierDefinition } from "./tier-authority-provider.js";

const definitions: TierDefinition[] = [
  { tierCode: "tier_0000000000000000", displayName: "새싹", tierOrder: 0, regularTicketThreshold: 0n, advancedTicketThreshold: 0n, rankEmoji: "🌱", petExperienceDelta: 0n },
  { tierCode: "tier_1111111111111111", displayName: "브론즈", tierOrder: 1, regularTicketThreshold: 1n, advancedTicketThreshold: 0n, rankEmoji: "🥉", petExperienceDelta: 50n }
];
const member = (playerId: bigint, name: string, regular: bigint, advanced: bigint, tierCode = definitions[0]!.tierCode): TierRosterMember =>
  ({ playerId, displayName: name, tierCode, rankEmoji: "🌱", regularTickets: regular, advancedTickets: advanced });

describe("tier roster read", () => {
  it("accepts only two exact commands", () => {
    assert.equal(parseTierRosterReadCommand("/티어확인"), "roster");
    assert.equal(parseTierRosterReadCommand("/티어순위"), "rank");
    assert.equal(isTierRosterReadCommand("/티어확인 안내"), false);
    assert.equal(isTierRosterReadCommand("/티어순위 1"), false);
  });

  it("renders authority buckets in reverse order and stable player order", () => {
    const text = formatTierRoster(definitions, [member(2n, "둘", 0n, 0n), member(1n, "하나", 0n, 0n), member(3n, "셋", 1n, 0n, definitions[1]!.tierCode)]);
    assert.match(text, /1\. 🥉브론즈: 셋[\s\S]*2\. 🌱새싹: 하나, 둘/);
  });

  it("scores advanced tickets as 300 and uses player identity for ties", () => {
    const rows = buildTierRanking([member(9n, "고급", 0n, 1n), member(3n, "동점먼저", 300n, 0n), member(7n, "낮음", 299n, 0n)]);
    assert.deepEqual(rows.map((row) => [row.playerId, row.points]), [[3n, 300n], [9n, 300n], [7n, 299n]]);
  });
});
