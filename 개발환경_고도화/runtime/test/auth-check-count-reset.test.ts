import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatAuthCheckCountResetReply, isAuthCheckCountResetCommand } from "../src/admin/auth-check-count-reset-service.js";
import { isPointEditCommandCandidate } from "../src/admin/iris-admin-command-service.js";

describe("auth check count reset command boundary", () => {
  it("accepts only the exact command through the shared admin candidate", () => {
    assert.equal(isAuthCheckCountResetCommand("/인증초기화"), true);
    assert.equal(isPointEditCommandCandidate("/인증초기화"), true);
    for (const message of ["/인증초기화 ", "/인증초기화 안내", "/인증초기화1", "인증초기화"]) {
      assert.equal(isAuthCheckCountResetCommand(message), false);
      assert.equal(isPointEditCommandCandidate(message), false);
    }
  });

  it("preserves the legacy completion reply and comma formatting", () => {
    assert.equal(formatAuthCheckCountResetReply(0), "📋 인증 데이터 초기화 완료\n\n초기화된 유저 수: 0명");
    assert.equal(formatAuthCheckCountResetReply(1234), "📋 인증 데이터 초기화 완료\n\n초기화된 유저 수: 1,234명");
  });
});
