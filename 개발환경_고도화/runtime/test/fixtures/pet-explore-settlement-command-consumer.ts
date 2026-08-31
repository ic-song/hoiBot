import type { NormalizedIrisEvent } from "../../src/integration/iris-normalizer.js";
import type { PetExploreSettlementInput, PetExploreSettlementResult } from "../../src/pet/pet-explore-settlement-provider.js";

export function settlementCommandEvent(overrides: Partial<NormalizedIrisEvent> = {}): NormalizedIrisEvent {
  return {
    eventId: "lease2430-event-1", providerEventId: "lease2430-event-1", providerCode: "iris", eventKind: "message", direction: "incoming",
    channelId: "lease2430-room", userId: "lease2430-user", displayName: "호이 남", displayNameSource: "kakao_db", displayNameTrust: "trusted",
    message: "/펫탐험정산", eventCode: "message", eventCategory: "chat", monitoringGroup: "text", eventMetadata: {}, payloadHash: "a".repeat(64),
    ...overrides,
  };
}

export function settlementCommandInput(overrides: Partial<PetExploreSettlementInput> = {}): PetExploreSettlementInput {
  return {
    roundKey: "lease2430-round", expectedRoundVersion: "1", source: "manual", actorId: "1", idempotencyKey: "lease2430-event-1",
    policyHash: "b".repeat(64), reason: "Iris /펫탐험정산", destinationId: "lease2430-room", nextAutoReservations: [],
    plans: [{ participationId: "11", expectedVersion: "1", premiumActive: false, successThresholdBasisPoints: 10000, ticketPolicy: "none", ticketItemCode: null, fallbackDestinations: null, successRewards: [{ itemCode: "ITEM-PET-FOOD", quantity: "2" }], failureRewards: [{ itemCode: "ITEM-PET-FOOD", quantity: "2" }] }],
    ...overrides,
  };
}

export function settlementCommandResult(overrides: Partial<PetExploreSettlementResult> = {}): PetExploreSettlementResult {
  return {
    status: "settled", roundId: "7", roundKey: "lease2430-round", previousRoundVersion: "1", roundVersion: "2", participantCount: "1", successCount: "1", failureCount: "0", ineligibleCount: "0",
    participants: [{ participationId: "11", playerId: "21", requestedDestinationCode: "luck_mine", effectiveDestinationCode: "luck_mine", resultCode: "success", ticketItemCode: null, ticketConsumed: false, fallbackApplied: false, successThresholdBasisPoints: 10000, successRollBasisPoints: 1, previousVersion: "1", version: "2", rewards: [{ itemCode: "ITEM-PET-FOOD", quantity: "2" }] }],
    nextAutoResults: [], operationId: "31", auditId: "32", outboxId: "33", replayed: false,
    ...overrides,
  };
}

export const settlementCommandScenarios = ["normal", "auth-super-admin", "auth-open-chat-bot", "boundary", "concurrent-replay", "failure-conflict", "failure-premium-red", "restart-replay"] as const;
