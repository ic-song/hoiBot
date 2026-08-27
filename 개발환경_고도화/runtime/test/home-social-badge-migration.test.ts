import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HOME_SOCIAL_BADGE_MIGRATION_COMMAND,
  isHomeSocialBadgeMigrationCommand,
  normalizeHomeSocialBadgeMigrationDispatchMessage,
} from "../src/home/home-social-badge-migration-command.js";
import { buildHomeSocialBadgeMigrationMessage } from "../src/home/home-social-badge-migration-service.js";

describe("home social badge migration", () => {
  it("accepts the exact legacy command", () => assert.equal(isHomeSocialBadgeMigrationCommand(HOME_SOCIAL_BADGE_MIGRATION_COMMAND), true));
  it("blocks argument and prefix collisions", () => {
    assert.equal(isHomeSocialBadgeMigrationCommand("/펫홈소셜뱃지마이그레이션 안내"), false);
    assert.equal(isHomeSocialBadgeMigrationCommand("/펫홈소셜뱃지마이그레이션2"), false);
  });
  it("normalizes only the exact alias", () => {
    assert.equal(normalizeHomeSocialBadgeMigrationDispatchMessage(HOME_SOCIAL_BADGE_MIGRATION_COMMAND), HOME_SOCIAL_BADGE_MIGRATION_COMMAND);
    assert.equal(normalizeHomeSocialBadgeMigrationDispatchMessage("/펫홈소셜뱃지마이그레이션 안내"), "/펫홈소셜뱃지마이그레이션 안내");
  });
  it("preserves the legacy completion copy and counts", () => {
    const message = buildHomeSocialBadgeMigrationMessage("migrated", 2n, 6n);
    assert.match(message, /처리 유저: 2명/);
    assert.match(message, /기존 업적 지급: 6개/);
    assert.match(message, /새 백업 생성/);
  });
  it("reports an already applied marker without another migration", () => {
    assert.match(buildHomeSocialBadgeMigrationMessage("already_applied", 2n, 6n), /이미 완료/);
  });
});
