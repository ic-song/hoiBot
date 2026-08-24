import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GuildTerritoryReadModel, GuildTerritoryStatusProjection } from "../src/guild/guild-territory-read-model-repository.js";
import { GuildTerritoryStatusProjectionService, isGuildTerritoryStatusCommand } from "../src/guild/guild-territory-status-projection-service.js";

// 1~7번 영지 slot을 포함하는 완전한 합성 projection을 생성합니다.
function projection(): GuildTerritoryStatusProjection {
  return {
    territoryScope: "world-active",
    seasonId: "1",
    eventActive: true,
    seasonActive: true,
    dimensionGateEnabled: true,
    rememberMeEnabled: false,
    version: 4n,
    slots: Array.from({ length: 7 }, (_value, index) => ({
      slotNo: index + 1,
      ownerGuild: index === 1 ? null : { guildId: String(index + 1), displayName: `길드${index + 1}`, mark: `M${index + 1}` },
      storedOwnerGuildName: index === 1 ? "보관길드" : null
    }))
  };
}

// status projection만 포함한 최소 read-model fixture를 생성합니다.
function model(statusProjection: GuildTerritoryStatusProjection | null): GuildTerritoryReadModel {
  return {
    season: { state: "active", season: { seasonId: "1", seasonKey: "fixture", snapshotVersion: 7n, startsAt: null, endsAt: null } },
    pin: { seasonId: "1", snapshotVersion: 7n },
    turnOrder: [],
    readyRegistry: null,
    statusProjection,
    rankingSnapshot: null,
    rewardGuide: null,
    rememberPreference: null
  };
}

// 고정 fixture를 반환하며 repair API를 노출하지 않는 순수 조회 대역을 생성합니다.
function service(value: GuildTerritoryReadModel) {
  return new GuildTerritoryStatusProjectionService({
    read: async (request) => {
      assert.deepEqual(request, { territoryScope: "world-active" });
      return value;
    }
  });
}

describe("guild territory status projection command", () => {
  it("accepts only the two exact legacy commands", () => {
    assert.equal(isGuildTerritoryStatusCommand("/길드영지"), true);
    assert.equal(isGuildTerritoryStatusCommand("/길드영지확인"), true);
    for (const message of ["/길드영지 ", "/길드영지 1", "/길드영지확인 ", "/길드영지상태", undefined]) {
      assert.equal(isGuildTerritoryStatusCommand(message), false);
    }
  });

  it("formats seven slots, stored fallback and feature switches without repair", async () => {
    const result = await service(model(projection())).execute("/길드영지");
    assert.equal(result.status, "projected");
    if (result.status !== "projected") return;
    assert.match(result.data, /\[1\] 호월킹덤🏰: 길드1\(M1\)/);
    assert.match(result.data, /\[2\] 펫스킬 광산📙: 보관길드/);
    assert.match(result.data, /\[7\] 길드영지PT광산🪙: 길드7\(M7\)/);
    assert.match(result.data, /\[8\] 차원의 문 🌀: 환생 하고싶누\?/);
    assert.match(result.data, /\[9\] 날 기억해줘😭: 닫힘\(OFF\)/);
  });

  it("projects the active event confirmation independently from slot formatting", async () => {
    const value = projection();
    value.slots = [];
    const result = await service(model(value)).execute("/길드영지확인");
    assert.equal(result.status, "projected");
    if (result.status === "projected") assert.match(result.data, /현재 길드 영지전이 진행 중입니다/);
  });

  it("returns repair-required for missing or invalid projections without mutating", async () => {
    assert.deepEqual(await service(model(null)).execute("/길드영지"), {
      status: "repair_required", reason: "status_projection_missing", territoryScope: "world-active", version: null
    });
    const invalid = projection();
    invalid.slots.pop();
    assert.deepEqual(await service(model(invalid)).execute("/길드영지"), {
      status: "repair_required", reason: "status_projection_invalid", territoryScope: "world-active", version: 4n
    });
  });
});
