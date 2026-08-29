import assert from "node:assert/strict";
import test from "node:test";
import { computeAdminGuildResetSnapshotChecksum, isAdminGuildResetAllCommand } from "../src/admin/admin-guild-reset-all-service.js";

test("길드 전체 초기화는 exact 명령만 허용한다", () => {
  assert.equal(isAdminGuildResetAllCommand("/길드전체초기화"), true);
  assert.equal(isAdminGuildResetAllCommand("/길드전체초기화 "), false);
  assert.equal(isAdminGuildResetAllCommand("/길드전체초기화 확인"), false);
  assert.equal(isAdminGuildResetAllCommand("/길드영지초기화"), false);
});

test("sealed snapshot checksum은 정렬된 table·stable key·JSON에 고정된다", () => {
  const rows = [{ tableCode: "guilds", stableKey: "1", json: '{"id":"1"}' }, { tableCode: "guild_members", stableKey: "1:2", json: '{"guild_id":"1","player_id":"2"}' }];
  const checksum = computeAdminGuildResetSnapshotChecksum(rows);
  assert.equal(checksum.length, 64);
  assert.equal(computeAdminGuildResetSnapshotChecksum(rows), checksum);
  assert.notEqual(computeAdminGuildResetSnapshotChecksum([...rows].reverse()), checksum);
});
