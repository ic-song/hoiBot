import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApplicationError } from "../src/shared/application-error.js";
import {
  isOperationNoticeCommandCandidate,
  normalizeOperationNoticeDispatchMessage,
  parseOperationNoticeCommand
} from "../src/admin/operation-notice-service.js";

describe("operation notice command boundary", () => {
  it("accepts only the two parameterized notice commands", () => {
    assert.equal(isOperationNoticeCommandCandidate("/정리알림 안내"), true);
    assert.equal(isOperationNoticeCommandCandidate("/패키지알림 여러 줄"), true);
    assert.equal(isOperationNoticeCommandCandidate("/탐험알림 안내"), false);
    assert.equal(isOperationNoticeCommandCandidate("/정리알림"), false);
    assert.equal(isOperationNoticeCommandCandidate("/정리알림 "), false);
    assert.equal(isOperationNoticeCommandCandidate("/정리알림  "), true);
  });

  it("normalizes legacy newline tokens and preserves empty clear semantics", () => {
    assert.equal(parseOperationNoticeCommand("/정리알림  첫째\\n둘째/n셋째  ")!.value, "첫째\n둘째\n셋째");
    assert.equal(parseOperationNoticeCommand("/패키지알림  ")!.value, "");
  });

  it("normalizes argument commands for exact DB dispatch", () => {
    assert.equal(normalizeOperationNoticeDispatchMessage("/정리알림 안내"), "/정리알림");
    assert.equal(normalizeOperationNoticeDispatchMessage("/패키지알림 안내"), "/패키지알림");
  });

  it("rejects NUL and oversized content without exposing it", () => {
    assert.throws(() => parseOperationNoticeCommand("/정리알림 a\0b"), (error) => error instanceof ApplicationError && error.statusCode === 422);
    assert.throws(() => parseOperationNoticeCommand(`/정리알림 ${"a".repeat(16_385)}`), (error) => error instanceof ApplicationError && error.statusCode === 422);
  });
});
