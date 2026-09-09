import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isRecordBoardCommandCandidate, normalizeRecordBoardCommand, parseRecordBoardCommand } from "../src/social/record-board-service.js";

describe("record board command", () => {
  it("keeps four command families separate", () => { assert.equal(parseRecordBoardCommand("/기록실")?.family, "read"); assert.deepEqual(parseRecordBoardCommand("/기록 공지 내용"), { family: "add", body: "공지 내용", valid: true }); assert.equal(parseRecordBoardCommand("/빌런 2")?.displayNumber, 2); assert.equal(parseRecordBoardCommand("/기록삭제 3")?.displayNumber, 3); });
  it("blocks prefix collisions and malformed numbers", () => { assert.equal(isRecordBoardCommandCandidate("/기록실 suffix"), false); assert.equal(parseRecordBoardCommand("/기록삭제 1 안내"), null); assert.equal(parseRecordBoardCommand("/빌런 0")?.valid, false); assert.equal(parseRecordBoardCommand("/기록 凸 중요 위조")?.body, "중요 위조"); });
  it("normalizes only executable command candidates", () => { assert.equal(normalizeRecordBoardCommand("/기록 내용"), "/기록"); assert.equal(normalizeRecordBoardCommand("/기록실"), "/기록실"); assert.equal(normalizeRecordBoardCommand("/빌런 1"), "/빌런"); assert.equal(normalizeRecordBoardCommand("/기록삭제 1"), "/기록삭제"); assert.equal(normalizeRecordBoardCommand("/기록실 suffix"), undefined); });
});
