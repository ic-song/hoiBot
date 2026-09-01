import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPassListCommandCandidate, normalizePassListDispatchMessage } from "../src/pass/pass-list-command.js";

describe("pass list read command", () => {
  it("accepts only the exact command", () => {
    assert.equal(isPassListCommandCandidate("/패스목록"), true);
    for (const value of ["/패스목록 1", "/패스목록 안내", "/패스목록 ", "/패스"]) assert.equal(isPassListCommandCandidate(value), false);
  });
  it("normalizes the registry alias", () => assert.equal(normalizePassListDispatchMessage("/패스목록"), "/패스목록"));
});
