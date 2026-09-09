import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isMiniPetDuelResetGrantCommandCandidate, parseMiniPetDuelResetGrantCommand } from "../src/admin/mini-pet-duel-reset-grant-service.js";

describe("mini pet duel reset grant command boundary", () => {
  it("preserves the legacy default and explicit quantities", () => {
    assert.deepEqual(parseMiniPetDuelResetGrantCommand("/대전, 회원"), { amount:1n,targetLegacyKey:"회원" });
    assert.deepEqual(parseMiniPetDuelResetGrantCommand("/대전10, 여러 단어 회원"), { amount:10n,targetLegacyKey:"여러 단어 회원" });
  });
  it("keeps zero for the legacy validation reply", () => assert.deepEqual(parseMiniPetDuelResetGrantCommand("/대전0, 회원"), { amount:0n,targetLegacyKey:"회원" }));
  it("rejects similar battle commands and suffix forms without a comma", () => {
    for(const message of ["/대전","/대전 10 회원","/대전결과","/캐대전10, 회원"]) assert.equal(isMiniPetDuelResetGrantCommandCandidate(message),false);
    for(const message of ["/대전, 회원","/대전10, 회원","/대전10,"]) assert.equal(isMiniPetDuelResetGrantCommandCandidate(message),true);
  });
});
