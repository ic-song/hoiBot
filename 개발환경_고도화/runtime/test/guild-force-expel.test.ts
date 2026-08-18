import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApplicationError } from "../src/shared/application-error.js";
import { parseGuildForceExpelCommand } from "../src/guild/guild-force-expel-policy.js";
import type { GuildForceExpelRepository, GuildForceExpelTransaction } from "../src/guild/guild-force-expel-repository.js";
import { GuildForceExpelService } from "../src/guild/guild-force-expel-service.js";

// 강제제명 호출 순서와 삭제 횟수를 기록하는 저장소를 만듭니다.
function memory(options: { permission?: boolean; roleCode?: string; guildId?: string | null; prior?: boolean } = {}) {
  const calls: string[] = []; let removed = 0;
  const tx: GuildForceExpelTransaction = {
    async lockActor() { calls.push("actor"); return { playerId: "1", canForceExpel: options.permission ?? true }; },
    async readPriorResult() { calls.push("prior"); return options.prior ? { status: "completed", data: "prior", guildId: "91" } : null; },
    async lockTarget(name) { calls.push("target"); return { playerId: "2", displayName: name, guildId: options.guildId === undefined ? "91" : options.guildId, guildName: "알파", guildMark: "A", roleCode: options.roleCode ?? "member" }; },
    async startCommand() { calls.push("start"); return "701"; }, async removeMembership() { calls.push("remove"); removed++; },
    async completeCommand(_id, record) { calls.push("complete"); return { status: "completed", data: record.data, guildId: record.guildId, auditId: "801", outboxId: "901" }; }
  };
  const repository: GuildForceExpelRepository = { async runInTransaction(work) { calls.push("transaction"); return work(tx); } };
  return { service: new GuildForceExpelService(repository), calls, removed: () => removed };
}

describe("guild force expel policy", () => {
  it("accepts a free-form nickname only after the exact command", () => {
    assert.deepEqual(parseGuildForceExpelCommand("/길드강제제명"), { kind: "usage" });
    assert.deepEqual(parseGuildForceExpelCommand("/길드강제제명 호이 남"), { kind: "expel", targetName: "호이 남" });
    assert.deepEqual(parseGuildForceExpelCommand("/길드강제제명테스트"), { kind: "ignored" });
  });
});

describe("guild force expel service", () => {
  const input = { externalUserId: "admin", channelId: "room", message: "/길드강제제명 대상 여", eventId: "event" };
  it("removes one ordinary membership and records the reply", async () => { const m = memory(); const result = await m.service.handle(input); assert.equal(result.status, "completed"); assert.equal(m.removed(), 1); assert.deepEqual(m.calls, ["transaction", "actor", "prior", "target", "start", "remove", "complete"]); });
  it("replays the prior result without deletion", async () => { const m = memory({ prior: true }); assert.equal((await m.service.handle(input)).data, "prior"); assert.equal(m.removed(), 0); });
  it("blocks ordinary operators and guild leaders", async () => { const denied = memory({ permission: false }); await assert.rejects(() => denied.service.handle(input), (error: unknown) => error instanceof ApplicationError && error.code === "MASTER_PERMISSION_REQUIRED"); const leader = memory({ roleCode: "leader" }); await assert.rejects(() => leader.service.handle(input), (error: unknown) => error instanceof ApplicationError && error.code === "GUILD_MASTER_EXPEL_FORBIDDEN"); });
  it("reports a target without membership", async () => { const m = memory({ guildId: null }); await assert.rejects(() => m.service.handle(input), (error: unknown) => error instanceof ApplicationError && error.code === "TARGET_GUILD_MEMBERSHIP_REQUIRED"); });
});
