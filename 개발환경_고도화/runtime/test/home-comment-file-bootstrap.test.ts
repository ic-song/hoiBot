import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HOME_COMMENT_FILE_BOOTSTRAP_COMMAND,
  isHomeCommentFileBootstrapCommand,
  normalizeHomeCommentFileBootstrapDispatchMessage,
} from "../src/home/home-comment-file-bootstrap-command.js";
import { buildHomeCommentFileBootstrapMessage } from "../src/home/home-comment-file-bootstrap-service.js";

describe("home comment file bootstrap", () => {
  it("accepts the exact legacy command", () => assert.equal(isHomeCommentFileBootstrapCommand(HOME_COMMENT_FILE_BOOTSTRAP_COMMAND), true));
  it("blocks argument and prefix collisions", () => {
    assert.equal(isHomeCommentFileBootstrapCommand("/펫홈댓글파일생성 안내"), false);
    assert.equal(isHomeCommentFileBootstrapCommand("/펫홈댓글파일생성2"), false);
  });
  it("normalizes only the exact alias", () => {
    assert.equal(normalizeHomeCommentFileBootstrapDispatchMessage(HOME_COMMENT_FILE_BOOTSTRAP_COMMAND), HOME_COMMENT_FILE_BOOTSTRAP_COMMAND);
    assert.equal(normalizeHomeCommentFileBootstrapDispatchMessage("/펫홈댓글파일생성 안내"), "/펫홈댓글파일생성 안내");
  });
  it("preserves the legacy created reply meaning", () => assert.match(buildHomeCommentFileBootstrapMessage("created"), /댓글 파일 생성 완료/));
  it("preserves the legacy already-exists reply meaning", () => assert.match(buildHomeCommentFileBootstrapMessage("already_exists"), /이미 있습니다/));
});
