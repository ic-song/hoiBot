import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPointEditCommandCandidate } from "../src/admin/iris-admin-command-service.js";
import { isSpecialBadgeRevokeCommandCandidate, resolveSpecialBadgeDefinition } from "../src/admin/special-badge-revoke-service.js";

const badges = [{ badge_code: "S01", emoji: "🎂", display_name: "펫홈 1주년" }];

describe("special badge revoke command boundary", () => {
  it("accepts a target and badge expression but rejects incomplete commands", () => {
    for (const message of ["/특별뱃지회수 회원 S01", "/특별뱃지회수 회원, [S01]"]) {
      assert.equal(isSpecialBadgeRevokeCommandCandidate(message), true);
      assert.equal(isPointEditCommandCandidate(message), true);
    }
    for (const message of ["/특별뱃지회수", "/특별뱃지회수 ", "/특별뱃지회수회원 S01", "특별뱃지회수 회원 S01"]) {
      assert.equal(isSpecialBadgeRevokeCommandCandidate(message), false);
      assert.equal(isPointEditCommandCandidate(message), false);
    }
  });

  it("resolves every legacy badge representation", () => {
    for (const value of ["S01", "[S01]", "펫홈 1주년", "🎂 펫홈 1주년", "[S01] 🎂 펫홈 1주년"]) {
      assert.equal(resolveSpecialBadgeDefinition(value, badges)?.badge_code, "S01");
    }
    assert.equal(resolveSpecialBadgeDefinition("S99", badges), undefined);
  });
});
