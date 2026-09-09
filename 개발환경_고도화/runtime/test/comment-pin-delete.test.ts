import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isCommentPinDeleteCommandCandidate, parseCommentPinDeleteCommand } from "../src/home/comment-pin-delete-command.js";
import { CommentPinDeleteService, type CommentPinDeleteRepository } from "../src/home/comment-pin-delete-service.js";

describe("comment pin delete command", () => {
  it("accepts only the exact guide and full positive integer form", () => {
    for (const message of ["/댓글핀삭제", "/댓글핀삭제 1", "/댓글핀삭제 999"]) assert.equal(isCommentPinDeleteCommandCandidate(message), true);
    for (const message of ["/댓글핀삭제 안내", "/댓글핀삭제 0", "/댓글핀삭제 -1", "/댓글핀삭제 1.5", "/댓글핀삭제 1 안내"]) {
      assert.equal(isCommentPinDeleteCommandCandidate(message), false, message);
    }
  });

  it("returns a guide without repository access", async () => {
    const repository = {} as CommentPinDeleteRepository;
    const result = await new CommentPinDeleteService(repository).execute({
      command: { kind: "GUIDE" }, requestKey: "guide", playerId: "1",
    });
    assert.match(result.message, /\/댓글핀삭제 \[번호\]/);
  });

  it("resolves the mutable number to a stable pin ID", async () => {
    let removedPinId = "";
    const repository: CommentPinDeleteRepository = {
      findReplay: async () => undefined,
      readSnapshot: async () => ({ homeVersion: 3n, hasPet: true, hasActivePass: true, pins: [
        { pinId: "PIN-1", displayOrder: 1, authorName: "작성자", body: "첫 핀", createdAt: new Date(0) },
        { pinId: "PIN-2", displayOrder: 2, authorName: "작성자", body: "둘째 핀", createdAt: new Date(0) },
      ] }),
      remove: async (request) => {
        removedPinId = request.pinId;
        return { replayed: false, pinId: request.pinId, message: "ok" };
      },
    };
    const command = parseCommentPinDeleteCommand("/댓글핀삭제 2");
    assert.ok(command);
    await new CommentPinDeleteService(repository).execute({ command, requestKey: "event", playerId: "1" });
    assert.equal(removedPinId, "PIN-2");
  });

  it("rejects missing pass, pet and out-of-range before mutation", async () => {
    const snapshots = [
      { homeVersion: 1n, hasPet: true, hasActivePass: false, pins: [] },
      { homeVersion: 1n, hasPet: false, hasActivePass: true, pins: [] },
      { homeVersion: 1n, hasPet: true, hasActivePass: true, pins: [] },
    ];
    for (const snapshot of snapshots) {
      const repository: CommentPinDeleteRepository = {
        findReplay: async () => undefined, readSnapshot: async () => snapshot,
        remove: async () => { throw new Error("must not mutate"); },
      };
      await assert.rejects(() => new CommentPinDeleteService(repository).execute({
        command: { kind: "REMOVE", listNumber: 1 }, requestKey: "event", playerId: "1",
      }));
    }
  });
});
