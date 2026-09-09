import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatRequestMonitorExceptionReply,
  isRequestMonitorExceptionCommandCandidate,
  parseRequestMonitorExceptionCommand
} from "../src/admin/request-monitor-exception-service.js";
import { isPointEditCommandCandidate } from "../src/admin/iris-admin-command-service.js";

describe("request monitor exception command boundary", () => {
  it("parses four full-value commands and blocks prefix collisions", () => {
    const examples = [
      ["/요청예외명령추가   /패키지 사용  ", { kind: "command", action: "add", value: "/패키지 사용" }],
      ["/요청예외명령삭제 /패키지 사용", { kind: "command", action: "delete", value: "/패키지 사용" }],
      ["/요청예외방추가   고도화 테스트 방 ", { kind: "room", action: "add", value: "고도화 테스트 방" }],
      ["/요청예외방삭제 고도화 테스트 방", { kind: "room", action: "delete", value: "고도화 테스트 방" }]
    ] as const;
    for (const [message, expected] of examples) {
      assert.equal(isRequestMonitorExceptionCommandCandidate(message), true);
      assert.equal(isPointEditCommandCandidate(message), true);
      assert.deepEqual(parseRequestMonitorExceptionCommand(message), expected);
    }
    for (const message of ["/요청예외명령추가", "/요청예외명령추가안내 /패키지", "/요청예외방삭제안내 테스트방"]) {
      assert.equal(isRequestMonitorExceptionCommandCandidate(message), false);
    }
    assert.throws(() => parseRequestMonitorExceptionCommand("/요청예외명령추가   "));
  });

  it("keeps the four legacy success projections", () => {
    assert.equal(formatRequestMonitorExceptionReply({ kind: "command", action: "add", value: "/가방" }), "예외 명령어에 추가되었습니다: /가방");
    assert.equal(formatRequestMonitorExceptionReply({ kind: "command", action: "delete", value: "/가방" }), "예외 명령어에서 삭제되었습니다: /가방");
    assert.equal(formatRequestMonitorExceptionReply({ kind: "room", action: "add", value: "테스트방" }), "예외 방에 추가되었습니다: 테스트방");
    assert.equal(formatRequestMonitorExceptionReply({ kind: "room", action: "delete", value: "테스트방" }), "예외 방에서 삭제되었습니다: 테스트방");
  });
});
