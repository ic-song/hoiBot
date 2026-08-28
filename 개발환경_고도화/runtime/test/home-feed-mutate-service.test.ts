import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isHomeFeedMutationCommandCandidate, normalizeHomeFeedMutationDispatchMessage, parseHomeFeedMutationCommand } from "../src/home/home-feed-mutate-command.js";
import { formatHomeFeedCreateReply, homeFeedKstDate, validateHomeFeedContent } from "../src/home/home-feed-mutate-service.js";

describe("home feed mutate", () => {
  it("keeps create delete and clear boundaries separate", () => {
    assert.equal(isHomeFeedMutationCommandCandidate("/피드"), true);
    assert.equal(isHomeFeedMutationCommandCandidate("/피드 a\nb"), true);
    assert.equal(isHomeFeedMutationCommandCandidate("/피드내용"), false);
    assert.equal(isHomeFeedMutationCommandCandidate("/피드삭제 01"), true);
    assert.equal(isHomeFeedMutationCommandCandidate("/피드삭제 "), false);
    assert.equal(isHomeFeedMutationCommandCandidate("/피드전체삭제"), true);
    assert.equal(normalizeHomeFeedMutationDispatchMessage("/피드삭제 1"), "/피드삭제");
    assert.deepEqual(parseHomeFeedMutationCommand("/피드   a   b  "), { kind: "create", commandCode: "HOME_FEED_CREATE", content: "a   b" });
  });

  it("uses UTF-16 length KST date and stable replies", () => {
    assert.equal(homeFeedKstDate(new Date("2026-08-28T15:00:00Z")), "2026-08-29");
    assert.doesNotThrow(() => validateHomeFeedContent("a".repeat(100)));
    assert.throws(() => validateHomeFeedContent("😀".repeat(51)), /현재 102자/);
    assert.match(formatHomeFeedCreateReply(0, 1), /전달된 알림이 없습니다/);
    assert.match(formatHomeFeedCreateReply(2, 10), /2명/);
  });
});
