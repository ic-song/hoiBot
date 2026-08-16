import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApplicationError } from "../src/shared/application-error.js";
import { buildGuildJoinConditionChangedMessage, parseGuildJoinConditionCommand } from "../src/guild/guild-join-condition-policy.js";
import type { GuildJoinConditionRepository, GuildJoinConditionTransaction } from "../src/guild/guild-join-condition-repository.js";
import { GuildJoinConditionService } from "../src/guild/guild-join-condition-service.js";

// 서비스 호출 순서와 저장 값을 기록하는 메모리 저장소를 만듭니다.
function createRepository(options: { actor?: { playerId: string; guildId: string; canManageJoinCondition: boolean } | null; prior?: { status: "completed"; data: string; guildId: string } | null } = {}) {
  const calls: string[] = [];
  let savedExperience: bigint | null = null;
  const transaction: GuildJoinConditionTransaction = {
    async lockActor() { calls.push("lockActor"); return options.actor === undefined ? { playerId: "1", guildId: "91", canManageJoinCondition: true } : options.actor; },
    async readPriorResult() { calls.push("readPriorResult"); return options.prior ?? null; },
    async startCommand() { calls.push("startCommand"); return "701"; },
    async updateJoinRequirement(_guildId, experience) { calls.push("updateJoinRequirement"); savedExperience = experience; return 1000n; },
    async completeCommand(_operationId, record) { calls.push("completeCommand"); return { status: "completed", data: record.data, guildId: record.guildId, auditId: "801", outboxId: "901" }; }
  };
  const repository: GuildJoinConditionRepository = {
    async runInTransaction(work) { calls.push("transaction"); return work(transaction); }
  };
  return { service: new GuildJoinConditionService(repository), calls, getSavedExperience: () => savedExperience };
}

describe("guild join condition policy", () => {
  it("accepts zero, plain integer and standard comma notation", () => {
    assert.deepEqual(parseGuildJoinConditionCommand("/길드가입조건"), { kind: "usage" });
    assert.deepEqual(parseGuildJoinConditionCommand("/길드가입조건 0"), { kind: "change", experience: 0n });
    assert.deepEqual(parseGuildJoinConditionCommand("/길드가입조건 100,000"), { kind: "change", experience: 100000n });
  });

  it("rejects suffix text, negative values and malformed commas", () => {
    assert.equal(parseGuildJoinConditionCommand("/길드가입조건 100 해봐").kind, "invalid");
    assert.equal(parseGuildJoinConditionCommand("/길드가입조건 -1").kind, "invalid");
    assert.equal(parseGuildJoinConditionCommand("/길드가입조건 1,00").kind, "invalid");
    assert.equal(parseGuildJoinConditionCommand("/길드가입조건설정 1").kind, "ignored");
  });

  it("keeps the legacy success reply", () => {
    assert.equal(buildGuildJoinConditionChangedMessage(0n), "✅ 길드 가입조건이 변경되었습니다.\n가입조건: 제한없음");
    assert.equal(buildGuildJoinConditionChangedMessage(123456n), "✅ 길드 가입조건이 변경되었습니다.\n가입조건: 123,456 EXP 이상");
  });
});

describe("guild join condition service", () => {
  const command = { externalUserId: "kakao-user", channelId: "room", message: "/길드가입조건 123,456", eventId: "event-1" };

  it("updates the requirement and writes completion in one transaction", async () => {
    const memory = createRepository();
    const result = await memory.service.handle(command);
    assert.equal(result.status, "completed");
    assert.equal(memory.getSavedExperience(), 123456n);
    assert.deepEqual(memory.calls, ["transaction", "lockActor", "readPriorResult", "startCommand", "updateJoinRequirement", "completeCommand"]);
  });

  it("returns the prior result without duplicate mutation", async () => {
    const prior = { status: "completed" as const, data: "prior", guildId: "91" };
    const memory = createRepository({ prior });
    assert.deepEqual(await memory.service.handle(command), prior);
    assert.equal(memory.getSavedExperience(), null);
  });

  it("keeps membership and leader permission failures", async () => {
    const missing = createRepository({ actor: null });
    await assert.rejects(() => missing.service.handle(command), (error: unknown) => error instanceof ApplicationError && error.code === "GUILD_MEMBERSHIP_REQUIRED");
    const member = createRepository({ actor: { playerId: "1", guildId: "91", canManageJoinCondition: false } });
    await assert.rejects(() => member.service.handle(command), (error: unknown) => error instanceof ApplicationError && error.code === "GUILD_JOIN_CONDITION_PERMISSION_REQUIRED");
  });

  it("does not open a transaction for invalid input", async () => {
    const memory = createRepository();
    const result = await memory.service.handle({ ...command, message: "/길드가입조건 100 해봐" });
    assert.equal(result.data, "❌ 가입조건 숫자가 올바르지 않습니다.");
    assert.deepEqual(memory.calls, []);
  });
});
