import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApplicationError } from "../src/shared/application-error.js";
import { isGuildProfileNoticeMutateCandidate, parseGuildProfileNotice } from "../src/guild/guild-profile-notice-mutate-service.js";

describe("guild profile notice mutation boundary", () => {
  it("recognizes only the exact command namespace", () => {
    assert.equal(isGuildProfileNoticeMutateCandidate("/길드공지"), true);
    assert.equal(isGuildProfileNoticeMutateCandidate("/길드공지 새 공지"), true);
    for (const value of [undefined, "/길드공지사항", "안내 /길드공지 새 공지"]) assert.equal(isGuildProfileNoticeMutateCandidate(value), false);
  });
  it("normalizes a free-form notice", () => assert.equal(parseGuildProfileNotice("/길드공지   새 길드 공지  "), "새 길드 공지"));
  it("rejects an empty notice", () => assert.throws(() => parseGuildProfileNotice("/길드공지"), (error: unknown) => error instanceof ApplicationError && error.code === "GUILD_NOTICE_REQUIRED"));
  it("preserves the 30-character boundary", () => {
    assert.equal(parseGuildProfileNotice(`/길드공지 ${"가".repeat(30)}`).length, 30);
    assert.throws(() => parseGuildProfileNotice(`/길드공지 ${"가".repeat(31)}`), (error: unknown) => error instanceof ApplicationError && error.code === "GUILD_NOTICE_TOO_LONG");
  });
});
