import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isGuildDisbandDeleteCommandCandidate, parseGuildDisbandDeleteCommand } from "../src/guild/guild-disband-delete-service.js";

describe("guild disband delete", () => {
  it("unifies the three exact-name aliases", () => {
    for (const alias of ["/길드삭제", "/길드해산", "/길드해지"]) {
      assert.equal(isGuildDisbandDeleteCommandCandidate(alias), true);
      assert.deepEqual(parseGuildDisbandDeleteCommand(`${alias} 합성 길드`), { guildName: "합성 길드" });
    }
  });

  it("rejects missing, padded, newline and oversized names", () => {
    for (const message of ["/길드삭제", "/길드해지 길드 ", "/길드해산 길드\n오염", `/길드삭제 ${"가".repeat(192)}`]) {
      assert.equal(parseGuildDisbandDeleteCommand(message), null);
    }
  });
});
