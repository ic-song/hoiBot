import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPointEditCommandCandidate } from "../src/admin/iris-admin-command-service.js";
import { formatOperationIntervalResetReply, isOperationIntervalResetCommand } from "../src/admin/operation-interval-reset-service.js";

describe("operation interval reset command boundary", () => {
  it("accepts only the exact legacy command", () => {
    assert.equal(isOperationIntervalResetCommand("/주기리셋"), true);
    assert.equal(isPointEditCommandCandidate("/주기리셋"), true);
    for (const message of ["/주기리셋 ", "/주기리셋 안내", "/주기리셋1", "주기리셋"]) {
      assert.equal(isOperationIntervalResetCommand(message), false);
      assert.equal(isPointEditCommandCandidate(message), false);
    }
  });

  it("keeps the legacy success reply", () => {
    assert.equal(formatOperationIntervalResetReply(), "주기리셋완");
  });
});
