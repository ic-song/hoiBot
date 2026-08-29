import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isAdminDormantAccountCommand, normalizeAdminDormantAccountDispatchMessage, parseAdminDormantAccountCommand
} from "../src/admin/admin-dormant-account-delete-service.js";

describe("admin dormant account commands", () => {
  it("accepts usage and unsigned level forms for list and delete", () => {
    assert.deepEqual(parseAdminDormantAccountCommand("/계정잠수명단"), { kind: "usage", action: "list" });
    assert.deepEqual(parseAdminDormantAccountCommand("/계정잠수삭제\t0  "), { kind: "delete", levelThreshold: 0n });
    assert.deepEqual(parseAdminDormantAccountCommand("/계정잠수명단 100"), { kind: "list", levelThreshold: 100n });
  });

  it("rejects suffix, signs, overflow and multiline input", () => {
    assert.equal(parseAdminDormantAccountCommand("/계정잠수삭제 1 해봐"), null);
    assert.equal(parseAdminDormantAccountCommand("/계정잠수삭제 -1"), null);
    assert.equal(parseAdminDormantAccountCommand("/계정잠수명단 18446744073709551616"), null);
    assert.equal(parseAdminDormantAccountCommand("/계정잠수명단 1\n"), null);
  });

  it("normalizes only executable candidates", () => {
    assert.equal(isAdminDormantAccountCommand("/계정잠수명단 1"), true);
    assert.equal(normalizeAdminDormantAccountDispatchMessage("/계정잠수명단 1"), "/계정잠수명단");
    assert.equal(normalizeAdminDormantAccountDispatchMessage("/계정잠수삭제 1"), "/계정잠수삭제");
  });
});
