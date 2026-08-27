import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatPlayerTitleGiftSuccess, isPlayerTitleGiftCandidate, normalizePlayerTitleGiftDispatchMessage, parsePlayerTitleGift } from "../src/player/player-title-gift-service.js";

describe("player title gift command", () => {
  it("preserves the broad legacy candidate and representative alias", () => {
    assert.equal(isPlayerTitleGiftCandidate("/타이틀선물 가나다 새 타이틀"), true);
    assert.equal(isPlayerTitleGiftCandidate("/타이틀선물권"), true);
    assert.equal(isPlayerTitleGiftCandidate(" /타이틀선물 가나다 새 타이틀"), false);
    assert.equal(normalizePlayerTitleGiftDispatchMessage("/타이틀선물 가나다 새 타이틀"), "/타이틀선물");
  });

  it("matches the longest member name and validates the title boundary", () => {
    assert.deepEqual(parsePlayerTitleGift("/타이틀선물 가나다라 봄날의 주인", ["가나", "가나다라"]), { kind: "execute", targetName: "가나다라", titleName: "봄날의 주인" });
    assert.deepEqual(parsePlayerTitleGift("/타이틀선물 가나다라", ["가나다라"]), { kind: "usage" });
    assert.deepEqual(parsePlayerTitleGift(`/타이틀선물 가나다라 ${"가".repeat(31)}`, ["가나다라"]), { kind: "too_long" });
  });

  it("keeps the legacy success projection", () => {
    assert.equal(formatPlayerTitleGiftSuccess({ player_id: 2n, display_name: "받는이", rank_emoji: "🌟" }, { identity_id: 1n, player_id: 1n, display_name: "보낸이", rank_emoji: "⭐" }, "선물 타이틀"), "[🌟받는이] 님의 타이틀이\n[선물 타이틀] 로 적용되었습니다💝\n\n보낸 사람: [⭐보낸이]");
  });
});
