import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isLegendaryStoneTicketGrantCandidate,
  normalizeLegendaryStoneTicketGrantDispatchMessage,
  parseLegendaryStoneTicketGrantCommand
} from "../src/admin/legendary-stone-ticket-grant-service.js";

describe("legendary stone ticket grant command", () => {
  it("accepts only complete /전돌 quantity-comma-target forms", () => {
    assert.equal(isLegendaryStoneTicketGrantCandidate("/전돌, 회원 A"), true);
    assert.equal(isLegendaryStoneTicketGrantCandidate(" /전돌12, 회원 A "), true);
    assert.equal(isLegendaryStoneTicketGrantCandidate("/전돌12 회원 A"), false);
    assert.equal(isLegendaryStoneTicketGrantCandidate("/전돌12,"), false);
    assert.equal(isLegendaryStoneTicketGrantCandidate("/전돌뽑기 12"), false);
  });

  it("preserves default quantity and target names containing spaces", () => {
    assert.deepEqual(parseLegendaryStoneTicketGrantCommand("/전돌, 회원 A"), { amount: 1n, targetLegacyKey: "회원 A" });
    assert.deepEqual(parseLegendaryStoneTicketGrantCommand("/전돌12, 회원 A"), { amount: 12n, targetLegacyKey: "회원 A" });
  });

  it("rejects overflow and normalizes accepted commands to the catalog alias", () => {
    assert.equal(parseLegendaryStoneTicketGrantCommand("/전돌18446744073709551616, 회원 A"), null);
    assert.equal(normalizeLegendaryStoneTicketGrantDispatchMessage("/전돌2, 회원 A"), "/전돌,");
    assert.equal(normalizeLegendaryStoneTicketGrantDispatchMessage("/전돌뽑기 2"), "/전돌뽑기 2");
  });
});
