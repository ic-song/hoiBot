import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculatePlayerOverallScore, formatPlayerOverallRanking, isPlayerOverallRankReadCommand, type PlayerOverallRankRow } from "../src/player/player-overall-rank-read-service.js";

const row = (playerId: string, displayName: string, totalCharm: string, sourceOrder: string | null = null, rankEmoji = ""): PlayerOverallRankRow => ({ playerId, displayName, totalCharm, sourceOrder, rankEmoji, castleCharm: "0", raidCharm: "0", effectiveEnhancement: "0" });

describe("player overall rank read", () => {
  it("accepts only exact legacy commands", () => {
    assert.equal(isPlayerOverallRankReadCommand("/종합순위"), true);
    assert.equal(isPlayerOverallRankReadCommand("ㅈㅈㅈ"), true);
    for (const value of [undefined, "/종합순위 ", "/종합순위 1", "종합순위", "ㅈㅈㅈ "]) assert.equal(isPlayerOverallRankReadCommand(value), false);
  });

  it("applies conditional skills, home boost, cube cap and rounded enhancement without Number loss", () => {
    const score = calculatePlayerOverallScore({
      petExperience: 1000n, petEnhancement: 101n, miniGrade: "엘리트", miniRaid: 200n, miniCastle: 300n,
      homeCharm: 1000n, arcanaCount: 5n, royalPlacedCount: 10n, intimacyCharm: 400n,
      elementalRaid: 50n, elementalCastle: 60n, pendantRaid: 70n, pendantCastle: 80n,
      cubeRaidPercent: "10.000", cubeCastlePercent: "20.000", cubePetUpgradePercent: "10.000",
      guildRaidUnits: 600n, guildCastleUnits: 500n,
      skills: [
        { displayName: "엘리트 박사", raidCharm: 1500n, castleCharm: 1500n, conditionCode: "ELITE_MINI_PET", conditionThreshold: 1n, homeCharmPercent: "0" },
        { displayName: "아르카나 하우스", raidCharm: 500n, castleCharm: 500n, conditionCode: "ARCANA_FURNITURE", conditionThreshold: 5n, homeCharmPercent: "0" },
        { displayName: "인테리어 장인", raidCharm: 0n, castleCharm: 0n, conditionCode: null, conditionThreshold: 0n, homeCharmPercent: "10.000" }
      ]
    });
    assert.equal(score.raid, 7072n);
    assert.equal(score.castle, 8398n);
    assert.equal(score.effectiveEnhancement, 111n);
    assert.equal(score.total, 126470n);
  });

  it("keeps requester gap, BIGINT formatting and the five-row allsee boundary", () => {
    const rows = Array.from({ length: 7 }, (_, index) => row(String(index + 1), `회원${index + 1}`, String(9007199254740993n - BigInt(index)), String(index + 1), index === 1 ? "⭐" : ""));
    const data = formatPlayerOverallRanking(rows, "2");
    assert.match(data, /⭐회원2님의 순위는 2등/);
    assert.match(data, /종합매력을 ☆ 2만 더 모으면/);
    assert.match(data, /🥇회원1 - 👑 9,007,199,254,740,993/);
    assert.equal((data.match(/\u200b/g) ?? []).length, 500);
    assert.ok(data.indexOf("회원5 -") < data.indexOf("\u200b"));
    assert.ok(data.indexOf("\u200b") < data.lastIndexOf("회원6 -"));
  });
});
