import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPointEditCommandCandidate } from "../src/admin/iris-admin-command-service.js";
import { isSpecialBadgeGrantCommandCandidate } from "../src/admin/special-badge-grant-service.js";

describe("special badge grant command boundary", () => {
  it("accepts a target and badge expression but rejects incomplete commands", () => {
    for (const message of ["/특별뱃지지급 회원 S01", "/특별뱃지지급 회원, [S01]"]) {
      assert.equal(isSpecialBadgeGrantCommandCandidate(message), true);
      assert.equal(isPointEditCommandCandidate(message), true);
    }
    for (const message of ["/특별뱃지지급", "/특별뱃지지급 ", "/특별뱃지지급회원 S01", "특별뱃지지급 회원 S01"]) {
      assert.equal(isSpecialBadgeGrantCommandCandidate(message), false);
      assert.equal(isPointEditCommandCandidate(message), false);
    }
  });

  it("keeps grant and revoke dispatch candidates separate", () => {
    assert.equal(isSpecialBadgeGrantCommandCandidate("/특별뱃지회수 회원 S01"), false);
    assert.equal(isSpecialBadgeGrantCommandCandidate("/특별뱃지지급 회원 S01 안내"), true);
  });
});
