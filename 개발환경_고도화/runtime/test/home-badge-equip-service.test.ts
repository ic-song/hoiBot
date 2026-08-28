import assert from "node:assert/strict";
import test from "node:test";
import { normalizeHomeBadgeEquipDispatchMessage, parseHomeBadgeEquipCommand } from "../src/home/home-badge-equip-command.js";
import { resolveOwnedHomeBadge, type HomeBadgeEquipDefinition } from "../src/home/home-badge-equip-service.js";

const definitions: HomeBadgeEquipDefinition[] = [
  { definition_version_id: 1n, ordinal: 1, badge_code: "F01", emoji_value: "A", display_name: "first" },
  { definition_version_id: 1n, ordinal: 2, badge_code: "F02", emoji_value: "B", display_name: "second" },
  { definition_version_id: 1n, ordinal: 3, badge_code: "HB001", emoji_value: "C", display_name: "third" }
];

test("홈뱃지 장착·해제 guard는 정확 계약만 허용한다", () => {
  assert.deepEqual(parseHomeBadgeEquipCommand("/홈뱃지장착 01"), { kind: "equip", selection: "01" });
  assert.deepEqual(parseHomeBadgeEquipCommand("/홈뱃지장착   hb001"), { kind: "equip", selection: "hb001" });
  assert.deepEqual(parseHomeBadgeEquipCommand("/홈뱃지해제"), { kind: "unequip" });
  for (const invalid of ["/홈뱃지장착", "/홈뱃지장착 1 ", "/홈뱃지장착 [F01]", "/홈뱃지장착 이름", "/홈뱃지해제 "]) {
    assert.equal(parseHomeBadgeEquipCommand(invalid), null);
  }
});

test("dispatch는 parameterized 장착만 대표 별칭으로 정규화한다", () => {
  assert.equal(normalizeHomeBadgeEquipDispatchMessage("/홈뱃지장착 1"), "/홈뱃지장착");
  assert.equal(normalizeHomeBadgeEquipDispatchMessage("/홈뱃지해제"), "/홈뱃지해제");
});

test("번호는 보유 definition 순서, ID는 대소문자 무관으로 해석한다", () => {
  const owned = new Set(["F02", "HB001"]);
  assert.equal(resolveOwnedHomeBadge("01", definitions, owned)?.badge_code, "F02");
  assert.equal(resolveOwnedHomeBadge("hb001", definitions, owned)?.badge_code, "HB001");
  assert.equal(resolveOwnedHomeBadge("F01", definitions, owned), null);
  assert.equal(resolveOwnedHomeBadge("0", definitions, owned), null);
});
