import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildLegacyAdminListReply, getLegacyAdminNames } from "../src/admin/legacy-admin-list-read-policy.js";

describe("legacy administrator-list policy", () => {
  it("lists every legacy data.admin key in Korean-name order without status or role filtering", () => {
    const source = { 다온: { status: "suspended", roles: [] }, 가온: { status: "active", roles: ["manager"] }, 나래: null };
    assert.deepEqual(getLegacyAdminNames(source), ["가온", "나래", "다온"]);
    assert.equal(buildLegacyAdminListReply(source, "[allsee]"),
      "🛠 관리자 명단\n━━━━━━━━━━━━\n총 관리자 수: 3명\n━━━━━━━━━━━━\n관리자 명단 보기👈[allsee]\n1. 가온\n2. 나래\n3. 다온");
  });

  it("keeps the exact empty reply for empty or unavailable legacy sources", () => {
    assert.equal(buildLegacyAdminListReply({}, "[allsee]"), "현재 관리자가 없습니다.");
    assert.equal(buildLegacyAdminListReply(null, "[allsee]"), "현재 관리자가 없습니다.");
    assert.equal(buildLegacyAdminListReply("not-an-object", "[allsee]"), "현재 관리자가 없습니다.");
  });

  it("keeps legacy object-key behavior for non-record objects", () => {
    assert.deepEqual(getLegacyAdminNames(["first", "second"]), ["0", "1"]);
  });
});
