import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isHoiPassCommandCandidate, normalizeHoiPassDispatchMessage, parseHoiPassCommand } from "../src/pass/hoi-pass-command.js";

describe("hoi pass command", () => {
  it("parses permanent, dated and delete forms", () => {
    assert.deepEqual(parseHoiPassCommand("/호이패스추가, 테스트 유저"), { action: "add", target: "테스트 유저", option: "permanent", endDate: null, rawEndDate: "영구권" });
    assert.deepEqual(parseHoiPassCommand("/호이패스추가, 테스트 유저 99.12.31"), { action: "add", target: "테스트 유저", option: "dated", endDate: "2099-12-31", rawEndDate: "99.12.31" });
    assert.deepEqual(parseHoiPassCommand("/호이패스삭제, 테스트 유저"), { action: "delete", target: "테스트 유저" });
  });

  it("rejects incomplete and suffix-guide forms while normalizing valid aliases", () => {
    assert.equal(isHoiPassCommandCandidate("/호이패스추가"), false);
    assert.equal(parseHoiPassCommand("/호이패스추가, 테스트 유저 99.13.31"), null);
    assert.equal(normalizeHoiPassDispatchMessage("/호이패스추가, 테스트 유저"), "/호이패스추가");
    assert.equal(normalizeHoiPassDispatchMessage("/호이패스삭제, 테스트 유저"), "/호이패스삭제");
  });
});
