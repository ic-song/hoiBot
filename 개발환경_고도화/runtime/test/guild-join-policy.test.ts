import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildGuildExperienceRequiredMessage,
  buildGuildJoinCompletedMessage,
  buildGuildJoinConfirmationMessage,
  evaluateGuildJoin,
  getEffectiveGuildMemberLimit,
  isGuildJoinCancellation,
  isGuildJoinConfirmation,
  parseGuildJoinCommand,
  sortJoinableGuilds,
  type GuildJoinCandidate
} from "../src/guild/guild-join-policy.js";

const candidate: GuildJoinCandidate = {
  guildId: "900000001",
  displayName: "알파길드",
  mark: "A",
  serverCode: "alpha",
  level: 8,
  joinRequirementExperience: 1000n,
  memberCount: 5,
  maxMembers: 5,
  recruitmentBonus: 1,
  memberJoinClosed: false
};

describe("guild join command policy", () => {
  it("accepts one positive guild number and rejects appended guide text", () => {
    assert.equal(parseGuildJoinCommand("/길드가입 1"), 1);
    assert.equal(parseGuildJoinCommand("/길드가입   42"), 42);
    for (const message of ["/길드가입", "/길드가입 0", "/길드가입 -1", "/길드가입 1 안내", "/길드가입1"]) {
      assert.equal(parseGuildJoinCommand(message), null, message);
    }
  });

  it("keeps the exact legacy confirmation and cancellation aliases", () => {
    assert.equal(isGuildJoinConfirmation("/가입한다"), true);
    assert.equal(isGuildJoinConfirmation("가입한다"), true);
    assert.equal(isGuildJoinConfirmation("가입한다 안내"), false);
    assert.equal(isGuildJoinCancellation("/안한다"), true);
    assert.equal(isGuildJoinCancellation("안한다"), false);
  });
});

describe("guild join eligibility policy", () => {
  it("applies the recruitment bonus to the member limit", () => {
    assert.equal(getEffectiveGuildMemberLimit(candidate), 6);
    assert.deepEqual(evaluateGuildJoin(candidate, 1000n), { eligible: true, reason: "joinable" });
  });

  it("rechecks closed, full and experience requirements", () => {
    assert.equal(evaluateGuildJoin({ ...candidate, memberJoinClosed: true }, 1000n).reason, "closed");
    assert.equal(evaluateGuildJoin({ ...candidate, memberCount: 6 }, 1000n).reason, "full");
    assert.equal(evaluateGuildJoin(candidate, 999n).reason, "experience_required");
  });

  it("filters unavailable guilds and preserves the legacy list order", () => {
    const rows = sortJoinableGuilds([
      { ...candidate, guildId: "4", displayName: "가길드", level: 8, joinRequirementExperience: 2000n },
      { ...candidate, guildId: "3", displayName: "나길드", level: 8, joinRequirementExperience: 2000n },
      { ...candidate, guildId: "2", displayName: "최상위", level: 9, joinRequirementExperience: 0n },
      { ...candidate, guildId: "1", displayName: "마감", memberJoinClosed: true }
    ]);
    assert.deepEqual(rows.map((row) => row.guildId), ["2", "4", "3"]);
  });
});

describe("guild join reply policy", () => {
  it("keeps confirmation, completion and EXP shortage formatting", () => {
    assert.equal(buildGuildJoinConfirmationMessage("🌱합성회원 남", candidate),
      "✅ [🌱합성회원 남] 님\n🎖️ 알파길드(A) 길드에 가입하실껀가요?\n\n👉 [가입한다] / [안한다]\n\n━━━━━━━━━━━━━━━\n※ [가입한다]을 입력하면 길드에 가입됩니다.");
    assert.equal(buildGuildJoinCompletedMessage(candidate), "✅ 길드 가입 완료!\n길드: 알파길드(A)[alpha]");
    assert.equal(buildGuildExperienceRequiredMessage(1234567n, 999n),
      "❌ 가입조건 미달입니다.\n필요 EXP: 1,234,567 이상\n내 EXP: 999");
  });
});
