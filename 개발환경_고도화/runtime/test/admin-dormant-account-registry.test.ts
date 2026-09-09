import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatAdminDormantRegistryList, normalizeAdminDormantRegistryDispatchMessage, parseAdminDormantRegistryCommand } from "../src/admin/admin-dormant-account-registry-service.js";

describe("admin dormant account registry", () => {
  it("accepts exact list, usage and complete one-line target forms", () => {
    assert.deepEqual(parseAdminDormantRegistryCommand("/휴면계정리스트"), { kind: "list" });
    assert.deepEqual(parseAdminDormantRegistryCommand("/휴면계정"), { kind: "usage", action: "register" });
    assert.deepEqual(parseAdminDormantRegistryCommand("/휴면해제"), { kind: "usage", action: "release" });
    assert.deepEqual(parseAdminDormantRegistryCommand("/휴면계정 홍 길동"), { kind: "register", targetName: "홍 길동" });
    assert.deepEqual(parseAdminDormantRegistryCommand("/휴면해제 홍 길동"), { kind: "release", targetName: "홍 길동" });
  });
  it("rejects suffix collisions, blank targets and multiline input", () => {
    assert.equal(parseAdminDormantRegistryCommand("/휴면계정리스트 1"), null);
    assert.equal(parseAdminDormantRegistryCommand("/휴면계정 "), null);
    assert.equal(parseAdminDormantRegistryCommand("/휴면해제 대상\n추가"), null);
  });
  it("normalizes aliases and keeps stable list output", () => {
    assert.equal(normalizeAdminDormantRegistryDispatchMessage("/휴면계정 대상"), "/휴면계정");
    assert.equal(normalizeAdminDormantRegistryDispatchMessage("/휴면해제 대상"), "/휴면해제");
    assert.match(formatAdminDormantRegistryList([{ player_id: 1n, display_name: "가", started_date: "2026-08-20", elapsed_days: 9n }]), /1\. \[가\] 2026-08-20 \(9일 경과\)/);
  });
});
