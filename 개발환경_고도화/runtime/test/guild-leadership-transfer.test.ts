import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApplicationError } from "../src/shared/application-error.js";
import { isGuildLeadershipTransferCandidate, parseGuildLeadershipTransfer } from "../src/guild/guild-leadership-transfer-service.js";

describe("guild leadership transfer boundary", () => {
  it("recognizes only the exact namespace", () => { assert.equal(isGuildLeadershipTransferCandidate("/길드위임"), true); assert.equal(isGuildLeadershipTransferCandidate("/길드위임 길드, 대상"), true); for (const value of [undefined,"/길드위임안내","안내 /길드위임 길드, 대상"]) assert.equal(isGuildLeadershipTransferCandidate(value), false); });
  it("parses guild and target names around one comma", () => assert.deepEqual(parseGuildLeadershipTransfer("/길드위임  호이 길드 ,  새 마스터 "), { guildName: "호이 길드", targetName: "새 마스터" }));
  it("rejects a missing comma or field", () => { for (const value of ["/길드위임","/길드위임 길드 대상","/길드위임 길드,","/길드위임 , 대상"]) assert.throws(() => parseGuildLeadershipTransfer(value), (error: unknown) => error instanceof ApplicationError && error.code === "GUILD_TRANSFER_USAGE"); });
  it("rejects extra comma fields", () => assert.throws(() => parseGuildLeadershipTransfer("/길드위임 길드, 대상, 추가"), (error: unknown) => error instanceof ApplicationError && error.code === "GUILD_TRANSFER_USAGE"));
});
