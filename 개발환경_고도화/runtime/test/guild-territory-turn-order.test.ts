import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GuildTerritoryTurnOrderCommand,
  formatGuildTerritoryTurnOrder,
  isGuildTerritoryTurnOrderCommand
} from "../src/guild/guild-territory-turn-order-command.js";
import type {
  GuildTerritoryReadModel,
  GuildTerritoryReadRequest,
  GuildTerritoryTurnOrderEntry
} from "../src/guild/guild-territory-read-model-repository.js";

// Focused command fixtures keep formatter checks independent from MariaDB state.
function createModel(turnOrder: GuildTerritoryTurnOrderEntry[]): GuildTerritoryReadModel {
  return {
    season: { state: "active", season: { seasonId: "77", seasonKey: "s1", snapshotVersion: 4n, startsAt: null, endsAt: null } },
    pin: { seasonId: "77", snapshotVersion: 4n },
    turnOrder,
    rankingSnapshot: null,
    rewardGuide: null,
    rememberPreference: null
  };
}

// Turn-order entries expose visibility and projection gaps without mutating provider data.
function createEntry(overrides: Partial<GuildTerritoryTurnOrderEntry> = {}): GuildTerritoryTurnOrderEntry {
  return {
    ordinal: 1,
    guild: { guildId: "10", displayName: "알파", mark: "A" },
    player: {
      playerId: "20",
      displayName: "공격자",
      rankProjection: { label: "대장", sourceCode: "fixture", version: 1n }
    },
    visibility: {
      visible: true,
      userEliminated: false,
      guildEliminated: false,
      exclusionReasonCode: null,
      projectionIssue: null
    },
    turnState: "active",
    scheduledAt: null,
    ...overrides
  };
}

describe("guild territory turn-order command", () => {
  it("accepts only the exact slash command", () => {
    assert.equal(isGuildTerritoryTurnOrderCommand("/길드영지순서"), true);
    assert.equal(isGuildTerritoryTurnOrderCommand("/길드영지순서 설명"), false);
    assert.equal(isGuildTerritoryTurnOrderCommand("/길드영지순서2"), false);
    assert.equal(isGuildTerritoryTurnOrderCommand(null), false);
  });

  it("preserves the legacy empty-order message", () => {
    const output = formatGuildTerritoryTurnOrder(createModel([]));
    assert.match(output, /^📜 길드 영지전 공격 순서표 📜\n/);
    assert.match(output, /참여 공격자가 없습니다\.$/);
  });

  it("reports when every provider projection is hidden", () => {
    const hidden = createEntry({
      visibility: {
        visible: false,
        userEliminated: true,
        guildEliminated: false,
        exclusionReasonCode: "TURN_MISMATCH",
        projectionIssue: null
      }
    });
    assert.match(formatGuildTerritoryTurnOrder(createModel([hidden])), /남은 공격 대상이 없습니다\.$/);
  });

  it("sorts visible projections and compacts numbering after exclusions", () => {
    const second = createEntry({ ordinal: 8, guild: { guildId: "11", displayName: "베타", mark: null } });
    const first = createEntry({ ordinal: 3 });
    const missingRank = createEntry({
      ordinal: 1,
      player: { playerId: "21", displayName: "누락", rankProjection: null },
      visibility: { visible: true, userEliminated: false, guildEliminated: false, exclusionReasonCode: null, projectionIssue: null }
    });
    const output = formatGuildTerritoryTurnOrder(createModel([second, missingRank, first]));
    assert.match(output, /1\. \[대장\] \[알파\(A\)\]\n2\. \[대장\] \[베타\]\n$/);
    assert.doesNotMatch(output, /누락|3\./);
  });

  it("reads the world projection once without exposing mutation", async () => {
    const reads: GuildTerritoryReadRequest[] = [];
    const service = {
      read: async (request: GuildTerritoryReadRequest) => {
        reads.push(request);
        return createModel([]);
      }
    };
    const command = new GuildTerritoryTurnOrderCommand(service);
    assert.match(await command.execute(), /참여 공격자가 없습니다\.$/);
    assert.deepEqual(reads, [{ territoryScope: "world" }]);
    assert.equal("setRememberPreference" in service, false);
  });
});
