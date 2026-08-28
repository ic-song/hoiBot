import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sortJoinableGuilds } from "../src/guild/guild-join-policy.js";
import { formatGuildJoinableList, isGuildJoinableListReadCommand, type GuildJoinableListRow } from "../src/guild/guild-joinable-list-read-service.js";

function row(id: string, name: string, level: number, condition: bigint): GuildJoinableListRow {
  return { guildId: id, displayName: name, mark: "⭐", serverCode: "호1", level, joinRequirementExperience: condition,
    memberCount: 1, maxMembers: 5, recruitmentBonus: 0, memberJoinClosed: false, guildVersion: 1n, policyVersion: 1n,
    masterName: "길드장", masterRank: "👑" };
}

describe("guild joinable list read", () => {
  it("accepts only the exact command", () => {
    assert.equal(isGuildJoinableListReadCommand("/길드목록"), true);
    for (const input of [undefined, "길드목록", "/길드목록 ", "/길드목록 1"]) assert.equal(isGuildJoinableListReadCommand(input), false);
  });

  it("uses guild id as the final deterministic tie breaker", () => {
    const rows = sortJoinableGuilds([row("2", "동률", 3, 10n), row("1", "동률", 3, 10n)]);
    assert.deepEqual(rows.map((value) => value.guildId), ["1", "2"]);
  });

  it("keeps a pinned snapshot order and inserts allsee before row six", () => {
    const rows = Array.from({ length: 6 }, (_value, index) => ({ ...row(String(index + 1), `길드${index + 1}`, 9 - index, 0n), snapshotPosition: index + 1 }));
    const data = formatGuildJoinableList(rows);
    assert.equal((data.match(/\u200b/g) ?? []).length, 500);
    assert.ok(data.indexOf("5. 길드5") < data.indexOf("\u200b"));
    assert.ok(data.indexOf("\u200b") < data.indexOf("6. 길드6"));
    assert.equal(formatGuildJoinableList([]), "📋 가입 가능한 길드 목록\n\n현재 가입 가능한 길드가 없습니다.");
  });
});
