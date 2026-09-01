import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isOperationDailyResetCommand, operationDailyResetMessages } from "../src/admin/operation-daily-reset-command-service.js";

describe("operation daily reset command consumer", () => {
  it("accepts only the exact legacy command", () => {
    assert.equal(isOperationDailyResetCommand("/리셋"), true);
    for (const message of ["/리셋 ", "/리셋 1", "/리셋안내", "리셋", undefined]) assert.equal(isOperationDailyResetCommand(message), false);
  });

  it("preserves the legacy completion and broadcast messages", () => {
    assert.deepEqual(operationDailyResetMessages(), {
      complete: "출첵시작! 리셋 완료",
      broadcast: "출석체크가 시작 되었습니다!\nㅊㅊ 가즈아!!",
    });
  });
});
