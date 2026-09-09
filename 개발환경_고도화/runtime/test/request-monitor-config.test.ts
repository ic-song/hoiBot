import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatRequestMonitorConfigReply, isRequestMonitorConfigCommandCandidate, parseRequestMonitorConfigCommand } from "../src/admin/request-monitor-config-service.js";
import { isPointEditCommandCandidate } from "../src/admin/iris-admin-command-service.js";

describe("request monitor config command boundary", () => {
  it("accepts exact read and two-token update while preserving decimal floor", () => {
    assert.deepEqual(parseRequestMonitorConfigCommand("/요청설정"), { kind: "read" });
    assert.deepEqual(parseRequestMonitorConfigCommand("/요청설정 1.5 2.9"), { kind: "update", windowMs: 1500, limitCount: 2 });
    for (const message of ["/요청설정", "/요청설정 1.5 2.9"]) {
      assert.equal(isRequestMonitorConfigCommandCandidate(message), true);
      assert.equal(isPointEditCommandCandidate(message), true);
    }
    for (const message of ["/요청설정 ", "/요청설정 1 2 안내", "/요청설정1 2 3"]) {
      assert.equal(isRequestMonitorConfigCommandCandidate(message), false);
    }
    for (const message of ["/요청설정 0 2", "/요청설정 1 NaN", "/요청설정 Infinity 2"]) {
      assert.throws(() => parseRequestMonitorConfigCommand(message));
    }
  });

  it("formats read and changed projections in seconds and count units", () => {
    assert.equal(formatRequestMonitorConfigReply("2000", "4", false), "📋 요청 감지 설정\n\n감지 시간: 2초\n감지 횟수: 4회");
    assert.equal(formatRequestMonitorConfigReply("1500", "2", true), "✅ 요청 감지 설정 변경 완료\n\n감지 시간: 1.5초\n감지 횟수: 2회");
  });
});
