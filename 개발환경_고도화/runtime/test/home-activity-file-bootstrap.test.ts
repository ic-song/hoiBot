import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HOME_ACTIVITY_FILE_BOOTSTRAP_COMMAND, isHomeActivityFileBootstrapCommand, normalizeHomeActivityFileBootstrapDispatchMessage } from "../src/home/home-activity-file-bootstrap-command.js";
import { buildHomeActivityFileBootstrapMessage } from "../src/home/home-activity-file-bootstrap-service.js";

describe("home activity file bootstrap", () => {
  it("accepts only the exact legacy command", () => {
    assert.equal(isHomeActivityFileBootstrapCommand(HOME_ACTIVITY_FILE_BOOTSTRAP_COMMAND), true);
    for (const value of [undefined, "펫홈활동파일생성", "/펫홈활동파일생성 ", "/펫홈활동파일생성 안내", "/펫홈활동파일생성2"]) assert.equal(isHomeActivityFileBootstrapCommand(value), false);
  });
  it("normalizes only the exact alias", () => {
    assert.equal(normalizeHomeActivityFileBootstrapDispatchMessage(HOME_ACTIVITY_FILE_BOOTSTRAP_COMMAND), HOME_ACTIVITY_FILE_BOOTSTRAP_COMMAND);
    assert.equal(normalizeHomeActivityFileBootstrapDispatchMessage("/펫홈활동파일생성 안내"), "/펫홈활동파일생성 안내");
  });
  it("preserves both legacy reply meanings", () => {
    assert.match(buildHomeActivityFileBootstrapMessage("created"), /활동 파일 생성 완료/);
    assert.match(buildHomeActivityFileBootstrapMessage("already_exists"), /이미 있습니다/);
  });
});
