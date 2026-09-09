import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isLetterBoardCandidate, normalizeLetterBoardDispatchMessage, parseLetterBoardCommand } from "../src/social/letter-board-service.js";

describe("letter board command", () => {
  it("accepts free-form posts and exact clear only", () => {
    for (const value of ["/편지 안녕하세요", "/편지   내용 있음", "/편지삭제"]) assert.equal(isLetterBoardCandidate(value), true);
    for (const value of [undefined, "/편지", "/편지   ", "/편지삭제 내용", "/편지함"]) assert.equal(isLetterBoardCandidate(value), false);
  });
  it("parses trimmed content without prefix collision", () => {
    assert.deepEqual(parseLetterBoardCommand("/편지   반가워요  "), { mode: "post", body: "반가워요" });
    assert.deepEqual(parseLetterBoardCommand("/편지삭제"), { mode: "clear" });
    assert.equal(parseLetterBoardCommand("/편지삭제 안내"), null);
  });
  it("normalizes each executable family independently", () => {
    assert.equal(normalizeLetterBoardDispatchMessage("/편지 내용"), "/편지");
    assert.equal(normalizeLetterBoardDispatchMessage("/편지삭제"), "/편지삭제");
    assert.equal(normalizeLetterBoardDispatchMessage("/편지삭제 내용"), "/편지삭제 내용");
  });
});
