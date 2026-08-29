import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isAdminAccountDeleteProgressCommand,
  normalizeAdminAccountDeleteProgressDispatchMessage,
  parseAdminAccountDeleteProgressCommand
} from "../src/admin/admin-account-delete-progress-service.js";

describe("admin account delete progress", () => {
  it("accepts bare usage and a complete comma-separated target list", () => {
    assert.deepEqual(parseAdminAccountDeleteProgressCommand("/계삭진행"), { kind: "usage" });
    assert.deepEqual(parseAdminAccountDeleteProgressCommand("/계삭진행 하나, 둘, 하나"), {
      kind: "delete", targetNames: ["하나", "둘"]
    });
  });

  it("rejects suffix-only, trailing-space and multiline collisions", () => {
    assert.equal(parseAdminAccountDeleteProgressCommand("/계삭진행 "), null);
    assert.equal(parseAdminAccountDeleteProgressCommand("/계삭진행자 하나"), null);
    assert.equal(parseAdminAccountDeleteProgressCommand("/계삭진행 하나\n둘"), null);
  });

  it("normalizes only valid parameterized dispatch messages", () => {
    assert.equal(isAdminAccountDeleteProgressCommand("/계삭진행 대상"), true);
    assert.equal(normalizeAdminAccountDeleteProgressDispatchMessage("/계삭진행 대상"), "/계삭진행");
    assert.equal(normalizeAdminAccountDeleteProgressDispatchMessage("/계삭진행자 대상"), "/계삭진행자 대상");
  });
});
