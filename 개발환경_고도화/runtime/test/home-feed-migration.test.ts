import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isHomeFeedMigrationCommand, normalizeHomeFeedMigrationDispatchMessage } from "../src/home/home-feed-migration-command.js";
import { buildHomeFeedMigrationMessage } from "../src/home/home-feed-migration-service.js";

describe("home feed migration", () => {
  it("accepts and normalizes only the exact destructive legacy command", () => {
    assert.equal(isHomeFeedMigrationCommand("/펫홈피드마이그레이션"), true);
    assert.equal(normalizeHomeFeedMigrationDispatchMessage("/펫홈피드마이그레이션"), "/펫홈피드마이그레이션");
    for (const value of [undefined, "펫홈피드마이그레이션", "/펫홈피드마이그레이션 ", "/펫홈피드마이그레이션 1", "/펫홈피드마이그레이션방법"]) assert.equal(isHomeFeedMigrationCommand(value), false);
  });

  it("preserves the legacy completion counts and backup wording", () => {
    const message = buildHomeFeedMigrationMessage({ status: "migrated", userCount: 1234n, legacyFeedCount: 56n });
    assert.equal(message, "✅ 펫홈 피드 마이그레이션 완료\n처리 유저: 1,234명\n이전 한줄평: 56개\n홈 데이터 백업: 새 백업 생성");
  });

  it("preserves the exact already-applied projection", () => {
    assert.equal(buildHomeFeedMigrationMessage({ status: "already_applied", userCount: 0n, legacyFeedCount: 0n }), "ℹ️ 펫홈 피드 마이그레이션은 이미 완료되었습니다.");
  });
});
