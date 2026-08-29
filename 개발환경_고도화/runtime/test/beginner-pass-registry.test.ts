import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isBeginnerPassCommandCandidate, normalizeBeginnerPassDispatchMessage, parseBeginnerPassCommand } from "../src/pass/beginner-pass-command.js";

describe("beginner pass registry command", () => {
  it("accepts only complete add and delete commands", () => {
    assert.equal(isBeginnerPassCommandCandidate("/초보추가, 홍 길동 99.12.31"), true);
    assert.equal(isBeginnerPassCommandCandidate("/초보패스삭제, 홍 길동"), true);
    assert.equal(isBeginnerPassCommandCandidate("/초보"), false);
    assert.equal(isBeginnerPassCommandCandidate("/초보추가"), false);
    assert.equal(isBeginnerPassCommandCandidate("/초보오픈1"), false);
  });

  it("parses permanent, dated, compatibility alias and delete forms", () => {
    assert.deepEqual(parseBeginnerPassCommand("/초보추가, 홍 길동"), { action: "add", target: "홍 길동", option: "permanent", endDate: null, rawEndDate: "영구권" });
    assert.deepEqual(parseBeginnerPassCommand("/초보패스추가, 홍 길동 99.12.31"), { action: "add", target: "홍 길동", option: "dated", endDate: "2099-12-31", rawEndDate: "99.12.31" });
    assert.deepEqual(parseBeginnerPassCommand("/초보삭제, 홍 길동"), { action: "delete", target: "홍 길동" });
    assert.equal(parseBeginnerPassCommand("/초보추가, 홍 길동 99.02.30"), null);
  });

  it("normalizes executable parameterized aliases", () => {
    assert.equal(normalizeBeginnerPassDispatchMessage("/초보패스추가, 홍 길동"), "/초보추가");
    assert.equal(normalizeBeginnerPassDispatchMessage("/초보패스삭제, 홍 길동"), "/초보삭제");
    assert.equal(normalizeBeginnerPassDispatchMessage("/초보"), "/초보");
  });
});
