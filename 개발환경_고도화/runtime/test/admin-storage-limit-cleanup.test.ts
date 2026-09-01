import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatAdminStorageLimitCleanupMessage, isAdminStorageLimitCleanupCommand } from "../src/admin/admin-storage-limit-cleanup-service.js";

describe("admin storage limit cleanup", () => {
  it("accepts only the exact legacy command", () => {
    assert.equal(isAdminStorageLimitCleanupCommand("/글자수전체정리"), true);
    for (const value of [undefined, "글자수전체정리", "/글자수전체정리 ", "/글자수전체정리 1", "/글자수전체정리해줘"]) assert.equal(isAdminStorageLimitCleanupCommand(value), false);
  });

  it("formats no-target and multi-domain parity messages", () => {
    const empty = formatAdminStorageLimitCleanupMessage({ miniPetRemovedCount: 0, furnitureRemovedCount: 0, pendantRemovedCount: 0, miniLogs: [], furnitureLogs: [], pendantLogs: [] });
    assert.match(empty, /정리할 초과 데이터가 없습니다/);
    assert.doesNotMatch(empty, /데이터 저장이 완료되었습니다/);
    const changed = formatAdminStorageLimitCleanupMessage({ miniPetRemovedCount: 2, furnitureRemovedCount: 3, pendantRemovedCount: 1, miniLogs: ["mini"], furnitureLogs: ["furniture"], pendantLogs: ["pendant"] });
    assert.match(changed, /미니펫 정리: 2마리 삭제/);
    assert.match(changed, /가구 정리: 3개 삭제/);
    assert.match(changed, /펜던트 정리: 1개 삭제/);
    assert.match(changed, /mini[\s\S]*furniture[\s\S]*pendant/);
  });
});
