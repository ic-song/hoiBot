import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isHomeFurnitureRemoveCandidate, normalizeHomeFurnitureRemoveDispatchMessage, parseHomeFurnitureRemoveRequest } from "./home-furniture-remove-service.js";

describe("home furniture remove command", () => {
  it("preserves the legacy prefix candidate", () => {
    assert.equal(isHomeFurnitureRemoveCandidate("/가구제거 대상 1"), true);
    assert.equal(isHomeFurnitureRemoveCandidate("/가구제거 "), true);
    for (const value of [undefined, "/가구제거", "가구제거 대상 1", " /가구제거 대상 1"]) assert.equal(isHomeFurnitureRemoveCandidate(value), false);
  });

  it("preserves split-space target names and parseInt-style indexes", () => {
    assert.deepEqual(parseHomeFurnitureRemoveRequest("/가구제거 홍 길동 02개"), { kind: "valid", targetName: "홍 길동", requestedIndex: 2n });
    assert.deepEqual(parseHomeFurnitureRemoveRequest("/가구제거 홍 길동 +1.9"), { kind: "valid", targetName: "홍 길동", requestedIndex: 1n });
  });

  it("separates usage and invalid legacy replies", () => {
    assert.deepEqual(parseHomeFurnitureRemoveRequest("/가구제거 대상"), { kind: "usage" });
    assert.deepEqual(parseHomeFurnitureRemoveRequest("/가구제거 대상 0"), { kind: "invalid" });
    assert.deepEqual(parseHomeFurnitureRemoveRequest("/가구제거  1"), { kind: "invalid" });
  });

  it("normalizes candidates only", () => {
    assert.equal(normalizeHomeFurnitureRemoveDispatchMessage("/가구제거 대상 1"), "/가구제거");
    assert.equal(normalizeHomeFurnitureRemoveDispatchMessage("/가구제거"), "/가구제거");
  });
});
