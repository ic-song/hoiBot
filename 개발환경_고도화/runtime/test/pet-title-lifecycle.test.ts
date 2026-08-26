import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatPetTitleList, normalizePetTitleDispatchMessage, parsePetTitleCommand } from "../src/pet/pet-title-lifecycle-service.js";

describe("pet title lifecycle boundary", () => {
  it("classifies the five full legacy command forms", () => {
    assert.deepEqual(parsePetTitleCommand("/펫타이틀 2"), { kind: "select", index: 2 });
    assert.deepEqual(parsePetTitleCommand("/펫타이틀목록"), { kind: "list_self" });
    assert.deepEqual(parsePetTitleCommand("/펫타이틀목록 긴사용자명"), { kind: "list_target", targetName: "긴사용자" });
    assert.deepEqual(parsePetTitleCommand("/펫타이틀이름  별빛 친구 "), { kind: "create", titleName: "별빛 친구" });
    assert.deepEqual(parsePetTitleCommand("/펫타이틀제거 대상 남 3"), { kind: "remove", targetName: "대상 남", index: 3 });
    assert.equal(parsePetTitleCommand("/펫타이틀 2 해봐"), null);
  });

  it("normalizes argument commands without creating broad aliases", () => {
    assert.equal(normalizePetTitleDispatchMessage("/펫타이틀 7"), "/펫타이틀 [번호]");
    assert.equal(normalizePetTitleDispatchMessage("/펫타이틀목록 대상"), "/펫타이틀목록 [유저명]");
    assert.equal(normalizePetTitleDispatchMessage("/펫타이틀이름 나의 펫"), "/펫타이틀이름 [인자]");
    assert.equal(normalizePetTitleDispatchMessage("/펫타이틀제거 대상 1"), "/펫타이틀제거 [유저명] [타이틀번호]");
  });

  it("keeps current sequence, equipped marker, detail and allsee independently of instance IDs", () => {
    const rows = Array.from({ length: 11 }, (_, index) => ({
      instanceId: BigInt(9007199254740993 + index), displayName: `타이틀${index + 1}`,
      priceDigits: "100000000", acquiredAt: "2026-08-27T00:00:00.000Z", equipped: index === 1,
    }));
    const self = formatPetTitleList("⭐사용자", rows, false);
    assert.match(self, /1\. 타이틀1/);
    assert.match(self, /☞ 2\. 타이틀2/);
    assert.equal((self.match(/\u200b/g) ?? []).length, 500);
    const detail = formatPetTitleList("⭐사용자", rows.slice(0, 1), true);
    assert.match(detail, /가격: 🅟100,000,000/);
    assert.doesNotMatch(self, /9007199254740993/);
  });
});
