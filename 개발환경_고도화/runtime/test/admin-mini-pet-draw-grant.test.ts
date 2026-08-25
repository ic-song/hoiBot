import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AdminDrawGrantService, isAdminDrawGrantCommand,
  type AdminDrawGrantCommand, type AdminDrawGrantRepository, type AdminDrawGrantResult
} from "../src/mini-pet/admin-draw-grant-service.js";

class FakeRepository implements AdminDrawGrantRepository {
  calls: AdminDrawGrantCommand[] = [];
  async grant(command: AdminDrawGrantCommand): Promise<AdminDrawGrantResult> {
    this.calls.push(command);
    return { status: "granted", data: "지급 완료", quantityDelta: "1000",
      recipients: [{ playerId: "1", displayName: "관리자", quantity: "1010" }], outboxId: "1", auditId: "2" };
  }
}

describe("admin mini-pet draw grant", () => {
  it("accepts only the exact command", () => {
    assert.equal(isAdminDrawGrantCommand("/부방상여"), true);
    assert.equal(isAdminDrawGrantCommand("/부방상여 1"), false);
    assert.equal(isAdminDrawGrantCommand("/부방상여 안내"), false);
  });

  it("keeps a non-legacy actor silent without repository access", async () => {
    const repository = new FakeRepository();
    const service = new AdminDrawGrantService(repository);
    const result = await service.handle({ externalUserId: "other", actorDisplayName: "다른 사용자", channelId: "room", message: "/부방상여", eventId: "event-1" });
    assert.equal(result.status, "ignored_forbidden");
    assert.equal(repository.calls.length, 0);
  });

  it("delegates the fixed legacy actor and exact command", async () => {
    const repository = new FakeRepository();
    const service = new AdminDrawGrantService(repository);
    const result = await service.handle({ externalUserId: "actor", actorDisplayName: "호이 남", channelId: "room", message: "/부방상여", eventId: "event-2" });
    assert.equal(result.status, "granted");
    assert.equal(result.quantityDelta, "1000");
    assert.equal(repository.calls.length, 1);
  });
});
