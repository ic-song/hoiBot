import assert from "node:assert/strict";
import test from "node:test";
import { isGuildCreateCandidate, parseGuildCreateCommand } from "../src/guild/guild-create-service.js";

test("길드 생성은 세 명령 namespace만 후보로 허용한다", () => {
  assert.equal(isGuildCreateCandidate("/길드생성"), true);
  assert.equal(isGuildCreateCandidate("/길드안만들꼬임"), true);
  assert.equal(isGuildCreateCandidate("/길드만들기 새길드 G"), true);
  assert.equal(isGuildCreateCandidate("/길드생성 안내"), false);
});

test("시작과 취소 exact 명령을 분리한다", () => {
  assert.deepEqual(parseGuildCreateCommand("/길드생성"), { action: "start", commandCode: "GUILD_CREATE_START" });
  assert.deepEqual(parseGuildCreateCommand("/길드안만들꼬임"), { action: "cancel", commandCode: "GUILD_CREATE_CANCEL" });
});

test("생성 확정은 길드명과 마크를 고정한다", () => {
  assert.deepEqual(parseGuildCreateCommand("/길드만들기 새길드 ⚔"), { action: "commit", commandCode: "GUILD_CREATE_COMMIT", name: "새길드", normalizedName: "새길드", mark: "⚔" });
});

test("길드명 30자와 마크 UTF-16 10자 경계를 허용한다", () => {
  assert.equal(parseGuildCreateCommand(`/길드만들기 ${"가".repeat(30)} ${"A".repeat(10)}`).action, "commit");
  assert.throws(() => parseGuildCreateCommand(`/길드만들기 ${"가".repeat(31)} A`), /1~30/);
  assert.throws(() => parseGuildCreateCommand(`/길드만들기 길드 ${"A".repeat(11)}`), /1~10/);
});

test("누락·추가·개행 인자는 실행하지 않는다", () => {
  assert.throws(() => parseGuildCreateCommand("/길드만들기"), /사용법/);
  assert.throws(() => parseGuildCreateCommand("/길드만들기 길드 M 안내"), /사용법/);
  assert.throws(() => parseGuildCreateCommand("/길드만들기 길드\nM"), /형식/);
});
