import type { PetExploreSettlementInput, PetExploreSettlementPlan } from "../../src/pet/pet-explore-settlement-provider.js";

const rewards = [{ itemCode: "ITEM-PET-FOOD", quantity: "2" }] as const;
export const petExploreSettlementBranches = [
  { destinationCode: "pet_enhancement_mine", ticketPolicy: "none", branch: "regular-mine" },
  { destinationCode: "jeondor_dungeon", ticketPolicy: "consume_or_regular_fallback", branch: "dungeon-ticket-or-fallback" },
  { destinationCode: "belcar_maze", ticketPolicy: "consume_or_fail", branch: "maze-ticket-or-ineligible" },
  { destinationCode: "archmage_ruins", ticketPolicy: "consume_or_fail", branch: "rank-prevalidated-maze" },
  { destinationCode: "guild_raid_event", ticketPolicy: "consume_or_fail", branch: "guild-prevalidated-ticket" },
  { destinationCode: "diamond_mine_event", ticketPolicy: "none", branch: "event-mine" },
] as const;

export const premiumConflictFixture = {
  gapCode: "premium_explore_bonus",
  status: "RED",
  legacySourceValue: "7_percent",
  canonicalPolicyVersion: null,
} as const;

export function settlementPlan(participationId: string, overrides: Partial<PetExploreSettlementPlan> = {}): PetExploreSettlementPlan {
  return {
    participationId,
    expectedVersion: "1",
    premiumActive: false,
    successThresholdBasisPoints: 10000,
    ticketPolicy: "none",
    ticketItemCode: null,
    fallbackDestinations: null,
    successRewards: rewards,
    failureRewards: rewards,
    ...overrides,
  };
}

export function settlementInput(plans: readonly PetExploreSettlementPlan[]): PetExploreSettlementInput {
  return {
    roundKey: "pet-explore-settlement-round-1",
    expectedRoundVersion: "3",
    source: "manual",
    actorId: "984730001",
    idempotencyKey: "lease2429-settlement",
    policyHash: "a".repeat(64),
    reason: "펫 탐험 round 정산 검증",
    destinationId: "pet-explore-internal",
    plans,
    nextAutoReservations: [],
  };
}
