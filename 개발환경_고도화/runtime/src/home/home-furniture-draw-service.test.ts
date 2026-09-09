import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatHomeFurnitureDrawReply,
  isHomeFurnitureDrawCandidate,
  normalizeHomeFurnitureDrawDispatchMessage,
  parseHomeFurnitureDrawCommand,
  planHomeFurnitureDraws,
  type FurnitureDrawBand,
  type FurnitureDrawEntryChoice
} from "./home-furniture-draw-service.js";

describe("home furniture draw", () => {
  it("accepts only the exact command or one full numeric quantity", () => {
    for (const value of ["/샵오픈", "/샵오픈 0", "/샵오픈 1", "/샵오픈 5001", "/샵오픈 999999999999999999999"]) {
      assert.equal(isHomeFurnitureDrawCandidate(value), true);
    }
    for (const value of [undefined, "샵오픈", "/샵오픈 ", "/샵오픈 -1", "/샵오픈 1 해봐", "/샵오픈1"]) {
      assert.equal(isHomeFurnitureDrawCandidate(value), false);
    }
  });

  it("parses the default and bigint-safe quantity without truncation", () => {
    assert.deepEqual(parseHomeFurnitureDrawCommand("/샵오픈"), { quantity: 1n });
    assert.deepEqual(parseHomeFurnitureDrawCommand("/샵오픈 18446744073709551615"), { quantity: 18446744073709551615n });
    assert.equal(normalizeHomeFurnitureDrawDispatchMessage("/샵오픈 2"), "/샵오픈");
    assert.equal(normalizeHomeFurnitureDrawDispatchMessage("/샵오픈 2 해봐"), "/샵오픈 2 해봐");
  });

  it("keeps both RNG stages stable for the same seed", () => {
    const bands: FurnitureDrawBand[] = [
      { ordinal: 1, name: "일반", weight: 9n },
      { ordinal: 2, name: "희귀", weight: 1n }
    ];
    const entries: FurnitureDrawEntryChoice[] = [
      { id: "1", definitionId: "11", gradeOrdinal: 1, display: "일반 A", furnitureName: "A", charm: 1n },
      { id: "2", definitionId: "12", gradeOrdinal: 1, display: "일반 B", furnitureName: "B", charm: 2n },
      { id: "3", definitionId: "13", gradeOrdinal: 2, display: "희귀 C", furnitureName: "C", charm: 3n }
    ];
    const first = planHomeFurnitureDraws("seed-001", bands, entries, 20);
    const replay = planHomeFurnitureDraws("seed-001", bands, entries, 20);
    assert.deepEqual(replay, first);
    assert.equal(first.length, 20);
    assert.ok(first.every((draw) => draw.entry.gradeOrdinal === (draw.gradeName === "일반" ? 1 : 2)));
  });

  it("formats ticket, capacity, stable code and folded result lines", () => {
    const reply = formatHomeFurnitureDrawReply(
      "🏆호이",
      12n,
      1n,
      0n,
      11n,
      15n,
      Array.from({ length: 11 }, (_, index) => ({ display: `가구 ${index + 1}`, instanceCode: `A${String(index).padStart(5, "0")}` }))
    );
    assert.match(reply, /사용 티켓: 11개 \(12 → 1\)/);
    assert.match(reply, /가구 가방: 0\/15 → 11\/15/);
    assert.match(reply, /11\. 가구 11 \[A00010\]/);
    assert.match(reply, /\u200b{100}/);
  });
});