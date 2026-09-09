import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GuildMemberCharmInput } from "../src/guild/guild-rank-charm-input-provider.js";
import { formatGuildRankSnapshot, isGuildRankSnapshotRefreshCommand, rankGuildCharmInputs } from "../src/guild/guild-rank-snapshot-refresh-service.js";

const input = (guildId: string, guildName: string, guildLevel: bigint, playerId: string, totalCharm: bigint): GuildMemberCharmInput => ({
  guildId, guildVersion: "1", guildName, guildLevel, playerId, playerName: `회원${playerId}`, playerLevel: 1n, totalCharm, sourceHash: playerId.padStart(64, "0"),
  components: { petExperience: 0n, petEnhancement: 0n, miniGrade: null, miniRaid: 0n, miniCastle: 0n, homeCharm: 0n, arcanaCount: 0n, royalPlacedCount: 0n, intimacyCharm: 0n, elementalRaid: 0n, elementalCastle: 0n, pendantRaid: 0n, pendantCastle: 0n, cubeRaidPercent: "0", cubeCastlePercent: "0", cubePetUpgradePercent: "0", guildRaidUnits: 0n, guildCastleUnits: 0n, skills: [] },
});
const titles = [{ titleCode: "top", displayName: "최상위", minimumRank: 1, maximumRank: 1 }, { titleCode: "rest", displayName: "일반", minimumRank: 2, maximumRank: null }];

describe("guild rank snapshot refresh", () => {
  it("accepts only the exact command", () => {
    assert.equal(isGuildRankSnapshotRefreshCommand("/길드순위"), true);
    for (const value of [" /길드순위", "/길드순위 ", "/길드순위 1", "/길드순위안내", undefined]) assert.equal(isGuildRankSnapshotRefreshCommand(value), false);
  });
  it("aggregates members and uses charm, level, Korean name, stable ID order", () => {
    const rows = rankGuildCharmInputs([input("3", "나길드", 9n, "31", 100n), input("1", "가길드", 9n, "11", 50n), input("1", "가길드", 9n, "12", 50n), input("2", "다길드", 8n, "21", 100n)], titles);
    assert.deepEqual(rows.map((row) => [row.guildId, row.ordinal, row.totalCharm, row.memberCount, row.titleCode]), [["1", 1, 100n, 2, "top"], ["3", 2, 100n, 1, "rest"], ["2", 3, 100n, 1, "rest"]]);
  });
  it("fails closed when a rank has no single title definition", () => {
    assert.throws(() => rankGuildCharmInputs([input("1", "가", 1n, "1", 1n)], []), /incomplete/);
    assert.throws(() => rankGuildCharmInputs([input("1", "가", 1n, "1", 1n)], [{ titleCode: "a", displayName: "A", minimumRank: 1, maximumRank: null }, { titleCode: "b", displayName: "B", minimumRank: 1, maximumRank: 1 }]), /incomplete/);
  });
  it("folds only after the top three rows", () => {
    const rows = rankGuildCharmInputs([input("1", "가", 1n, "1", 4n), input("2", "나", 1n, "2", 3n), input("3", "다", 1n, "3", 2n), input("4", "라", 1n, "4", 1n)], titles);
    const data = formatGuildRankSnapshot(rows);
    assert.ok(data.includes("3위 일반 다")); assert.ok(data.indexOf("\u200b") > data.indexOf("3위 일반 다")); assert.ok(data.indexOf("\u200b") < data.indexOf("4위 일반 라"));
  });
});
