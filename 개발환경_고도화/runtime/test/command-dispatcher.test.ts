import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CommandDispatcher,
  type CommandDefinition,
  type CommandDispatchDecision,
  type CommandDispatchInput,
  type CommandDispatchRepository
} from "../src/dispatch/command-dispatcher.js";

class MemoryRepository implements CommandDispatchRepository {
  readonly recorded: CommandDispatchDecision[] = [];
  constructor(private readonly definitions: Map<string, CommandDefinition>) {}
  async findExact(message: string): Promise<CommandDefinition | undefined> {
    return this.definitions.get(message);
  }
  async record(_input: CommandDispatchInput, decision: CommandDispatchDecision): Promise<void> {
    this.recorded.push(decision);
  }
}

const profile: CommandDefinition = {
  commandCode: "USER_PROFILE_MY_INFO",
  handlerKey: "USER_PROFILE",
  authScope: "VERIFIED_USER",
  rolloutState: "CANARY"
};

function createDispatcher(repository: MemoryRepository, allowAllCanaries = true): CommandDispatcher {
  return new CommandDispatcher(repository, {
    enabled: true,
    allowAllCanaries,
    canaryUserIds: new Set(["canary-user"])
  });
}

describe("CommandDispatcher", () => {
  it("routes an exact canary command to the modern handler", async () => {
    const repository = new MemoryRepository(new Map([["/내정보", profile]]));
    const decision = await createDispatcher(repository).resolve({
      eventId: "event-1", message: "/내정보", userId: "user-1", hasTrustedDisplayName: false
    });
    assert.equal(decision.route, "MODERN");
    assert.equal(decision.handlerKey, "USER_PROFILE");
  });

  it("does not accept suffix text as the exact command", async () => {
    const repository = new MemoryRepository(new Map([["/내정보", profile]]));
    const decision = await createDispatcher(repository).resolve({
      message: "/내정보 보여줘", userId: "user-1", hasTrustedDisplayName: false
    });
    assert.equal(decision.route, "LEGACY_FALLBACK");
    assert.equal(decision.reasonCode, "COMMAND_NOT_REGISTERED");
  });

  it("falls back for a canary user outside the allowlist", async () => {
    const repository = new MemoryRepository(new Map([["/내정보", profile]]));
    const decision = await createDispatcher(repository, false).resolve({
      message: "/내정보", userId: "other-user", hasTrustedDisplayName: false
    });
    assert.equal(decision.route, "LEGACY_FALLBACK");
  });

  it("rejects a registered command without the required user identity", async () => {
    const repository = new MemoryRepository(new Map([["/내정보", profile]]));
    const decision = await createDispatcher(repository).resolve({ message: "/내정보", hasTrustedDisplayName: false });
    assert.equal(decision.route, "REJECT");
  });

  it("keeps shadow commands out of the modern mutation path", async () => {
    const repository = new MemoryRepository(new Map([["/내정보", { ...profile, rolloutState: "SHADOW" }]]));
    const decision = await createDispatcher(repository).resolve({
      message: "/내정보", userId: "user-1", hasTrustedDisplayName: false
    });
    assert.equal(decision.route, "SHADOW");
  });

  it("routes active commands without a canary allowlist", async () => {
    const repository = new MemoryRepository(new Map([["/내정보", { ...profile, rolloutState: "ACTIVE" }]]));
    const decision = await createDispatcher(repository, false).resolve({
      message: "/내정보", userId: "user-1", hasTrustedDisplayName: false
    });
    assert.equal(decision.route, "MODERN");
  });
});
