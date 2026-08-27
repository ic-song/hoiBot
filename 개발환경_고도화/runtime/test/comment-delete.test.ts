import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isCommentDeleteCommandCandidate, parseCommentDeleteCommand } from "../src/home/comment-delete-command.js";
import { CommentDeleteService, type CommentDeleteRepository } from "../src/home/comment-delete-service.js";

const comment = (id: string, pinned = false) => ({
  commentId: id, authorName: "작성자", body: `${id} 본문`, createdAt: new Date(0), pinned,
});

describe("comment delete command", () => {
  it("accepts only the exact guide and full positive integer form", () => {
    for (const message of ["/댓글삭제", "/댓글삭제 1", "/댓글삭제 999"]) assert.equal(isCommentDeleteCommandCandidate(message), true);
    for (const message of ["/댓글삭제 안내", "/댓글삭제 0", "/댓글삭제 -1", "/댓글삭제 1.5", "/댓글삭제 1 안내"]) {
      assert.equal(isCommentDeleteCommandCandidate(message), false, message);
    }
  });

  it("returns the legacy guide without repository access", async () => {
    const result = await new CommentDeleteService({} as CommentDeleteRepository).execute({
      command: { kind: "GUIDE" }, requestKey: "guide", playerId: "1",
    });
    assert.equal(result.message, "사용법: /댓글삭제 [번호]\n예시: /댓글삭제 1");
  });

  it("maps newest-first list numbers to stable comment IDs", async () => {
    let removed = "";
    const repository: CommentDeleteRepository = {
      findReplay: async () => undefined,
      readSnapshot: async () => ({ homeVersion: 3n, hasActivePass: true, comments: [comment("C3"), comment("C2"), comment("C1")] }),
      remove: async (request) => { removed = request.comment.commentId; return { replayed: false, commentId: removed, message: "ok" }; },
    };
    const command = parseCommentDeleteCommand("/댓글삭제 2");
    assert.ok(command);
    await new CommentDeleteService(repository).execute({ command, requestKey: "event", playerId: "1" });
    assert.equal(removed, "C2");
  });

  it("rejects expired pass, empty, out-of-range and pinned targets before mutation", async () => {
    const snapshots = [
      { homeVersion: 1n, hasActivePass: false, comments: [comment("C1")] },
      { homeVersion: 1n, hasActivePass: true, comments: [] },
      { homeVersion: 1n, hasActivePass: true, comments: [comment("C1")] },
      { homeVersion: 1n, hasActivePass: true, comments: [comment("C1", true)] },
    ];
    const numbers = [1, 1, 2, 1];
    for (let index = 0; index < snapshots.length; index += 1) {
      const repository: CommentDeleteRepository = {
        findReplay: async () => undefined,
        readSnapshot: async () => snapshots[index]!,
        remove: async () => { throw new Error("must not mutate"); },
      };
      await assert.rejects(() => new CommentDeleteService(repository).execute({
        command: { kind: "REMOVE", listNumber: numbers[index]! }, requestKey: `event-${index}`, playerId: "1",
      }));
    }
  });

  it("replays a completed request before reading a changed list", async () => {
    const repository: CommentDeleteRepository = {
      findReplay: async () => ({ replayed: true, commentId: "C9", message: "saved" }),
      readSnapshot: async () => { throw new Error("must not read"); },
      remove: async () => { throw new Error("must not mutate"); },
    };
    const result = await new CommentDeleteService(repository).execute({
      command: { kind: "REMOVE", listNumber: 1 }, requestKey: "event", playerId: "1",
    });
    assert.equal(result.replayed, true);
    assert.equal(result.commentId, "C9");
  });
});
