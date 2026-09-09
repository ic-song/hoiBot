import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isHomePassReformCleanupCommand, normalizeHomePassReformCleanupDispatchMessage } from "../src/home/home-pass-reform-cleanup-command.js";
import { buildHomePassReformCleanupMessage } from "../src/home/home-pass-reform-cleanup-service.js";

describe("home pass reform cleanup", () => {
  it("accepts and normalizes only the exact destructive legacy command", () => {
    assert.equal(isHomePassReformCleanupCommand("/펫홈패스개편정리"), true);
    assert.equal(normalizeHomePassReformCleanupDispatchMessage("/펫홈패스개편정리"), "/펫홈패스개편정리");
    for (const value of [undefined, "펫홈패스개편정리", "/펫홈패스개편정리 ", "/펫홈패스개편정리 1", "/펫홈패스개편정리방법"]) assert.equal(isHomePassReformCleanupCommand(value), false);
  });

  it("preserves the legacy completion counts and backup wording", () => {
    const message = buildHomePassReformCleanupMessage({ status: "cleaned", removedCommentCount: 1234n, preservedPinnedCount: 2n, resetLikeUserCount: 3n, resetLikeCount: 5678n });
    assert.match(message, /일반 댓글 삭제: 1,234개/);
    assert.match(message, /댓글핀 유지: 2개/);
    assert.match(message, /좋아홈 초기화: 3명 \/ 5,678개/);
    assert.match(message, /펫홈 백업: 생성 완료\n댓글 백업: 생성 완료/);
  });

  it("preserves the exact already-applied projection", () => {
    assert.equal(buildHomePassReformCleanupMessage({ status: "already_applied", removedCommentCount: 0n, preservedPinnedCount: 0n, resetLikeUserCount: 0n, resetLikeCount: 0n }), "✅ 펫홈 패스 혜택 개편 정리가 이미 완료되었습니다.");
  });
});
