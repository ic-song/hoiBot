import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatSocialBoard, isSocialBoardReadCommand } from "../src/social/social-board-read-service.js";

describe("social board read", () => {
  it("accepts only the exact command", () => {
    assert.equal(isSocialBoardReadCommand("/게시판"), true);
    assert.equal(isSocialBoardReadCommand("/게시판 "), false);
    assert.equal(isSocialBoardReadCommand("/게시판 1"), false);
    assert.equal(isSocialBoardReadCommand("/게시판삭제"), false);
  });

  it("preserves stable post order, rank, content and date", () => {
    assert.equal(formatSocialBoard([
      { postId: "10", authorName: "첫회원", rankEmoji: "🌱", content: "첫 글", createdAt: "2026-08-27 10:00" },
      { postId: "20", authorName: "둘회원", rankEmoji: "👑", content: "둘째\n글", createdAt: "2026-08-27 11:00" }
    ]), "📋 전체 서버 게시판\n━━━━━━━━━━━━\n[🌱첫회원] 첫 글\n2026-08-27 10:00\n\n[👑둘회원] 둘째\n글\n2026-08-27 11:00");
  });

  it("uses a safe missing-author projection", () => {
    assert.match(formatSocialBoard([
      { postId: "1", authorName: "탈퇴회원", rankEmoji: "", content: "보존 글", createdAt: "2026-08-27 12:00" }
    ]), /\[탈퇴회원\] 보존 글/);
  });

  it("keeps an empty board as the guide header only", () => {
    assert.equal(formatSocialBoard([]), "📋 전체 서버 게시판\n━━━━━━━━━━━━");
  });
});
