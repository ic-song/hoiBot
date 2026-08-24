import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GuildTerritoryRankingEntry, GuildTerritoryReadModel } from "../src/guild/guild-territory-read-model-repository.js";
import { GuildTerritoryRankingCommandService, isGuildTerritoryRankingCommand } from "../src/guild/guild-territory-ranking-command-service.js";

// 합성 순위 entry를 완전한 provider projection으로 생성합니다.
function entry(ordinal: number, name: string, score: bigint): GuildTerritoryRankingEntry {
  return {
    ordinal,
    guild: {
      guildId: String(ordinal), displayName: name, mark: `M${ordinal}`, serverCode: `S${ordinal}`, level: 10 + ordinal,
      master: { playerId: String(100 + ordinal), displayName: `길마${ordinal}`, rankProjection: { label: "🧪", sourceCode: "fixture", version: 1n } },
    },
    score,
    lastScoredAt: "2026-08-24T00:00:00.000Z",
  };
}

// ranking snapshot만 포함한 최소 read-model fixture를 생성합니다.
function model(entries: GuildTerritoryRankingEntry[]): GuildTerritoryReadModel {
  return {
    season: { state: "active", season: { seasonId: "1", seasonKey: "fixture", snapshotVersion: 7n, startsAt: null, endsAt: null } },
    pin: { seasonId: "1", snapshotVersion: 7n }, turnOrder: [], rewardGuide: null, rememberPreference: null,
    rankingSnapshot: { pin: { seasonId: "1", snapshotVersion: 7n }, rulePin: { territoryScope: "world", ruleVersion: 2n }, capturedAt: "2026-08-24T00:00:00.000Z", entries },
  };
}

// 고정 fixture를 반환하는 조회 service 대역을 생성합니다.
function service(value: GuildTerritoryReadModel) {
  return new GuildTerritoryRankingCommandService({ read: async (request) => { assert.deepEqual(request, { territoryScope: "world-active" }); return value; } });
}

describe("guild territory ranking command", () => {
  it("accepts only the exact legacy command", () => {
    assert.equal(isGuildTerritoryRankingCommand("/길드영지순위"), true);
    for (const message of [" /길드영지순위", "/길드영지순위 ", "/길드영지순위 1", "/길드영지순위보기", undefined]) assert.equal(isGuildTerritoryRankingCommand(message), false);
  });

  it("keeps provider order, filters incomplete rows and compacts displayed ranks", async () => {
    const incomplete = entry(2, "누락길드", 9_000n);
    incomplete.guild!.master = null;
    const result = await service(model([entry(1, "알파길드", 5_000n), incomplete, entry(3, "베타길드", 4_000n)])).execute();
    assert.match(result, /1\. 알파길드\(M1\)/);
    assert.match(result, /2\. 베타길드\(M3\)/);
    assert.equal(result.includes("누락길드"), false);
    assert.match(result, /누적 영지점수: 5,000pt/);
  });

  it("shows the legacy empty message when no complete positive row exists", async () => {
    const zero = entry(1, "제로길드", 0n);
    const result = await service(model([zero])).execute();
    assert.match(result, /아직 누적 영지점수가 없습니다\.$/);
  });
});
