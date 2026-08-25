import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isFirstSponsorCommandCandidate, normalizeFirstSponsorDispatchMessage } from "../src/admin/first-sponsor-registry-service.js";

describe("first sponsor command boundary", () => {
  it("accepts only complete register, list and release forms", () => {
    for (const message of ["/첫후원 합성회원", "/첫후원 여러 단어 회원", "/첫후원리스트", "/첫후원해제 합성회원"]) {
      assert.equal(isFirstSponsorCommandCandidate(message), true);
    }
    for (const message of [undefined, "/첫후원", "/첫후원 ", "/첫후원리스트 안내", "/첫후원해제", "/첫후원해제 "]) {
      assert.equal(isFirstSponsorCommandCandidate(message), false);
    }
  });

  it("normalizes parameterized commands only after full-pattern validation", () => {
    assert.equal(normalizeFirstSponsorDispatchMessage("/첫후원 합성 회원"), "/첫후원");
    assert.equal(normalizeFirstSponsorDispatchMessage("/첫후원해제 합성 회원"), "/첫후원해제");
    assert.equal(normalizeFirstSponsorDispatchMessage("/첫후원리스트"), "/첫후원리스트");
    assert.equal(normalizeFirstSponsorDispatchMessage("/첫후원"), "/첫후원");
  });
});
