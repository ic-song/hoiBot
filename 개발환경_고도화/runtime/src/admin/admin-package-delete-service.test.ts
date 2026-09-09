import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatAdminPackageDeleteReply,
  isAdminPackageDeleteCommand,
  normalizeAdminPackageDeleteDispatchMessage
} from "./admin-package-delete-service.js";

describe("admin package delete", () => {
  it("accepts only the exact no-argument command", () => {
    assert.equal(isAdminPackageDeleteCommand("/선물삭제"), true);
    for (const value of [undefined, "선물삭제", "/선물삭제 ", "/선물삭제 1", "/선물삭제 해봐"]) {
      assert.equal(isAdminPackageDeleteCommand(value), false);
    }
  });

  it("normalizes only the executable alias", () => {
    assert.equal(normalizeAdminPackageDeleteDispatchMessage("/선물삭제"), "/선물삭제");
    assert.equal(normalizeAdminPackageDeleteDispatchMessage("/선물삭제 해봐"), "/선물삭제 해봐");
  });

  it("preserves the fixed 1 through 10 range and positive quantity summary", () => {
    assert.equal(
      formatAdminPackageDeleteReply(2n, 4n, 10n),
      "🎁 무료 호이응원패키지 삭제 완료\n범위: [1] ~ [10]\n삭제 회원: 2명\n삭제 항목: 4건\n삭제 수량: 10개"
    );
  });
});