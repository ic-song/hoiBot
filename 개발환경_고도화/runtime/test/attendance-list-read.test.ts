import assert from "node:assert/strict";
import test from "node:test";
import { buildAttendanceListMessage, isAttendanceListCommand } from "../src/attendance/attendance-list-read-service.js";

test("출석목록은 trim 이후 exact 명령만 실행한다", () => {
  assert.equal(isAttendanceListCommand("/출석목록"), true);
  assert.equal(isAttendanceListCommand("  /출석목록  "), true);
  assert.equal(isAttendanceListCommand("/출석목록 1"), false);
  assert.equal(isAttendanceListCommand("/출석목록보기"), false);
});

test("저장 순서와 랭크 이모지 및 10명 allsee 경계를 보존한다", () => {
  const entries = Array.from({ length: 12 }, (_, index) => ({
    playerId: index + 1,
    playerName: `유저${index + 1}`,
    tierCode: null,
    sourceOrder: 12 - index,
    rankEmoji: index % 2 === 0 ? "⭐" : ""
  }));
  const message = buildAttendanceListMessage(entries, "<ALLSEE>");
  assert.ok(message.indexOf("1. [유저12]") < message.indexOf("10. [⭐유저3]"));
  assert.match(message, /10\. \[⭐유저3\]\n<ALLSEE>\n11\. \[유저2\]/);
  assert.ok(message.endsWith("12. [⭐유저1]"));
});

test("빈 목록에도 안내와 allsee 및 마지막 개행을 남긴다", () => {
  assert.equal(
    buildAttendanceListMessage([], "<ALLSEE>"),
    "출석한 유저 목록:\n출석한 유저가 없습니다.\n<ALLSEE>\n"
  );
});

