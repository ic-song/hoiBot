import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isStatusAllCommand, TransientCommandStateStore } from "../src/admin/status-all-service.js";

describe("admin status all", () => {
  it("accepts only the exact command", () => {
    assert.equal(isStatusAllCommand("/상태전체"), true);
    assert.equal(isStatusAllCommand("/상태전체 "), false);
    assert.equal(isStatusAllCommand("/상태전체 1"), false);
    assert.equal(isStatusAllCommand("/상태전체보기"), false);
  });

  it("preserves pretty JSON while redacting sensitive keys", () => {
    const store = new TransientCommandStateStore();
    store.set("member-a", { phase: "confirm", count: 2, accessToken: "secret-value" });
    const snapshot = store.snapshot();
    assert.equal(snapshot.entryCount, 1);
    assert.equal(snapshot.redactedCount, 1);
    assert.equal(snapshot.truncated, false);
    assert.equal(snapshot.data, '{\n  "member-a": {\n    "phase": "confirm",\n    "count": 2,\n    "accessToken": "[REDACTED]"\n  }\n}');
  });

  it("captures circular and oversized state without throwing", () => {
    const store = new TransientCommandStateStore();
    const circular: Record<string, unknown> = { text: "x".repeat(4_010) };
    circular.self = circular;
    store.set("member-b", circular);
    const snapshot = store.snapshot();
    assert.equal(snapshot.truncated, true);
    assert.match(snapshot.data, /\[TRUNCATED\]/);
    assert.match(snapshot.data, /\[Circular\]/);
  });

  it("starts empty again after a process-local store is recreated", () => {
    const before = new TransientCommandStateStore();
    before.set("member-c", { step: 1 });
    assert.equal(before.snapshot().entryCount, 1);
    const restarted = new TransientCommandStateStore();
    assert.deepEqual(restarted.snapshot(), { data: "{}", entryCount: 0, redactedCount: 0, truncated: false, snapshotVersion: 0 });
  });
});
