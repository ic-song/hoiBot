import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatHomeFurnitureCleanReply, isHomeFurnitureCleanCandidate, normalizeHomeFurnitureCleanDispatchMessage, parseHomeFurnitureCleanCommand } from "./home-furniture-clean-service.js";

describe("home furniture clean", () => {
  it("accepts only exact usage and one full numeric argument", () => {
    for (const value of ["/집청소", "/집청소 0", "/집청소 2"]) assert.equal(isHomeFurnitureCleanCandidate(value), true);
    for (const value of [undefined, "집청소", "/집청소 ", "/집청소 -1", "/집청소 1 해봐", "/집청소1"]) assert.equal(isHomeFurnitureCleanCandidate(value), false);
  });

  it("parses and normalizes bigint-safe indexes", () => {
    assert.deepEqual(parseHomeFurnitureCleanCommand("/집청소"), { kind: "usage" });
    assert.deepEqual(parseHomeFurnitureCleanCommand("/집청소 0"), { kind: "index", index: 0n });
    assert.deepEqual(parseHomeFurnitureCleanCommand("/집청소 18446744073709551615"), { kind: "index", index: 18446744073709551615n });
    assert.equal(parseHomeFurnitureCleanCommand("/집청소 18446744073709551616"), null);
    assert.equal(normalizeHomeFurnitureCleanDispatchMessage("/집청소 2"), "/집청소");
    assert.equal(normalizeHomeFurnitureCleanDispatchMessage("/집청소 2 해봐"), "/집청소 2 해봐");
  });

  it("formats the stable success response", () => {
    assert.equal(formatHomeFurnitureCleanReply("🏆호이", "황금 침대", 123456n, 100000n), "🏡[🏆호이]님,\n황금 침대(+123,456💕) 을(를)\n가구정리센터에 보냈습니다.\n\n🅟100,000 를 획득합니다.");
  });
});
