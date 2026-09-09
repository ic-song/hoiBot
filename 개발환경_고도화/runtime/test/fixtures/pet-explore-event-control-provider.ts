import type { PetExploreEventControlInput } from "../../src/pet/pet-explore-event-control-provider.js";

export const petExploreEventControlFixture = {
  authoritativeState: "pet_explore_runtime_config",
  events: [
    {
      eventCode: "diamond_mine",
      runtimeFlag: "event_mine_active",
      participantDestination: "diamond_mine_event",
      legacyEnableCommand: "/펫탐험이벤트활성화",
      legacyDisableCommand: "/펫탐험이벤트비활성화",
    },
    {
      eventCode: "guild_raid",
      runtimeFlag: "guild_raid_active",
      participantDestination: "guild_raid_event",
      legacyEnableCommand: "/레이드이벤트활성화",
      legacyDisableCommand: "/레이드이벤트비활성화",
    },
  ] as const,
  relocationDestination: "regular_mine",
  canonicalBase: ["pet_explore_rounds", "pet_explore_participations"] as const,
  excludedResponsibilities: ["participation_reservation", "settlement", "reward", "rng"] as const,
  baseInput: {
    eventCode: "diamond_mine",
    active: false,
    expectedVersion: "7",
    idempotencyKey: "synthetic-pet-explore-event-control",
    operatorId: "984700001",
    reason: "합성 이벤트 종료 검증",
    sourceCode: "admin_api",
  } satisfies PetExploreEventControlInput,
} as const;
