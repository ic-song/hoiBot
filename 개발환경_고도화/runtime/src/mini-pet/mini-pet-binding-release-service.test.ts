import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatMiniPetBindingReleaseReply, isMiniPetBindingReleaseCommand, miniPetBindingReleaseBagLimit, normalizeMiniPetBindingReleaseDispatchMessage } from "./mini-pet-binding-release-service.js";

describe("mini pet binding release", () => {
  it("accepts only the exact no-argument command", () => {
    assert.equal(isMiniPetBindingReleaseCommand("/귀속해제"), true);
    for (const value of [undefined, "귀속해제", "/귀속해제 ", "/귀속해제 1", "/귀속해제 해봐", "/귀속"]) assert.equal(isMiniPetBindingReleaseCommand(value), false);
  });
  it("normalizes only the executable alias", () => {
    assert.equal(normalizeMiniPetBindingReleaseDispatchMessage("/귀속해제"), "/귀속해제");
    assert.equal(normalizeMiniPetBindingReleaseDispatchMessage("/귀속해제 1"), "/귀속해제 1");
  });
  it("keeps the ten-slot base and fifteen-slot premium capacity", () => {
    assert.equal(miniPetBindingReleaseBagLimit(10n, 5n, false), 10n);
    assert.equal(miniPetBindingReleaseBagLimit(10n, 5n, true), 15n);
  });
  it("renders the stable pet and post-release capacity", () => {
    assert.equal(formatMiniPetBindingReleaseReply("🏆호이", "토끼", "🐰", 10n, 15n), "[🏆호이] 님\n🐰토끼 미니펫의 귀속을 해제했습니다.\n미니펫 가방: 10/15");
  });
});
