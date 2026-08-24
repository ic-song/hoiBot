import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApplicationError } from "../src/shared/application-error.js";
import type { GuildTerritoryReadyEntry, GuildTerritoryReadModel } from "../src/guild/guild-territory-read-model-repository.js";
import { GuildTerritoryReadyStatusService, isGuildTerritoryReadyStatusCommand } from "../src/guild/guild-territory-ready-status-service.js";

// 합성 준비 entry를 완전한 provider projection으로 생성합니다.
function entry(ordinal: number, name: string): GuildTerritoryReadyEntry {
  return {
    ordinal,
    eligible: true,
    ready: true,
    guild: { guildId: String(ordinal), displayName: name, mark: `M${ordinal}` },
    storedGuildName: `저장-${name}`,
    preparedBy: { playerId: String(100 + ordinal), displayName: `준비자${ordinal}` },
    preparedAt: `2026-08-24 20:0${ordinal}:00`
  };
}

// ready registry만 포함한 최소 read-model fixture를 생성합니다.
function model(entries: GuildTerritoryReadyEntry[]): GuildTerritoryReadModel {
  return {
    season: { state: "active", season: { seasonId: "1", seasonKey: "fixture", snapshotVersion: 7n, startsAt: null, endsAt: null } },
    pin: { seasonId: "1", snapshotVersion: 7n },
    turnOrder: [],
    readyRegistry: { seasonId: "1", startSnapshotVersion: 3n, entries },
    rankingSnapshot: null,
    rewardGuide: null,
    rememberPreference: null
  };
}

// 고정 fixture를 반환하는 조회 service 대역을 생성합니다.
function service(value: GuildTerritoryReadModel) {
  return new GuildTerritoryReadyStatusService({
    read: async (request) => {
      assert.deepEqual(request, { territoryScope: "world-active" });
      return value;
    }
  });
}

describe("guild territory ready status command", () => {
  it("accepts only the exact legacy command", () => {
    assert.equal(isGuildTerritoryReadyStatusCommand("/길드영지준비확인"), true);
    for (const message of [" /길드영지준비확인", "/길드영지준비확인 ", "/길드영지준비확인 1", "/길드영지준비확인목록", undefined]) {
      assert.equal(isGuildTerritoryReadyStatusCommand(message), false);
    }
  });

  it("keeps stable ordinal, filters non-ready rows and uses stored guild fallback", async () => {
    const skipped = entry(2, "제외길드");
    skipped.ready = false;
    const fallback = entry(3, "이전길드");
    fallback.guild = null;
    fallback.storedGuildName = "보관길드";
    const result = await service(model([fallback, skipped, entry(1, "알파길드")])).execute();
    assert.match(result, /참여 준비 길드: 2개/);
    assert.match(result, /1\. \[알파길드\(M1\)\]/);
    assert.match(result, /2\. \[보관길드\]/);
    assert.equal(result.includes("제외길드"), false);
  });

  it("rejects incomplete or duplicate provider projections", async () => {
    const incomplete = entry(1, "누락길드");
    incomplete.preparedBy = null;
    await assert.rejects(service(model([incomplete])).execute(), (error: unknown) =>
      error instanceof ApplicationError && error.code === "TERRITORY_READY_STATUS_INVALID");
    await assert.rejects(service(model([entry(1, "알파"), entry(1, "베타")])).execute(), (error: unknown) =>
      error instanceof ApplicationError && error.code === "TERRITORY_READY_STATUS_INVALID");
  });
});
