import assert from "node:assert/strict";
import test from "node:test";
import { buildAbsenceAttendanceResult, parseAbsenceAttendanceCommand } from "../src/attendance/absence-attendance-read-service.js";

test("미출석 명령은 레거시 공백과 숫자 형식만 허용한다", () => {
  assert.equal(parseAbsenceAttendanceCommand("/미출석 0"), 0);
  assert.equal(parseAbsenceAttendanceCommand("/미출석   30   "), 30);
  assert.equal(parseAbsenceAttendanceCommand("/미출석"), null);
  assert.equal(parseAbsenceAttendanceCommand("/미출석 -1"), null);
  assert.equal(parseAbsenceAttendanceCommand("/미출석 3 해봐"), null);
  assert.equal(parseAbsenceAttendanceCommand("/미출석\t3"), null);
});

test("YYYYMMDD 숫자 뺄셈과 source 순서 및 누락 recent를 보존한다", () => {
  const result = buildAbsenceAttendanceResult([
    { sourceOrder: 3, playerName: "셋", recentYyyymmdd: "" },
    { sourceOrder: 1, playerName: "하나", recentYyyymmdd: "20260824" },
    { sourceOrder: 2, playerName: "둘", recentYyyymmdd: "20260825" }
  ], 3, "20260827");
  assert.deepEqual(result.absentNames, ["하나", "셋"]);
  assert.equal(result.replies[0], "전체 등록인원 3중 2명의 사용자가 최근3일 내에 ㅊㅊ하지 않았습니다.\n해당일자내 ㅊㅊ인원 : 1");
  assert.equal(result.replies[1], "미출첵 명단 \n\n하나, 셋");
});

test("미출석자가 없어도 빈 두 번째 응답을 유지한다", () => {
  const result = buildAbsenceAttendanceResult([
    { sourceOrder: 1, playerName: "출석", recentYyyymmdd: "20260827" }
  ], 1, "20260827");
  assert.deepEqual(result.absentNames, []);
  assert.equal(result.replies[1], "미출첵 명단 \n\n");
});

