import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildManagedBackupRevisionKey,
  formatManagedBackupResult,
  isManagedBackupCommand,
} from "../src/admin/managed-backup-command-service.js";

describe("admin managed backup command", () => {
  it("accepts only the exact no-argument command", () => {
    assert.equal(isManagedBackupCommand("/백업"), true);
    for (const value of ["/백업 ", " /백업", "/백업 1", "/백업해줘", "dev/데이터백업"]) {
      assert.equal(isManagedBackupCommand(value), false);
    }
  });

  it("pins the event and ordered source revisions", () => {
    const rows = [
      { targetCode: "member", fileName: "member.json", revisionVersion: 1n, contentSha256: "a".repeat(64) },
      { targetCode: "guild", fileName: "guildData.json", revisionVersion: null, contentSha256: null },
    ];
    const first = buildManagedBackupRevisionKey("event-1", rows);
    assert.equal(first, buildManagedBackupRevisionKey("event-1", rows));
    assert.notEqual(first, buildManagedBackupRevisionKey("event-2", rows));
    assert.match(first, /^sha256:[0-9a-f]{64}$/);
  });

  it("reports verified and missing targets explicitly", () => {
    assert.equal(
      formatManagedBackupResult(["member.json"], ["guildData.json"]),
      "✅ 운영 데이터 백업 완료\n대상: 2개\n저장: 1개\n누락: 1개\n- 누락 파일: guildData.json",
    );
  });
});
