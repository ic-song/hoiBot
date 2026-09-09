import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTierRecalculationPlan, isMemberTicketTierRecalculateCommand } from "./member-ticket-tier-recalculate-service.js";
import type { TierDefinition } from "./tier-authority-provider.js";

const definitions: TierDefinition[] = [
  { tierCode: "tier_0000000000000000", displayName: "새싹", tierOrder: 0, regularTicketThreshold: 0n, advancedTicketThreshold: 0n, rankEmoji: "🌱", petExperienceDelta: 0n },
  { tierCode: "tier_1111111111111111", displayName: "브론즈", tierOrder: 1, regularTicketThreshold: 1n, advancedTicketThreshold: 0n, rankEmoji: "🥉", petExperienceDelta: 50n },
  { tierCode: "tier_2222222222222222", displayName: "실버", tierOrder: 2, regularTicketThreshold: 10n, advancedTicketThreshold: 0n, rankEmoji: "🥈", petExperienceDelta: 100n }
];

describe("member ticket tier recalculate", () => {
  it("accepts only the exact command", () => {
    assert.equal(isMemberTicketTierRecalculateCommand("/티어적용"), true);
    assert.equal(isMemberTicketTierRecalculateCommand("/티어적용 1"), false);
    assert.equal(isMemberTicketTierRecalculateCommand("/티어적용 안내"), false);
  });

  it("plans upgrades, downgrades, unchanged members and clamps pet experience", () => {
    const changes = buildTierRecalculationPlan(definitions, [
      { playerId: 1n, displayName: "승급", currentTierCode: definitions[0]!.tierCode, petExperience: 5n, regularTickets: 10n, advancedTickets: 0n },
      { playerId: 2n, displayName: "강등", currentTierCode: definitions[2]!.tierCode, petExperience: 20n, regularTickets: 0n, advancedTickets: 0n },
      { playerId: 3n, displayName: "유지", currentTierCode: definitions[1]!.tierCode, petExperience: 9n, regularTickets: 1n, advancedTickets: 0n }
    ]);
    assert.equal(changes.length, 2);
    assert.deepEqual({ delta: changes[0]!.experienceDelta, next: changes[0]!.nextPetExperience }, { delta: 150n, next: 155n });
    assert.deepEqual({ delta: changes[1]!.experienceDelta, next: changes[1]!.nextPetExperience }, { delta: -150n, next: 0n });
  });

  it("fails closed when the current tier is outside the published catalog", () => {
    assert.throws(() => buildTierRecalculationPlan(definitions, [
      { playerId: 4n, displayName: "불일치", currentTierCode: "tier_missing", petExperience: 0n, regularTickets: 0n, advancedTickets: 0n }
    ]), /현재 티어가 카탈로그에 없습니다/);
  });
});
