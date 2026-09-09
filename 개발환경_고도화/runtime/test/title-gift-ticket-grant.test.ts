import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isTitleGiftTicketGrantCandidate, normalizeTitleGiftTicketGrantDispatchMessage, parseTitleGiftTicketGrantCommand } from "../src/admin/title-gift-ticket-grant-service.js";

describe("admin title gift ticket grant command", () => {
  it("keeps comma candidates separate from player title selection", () => {
    assert.equal(isTitleGiftTicketGrantCandidate("/타이틀, 대상"), true);
    assert.equal(isTitleGiftTicketGrantCandidate("/타이틀10, 대상"), true);
    assert.equal(isTitleGiftTicketGrantCandidate(" /타이틀, 대상 "), true);
    assert.equal(isTitleGiftTicketGrantCandidate("/타이틀 1"), false);
    assert.equal(normalizeTitleGiftTicketGrantDispatchMessage("/타이틀10, 대상"), "/타이틀,");
  });

  it("preserves default, explicit and zero quantities", () => {
    assert.deepEqual(parseTitleGiftTicketGrantCommand("/타이틀, 대상 회원"), { amount: 1n, targetLegacyKey: "대상 회원" });
    assert.deepEqual(parseTitleGiftTicketGrantCommand("/타이틀25, 대상 회원"), { amount: 25n, targetLegacyKey: "대상 회원" });
    assert.deepEqual(parseTitleGiftTicketGrantCommand("/타이틀0, 대상 회원"), { amount: 0n, targetLegacyKey: "대상 회원" });
  });

  it("keeps raw-regex usage and uint64 boundaries safe", () => {
    assert.equal(parseTitleGiftTicketGrantCommand(" /타이틀, 대상"), null);
    assert.deepEqual(parseTitleGiftTicketGrantCommand("/타이틀, "), { amount: 1n, targetLegacyKey: "" });
    assert.equal(parseTitleGiftTicketGrantCommand("/타이틀18446744073709551616, 대상"), null);
  });
});
