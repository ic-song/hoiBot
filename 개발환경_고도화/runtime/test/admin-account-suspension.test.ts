import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatAdminAccountSuspensionList,
  isAdminAccountSuspensionCommand,
  normalizeAdminAccountSuspensionDispatchMessage,
  parseAdminAccountSuspensionCommand
} from "../src/admin/admin-account-suspension-service.js";

describe("admin account suspension command boundary", () => {
  it("accepts three exact single-line command forms", () => {
    for (const message of ["/계정정지 회원", "/계정정지 여러 단어 회원", "/계정정지해제 회원", "/계정정지리스트"]) {
      assert.equal(isAdminAccountSuspensionCommand(message), true, message);
    }
  });

  it("rejects bare, suffix, similar and multiline inputs", () => {
    for (const message of ["/계정정지", "/계정정지해제", "/계정정지리스트 1", "/계정정지2 회원", "/계정정지 회원\n안내"]) {
      assert.equal(isAdminAccountSuspensionCommand(message), false, message);
    }
  });

  it("preserves spaced display names and normalizes aliases", () => {
    assert.equal(parseAdminAccountSuspensionCommand("/계정정지해제 여러 단어 회원")?.targetName, "여러 단어 회원");
    assert.equal(normalizeAdminAccountSuspensionDispatchMessage("/계정정지 여러 단어 회원"), "/계정정지");
    assert.equal(normalizeAdminAccountSuspensionDispatchMessage("/계정정지해제 회원"), "/계정정지해제");
    assert.equal(normalizeAdminAccountSuspensionDispatchMessage("/계정정지리스트"), "/계정정지리스트");
  });

  it("formats empty and stable ordered list replies", () => {
    assert.equal(formatAdminAccountSuspensionList([]), "📋 계정 정지 목록\n\n정지된 계정이 없습니다.");
    assert.equal(formatAdminAccountSuspensionList([
      { displayName: "첫 회원", startedDate: "2026-08-20", elapsedDays: 9 },
      { displayName: "둘째 회원", startedDate: "2026-08-29", elapsedDays: 0 }
    ]), "📋 계정 정지 목록\n\n1. [첫 회원] 2026-08-20 (9일 경과)\n2. [둘째 회원] 2026-08-29 (0일 경과)");
  });
});
