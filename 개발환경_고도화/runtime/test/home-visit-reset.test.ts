import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HOME_VISIT_RESET_COMMAND, isHomeVisitResetCommand, normalizeHomeVisitResetDispatchMessage } from "../src/home/home-visit-reset-command.js";
import { buildHomeVisitResetMessage } from "../src/home/home-visit-reset-service.js";

describe("home visit reset", () => {
  it("accepts the exact legacy command", () => assert.equal(isHomeVisitResetCommand(HOME_VISIT_RESET_COMMAND), true));
  it("blocks argument and prefix collisions", () => {
    assert.equal(isHomeVisitResetCommand("/펫홈방문초기화 안내"), false);
    assert.equal(isHomeVisitResetCommand("/펫홈방문초기화2"), false);
  });
  it("normalizes only the exact alias", () => {
    assert.equal(normalizeHomeVisitResetDispatchMessage(HOME_VISIT_RESET_COMMAND), HOME_VISIT_RESET_COMMAND);
    assert.equal(normalizeHomeVisitResetDispatchMessage("/펫홈방문초기화 안내"), "/펫홈방문초기화 안내");
  });
  it("preserves the legacy completion copy", () => assert.match(buildHomeVisitResetMessage(2n), /방문자수 초기화 완료/));
  it("reports every home row including zero counters", () => assert.match(buildHomeVisitResetMessage(3n), /초기화된 유저 수: 3명/));
});
