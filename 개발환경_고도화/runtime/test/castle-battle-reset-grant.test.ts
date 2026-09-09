import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isCastleBattleResetGrantCommandCandidate, parseCastleBattleResetGrantCommand } from "../src/admin/castle-battle-reset-grant-service.js";

describe("castle battle reset grant command boundary", () => {
  it("preserves the legacy default and explicit quantities", () => {
    assert.deepEqual(parseCastleBattleResetGrantCommand("/캐대전, 회원"), { amount: 1n, targetLegacyKey: "회원" });
    assert.deepEqual(parseCastleBattleResetGrantCommand("/캐대전10, 여러 단어 회원"), { amount: 10n, targetLegacyKey: "여러 단어 회원" });
  });
  it("keeps zero for the legacy validation reply", () => {
    assert.deepEqual(parseCastleBattleResetGrantCommand("/캐대전0, 회원"), { amount: 0n, targetLegacyKey: "회원" });
  });
  it("does not collide with the player battle command or suffix forms without a comma", () => {
    for (const message of ["/캐슬대전", "/캐대전", "/캐대전 10 회원", "/캐대전결과", "/대전10, 회원"]) {
      assert.equal(isCastleBattleResetGrantCommandCandidate(message), false);
    }
    for (const message of ["/캐대전, 회원", "/캐대전10, 회원", "/캐대전10,"]) {
      assert.equal(isCastleBattleResetGrantCommandCandidate(message), true);
    }
  });
});
