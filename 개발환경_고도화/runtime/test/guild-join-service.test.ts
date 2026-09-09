import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GuildJoinService } from "../src/guild/guild-join-service.js";
import type {
  GuildJoinPlayer,
  GuildJoinRepository,
  GuildJoinResult,
  GuildJoinTransaction,
  PendingGuildJoin
} from "../src/guild/guild-join-repository.js";
import type { GuildJoinCandidate } from "../src/guild/guild-join-policy.js";
import { ApplicationError } from "../src/shared/application-error.js";

const player: GuildJoinPlayer = {
  playerId: "21",
  rankLabel: "🌱합성회원 남",
  experience: 5000n,
  currentGuildId: null,
  joinTicketQuantity: 1n
};

const guild: GuildJoinCandidate = {
  guildId: "91",
  displayName: "알파길드",
  mark: "A",
  serverCode: "alpha",
  level: 8,
  joinRequirementExperience: 1000n,
  memberCount: 4,
  maxMembers: 5,
  recruitmentBonus: 0,
  memberJoinClosed: false
};

// 길드가입 서비스 호출 순서와 결과를 기록하는 메모리 저장소를 만듭니다.
function createRepository(options: {
  player?: GuildJoinPlayer | null;
  guilds?: GuildJoinCandidate[];
  pending?: PendingGuildJoin | null;
  priorResult?: GuildJoinResult | null;
} = {}) {
  const calls: string[] = [];
  const transaction: GuildJoinTransaction = {
    lockPlayer: async () => { calls.push("lockPlayer"); return options.player === undefined ? player : options.player; },
    readPriorResult: async (_eventId, code) => { calls.push(`prior:${code}`); return options.priorResult ?? null; },
    startCommand: async (_eventId, code) => { calls.push(`start:${code}`); return "501"; },
    listJoinableGuilds: async () => { calls.push("listGuilds"); return options.guilds ?? [guild]; },
    lockGuild: async () => { calls.push("lockGuild"); return options.guilds?.[0] ?? guild; },
    lockPendingJoin: async () => { calls.push("lockPending"); return options.pending === undefined ? { guildId: guild.guildId, guildNo: 1 } : options.pending; },
    savePendingJoin: async () => { calls.push("savePending"); },
    clearPendingJoin: async (_playerId, status) => { calls.push(`clear:${status}`); },
    addMembershipAndSpendTicket: async () => { calls.push("commitMembershipAndTicket"); },
    completeCommand: async (_operationId, record, result) => {
      calls.push(`complete:${record.commandCode}`);
      return { ...result, auditId: "601", outboxId: "701" };
    }
  };
  const repository: GuildJoinRepository = {
    runInTransaction: async <T>(work: (value: GuildJoinTransaction) => Promise<T>) => work(transaction)
  };
  return { repository, calls };
}

const command = { externalUserId: "kakao-21", channelId: "room-1", message: "/길드가입 1", eventId: "event-1" };

describe("guild join service request", () => {
  it("persists the selected guild and confirmation reply", async () => {
    const scripted = createRepository();
    const result = await new GuildJoinService(scripted.repository).handle(command);
    assert.equal(result.status, "pending");
    assert.equal(result.guildId, "91");
    assert.match(result.data ?? "", /알파길드\(A\) 길드에 가입하실껀가요/);
    assert.deepEqual(scripted.calls, ["lockPlayer", "prior:guild_join_request", "start:guild_join_request", "listGuilds", "lockGuild", "savePending", "complete:guild_join_request"]);
  });

  it("does not enter a transaction for suffix text", async () => {
    const scripted = createRepository();
    const result = await new GuildJoinService(scripted.repository).handle({ ...command, message: "/길드가입 1 안내" });
    assert.deepEqual(result, { status: "ignored" });
    assert.deepEqual(scripted.calls, []);
  });

  it("rejects a player without a join ticket before staging", async () => {
    const scripted = createRepository({ player: { ...player, joinTicketQuantity: 0n } });
    await assert.rejects(
      () => new GuildJoinService(scripted.repository).handle(command),
      (error: unknown) => error instanceof ApplicationError && error.code === "GUILD_JOIN_TICKET_REQUIRED"
    );
    assert.deepEqual(scripted.calls, ["lockPlayer", "prior:guild_join_request"]);
  });
});

describe("guild join service confirmation", () => {
  it("rechecks and commits membership, ticket, pending state and reply in order", async () => {
    const scripted = createRepository();
    const result = await new GuildJoinService(scripted.repository).handle({ ...command, message: "가입한다", eventId: "event-2" });
    assert.equal(result.status, "completed");
    assert.equal(result.data, "✅ 길드 가입 완료!\n길드: 알파길드(A)[alpha]");
    assert.deepEqual(scripted.calls, ["lockPlayer", "prior:guild_join_confirm", "lockPending", "start:guild_join_confirm", "lockGuild", "commitMembershipAndTicket", "clear:completed", "complete:guild_join_confirm"]);
  });

  it("does not spend a ticket when the guild became full", async () => {
    const scripted = createRepository({ guilds: [{ ...guild, memberCount: 5 }] });
    const result = await new GuildJoinService(scripted.repository).handle({ ...command, message: "/가입한다", eventId: "event-full" });
    assert.deepEqual({ status: result.status, data: result.data }, { status: "failed", data: "❌ 길드 정원이 가득 찼습니다." });
    assert.equal(scripted.calls.includes("commitMembershipAndTicket"), false);
    assert.equal(scripted.calls.includes("clear:invalidated"), true);
  });

  it("returns the prior result without duplicate mutation", async () => {
    const prior: GuildJoinResult = { status: "completed", data: "prior", guildId: "91", auditId: "1", outboxId: "2" };
    const scripted = createRepository({ priorResult: prior, player: { ...player, currentGuildId: "91", joinTicketQuantity: 0n }, pending: null });
    const result = await new GuildJoinService(scripted.repository).handle({ ...command, message: "/가입한다", eventId: "event-replay" });
    assert.deepEqual(result, prior);
    assert.equal(scripted.calls.includes("commitMembershipAndTicket"), false);
  });
});

describe("guild join service cancellation", () => {
  it("clears only the pending request and queues the legacy reply", async () => {
    const scripted = createRepository();
    const result = await new GuildJoinService(scripted.repository).handle({ ...command, message: "/안한다", eventId: "event-3" });
    assert.deepEqual({ status: result.status, data: result.data }, { status: "cancelled", data: "❎ 길드가입이 취소되었습니다." });
    assert.deepEqual(scripted.calls, ["lockPlayer", "prior:guild_join_cancel", "lockPending", "start:guild_join_cancel", "clear:cancelled", "complete:guild_join_cancel"]);
  });
});
