import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApplicationError } from "../src/shared/application-error.js";
import { formatGuildBoard, isGuildBoardCommandCandidate, normalizeGuildBoardDispatchMessage, parseGuildBoardCommand, requireGuildBoardBodyLimit } from "../src/guild/guild-board-service.js";

describe("guild board v2.400 contract", () => {
  it("recognizes only exact aliases and their content namespaces", () => {
    for (const value of ["/길메", "/길메 글", "/길드게시판", "/길드게시판 글", "/길드게시판공지 공지", "/길드게시판초기화"]) assert.equal(isGuildBoardCommandCandidate(value), true);
    for (const value of [undefined, "/길메뉴", "/길드게시판초기화 1", "안내 /길드게시판"]) assert.equal(isGuildBoardCommandCandidate(value), false);
  });
  it("parses read, post, notice and clear while preserving trim", () => {
    assert.deepEqual(parseGuildBoardCommand("/길메"), { kind: "READ" });
    assert.deepEqual(parseGuildBoardCommand("/길드게시판  글  "), { kind: "POST", body: "글" });
    assert.deepEqual(parseGuildBoardCommand("/길드게시판공지 공지"), { kind: "NOTICE", body: "공지" });
    assert.deepEqual(parseGuildBoardCommand("/길드게시판초기화"), { kind: "CLEAR" });
  });
  it("allows 30 UTF-16 units and rejects empty or 31", () => {
    const exact = parseGuildBoardCommand(`/길메 ${"가".repeat(30)}`); requireGuildBoardBodyLimit(exact, "랭크회원");
    assert.equal((exact as { body: string }).body.length, 30);
    for (const value of ["/길메 ", "/길드게시판공지   "]) assert.throws(() => parseGuildBoardCommand(value), (error: unknown) => error instanceof ApplicationError);
    assert.throws(() => requireGuildBoardBodyLimit(parseGuildBoardCommand(`/길드게시판 ${"가".repeat(31)}`), "랭크회원"), /랭크회원.*게시글은 30자/);
  });
  it("normalizes every family member to a registered alias", () => {
    assert.equal(normalizeGuildBoardDispatchMessage("/길메 글"), "/길메");
    assert.equal(normalizeGuildBoardDispatchMessage("/길드게시판 글"), "/길드게시판");
    assert.equal(normalizeGuildBoardDispatchMessage("/길드게시판공지 공지"), "/길드게시판공지");
  });
  it("formats notice first and posts in the supplied newest-first order", () => {
    const data = formatGuildBoard({ guildName: "호이", notice: { body: "공지", writer: "마스터", date: "08/30 03:00" }, posts: [
      { postId: "2", body: "최신", writer: "둘", date: "08/30 03:01" },
      { postId: "1", body: "이전", writer: "하나", date: "08/29 03:00" },
    ] });
    assert.equal(data, "🎖️ 호이 길드 게시판 🎖️\n\n길드게시판 공지📢:\n공지 (08/30 03:00)\n\n[둘] : 최신 (08/30 03:01)\n[하나] : 이전 (08/29 03:00)");
    assert.ok(data.indexOf("공지") < data.indexOf("최신"));
    assert.ok(data.indexOf("최신") < data.indexOf("이전"));
  });
});
