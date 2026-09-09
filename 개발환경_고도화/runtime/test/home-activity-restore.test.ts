import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isHomeActivityRestoreCommand, normalizeHomeActivityRestoreDispatchMessage } from "../src/home/home-activity-restore-command.js";
import { buildHomeActivityRestoreMessage } from "../src/home/home-activity-restore-service.js";

describe("home activity restore", () => {
  it("accepts and normalizes only the exact destructive legacy command", () => {
    assert.equal(isHomeActivityRestoreCommand("/펫홈활동살리기"), true);
    assert.equal(normalizeHomeActivityRestoreDispatchMessage("/펫홈활동살리기"), "/펫홈활동살리기");
    for (const value of [undefined, "펫홈활동살리기", "/펫홈활동살리기 ", "/펫홈활동살리기 1", "/펫홈활동살리기방법"]) assert.equal(isHomeActivityRestoreCommand(value), false);
  });

  it("preserves all legacy restore replies exactly", () => {
    assert.equal(buildHomeActivityRestoreMessage("restored"), "✅ 펫홈 활동 데이터를 직전 정상 백업으로 복구했습니다.");
    assert.equal(buildHomeActivityRestoreMessage("missing"), "❌ 펫홈 활동 백업 파일이 없습니다.");
    assert.equal(buildHomeActivityRestoreMessage("invalid"), "❌ 펫홈 활동 백업 복구에 실패했습니다.");
  });
});
