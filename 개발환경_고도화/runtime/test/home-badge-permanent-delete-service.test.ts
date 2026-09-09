import assert from "node:assert/strict";
import test from "node:test";
import { normalizeHomeBadgePermanentDeleteDispatchMessage, parseHomeBadgePermanentDeleteCommand } from "../src/home/home-badge-permanent-delete-command.js";
import { resolveOwnedBadgeForDelete, type HomeBadgeDeleteDefinition } from "../src/home/home-badge-permanent-delete-service.js";

const definitions: HomeBadgeDeleteDefinition[] = [
  { definition_version_id: 1n, ordinal: 1, badge_code: "F01" },
  { definition_version_id: 1n, ordinal: 2, badge_code: "F02" },
  { definition_version_id: 1n, ordinal: 3, badge_code: "HB001" }
];

test("홈뱃지 영구삭제 guard는 숫자 또는 ID 하나만 허용한다", () => {
  assert.deepEqual(parseHomeBadgePermanentDeleteCommand("/홈뱃지삭제 01"), { selection: "01" });
  assert.deepEqual(parseHomeBadgePermanentDeleteCommand("/홈뱃지삭제   hb001"), { selection: "hb001" });
  for (const invalid of ["/홈뱃지삭제", "/홈뱃지삭제 1 ", "/홈뱃지삭제 [F01]", "/홈뱃지삭제 이름", "/홈뱃지삭제 1 해줘"]) {
    assert.equal(parseHomeBadgePermanentDeleteCommand(invalid), null);
  }
});

test("영구삭제 dispatch는 완전한 입력만 대표 별칭으로 정규화한다", () => {
  assert.equal(normalizeHomeBadgePermanentDeleteDispatchMessage("/홈뱃지삭제 F01"), "/홈뱃지삭제");
  assert.equal(normalizeHomeBadgePermanentDeleteDispatchMessage("/홈뱃지삭제 F01 "), "/홈뱃지삭제 F01 ");
});

test("영구삭제 번호는 제외되지 않은 보유 목록 순서를 사용한다", () => {
  const owned = new Set(["F02", "HB001"]);
  assert.deepEqual(resolveOwnedBadgeForDelete("01", definitions, owned), { definition: definitions[1], ownedOrdinal: 1 });
  assert.equal(resolveOwnedBadgeForDelete("hb001", definitions, owned)?.ownedOrdinal, 2);
  assert.equal(resolveOwnedBadgeForDelete("F01", definitions, owned), null);
});
