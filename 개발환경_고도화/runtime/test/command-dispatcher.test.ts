import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CommandDispatcher,
  MariaCommandRouteReader,
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
  async findByCode(commandCode:string):Promise<CommandDefinition|undefined>{
    return [...this.definitions.values()].find(definition=>definition.commandCode===commandCode);
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
  it("resolves dynamic-argument commands by their fixed registry code",async()=>{
    const repository=new MemoryRepository(new Map([["/동적",{...profile,commandCode:"ADMIN_DYNAMIC",rolloutState:"SHADOW"}]]));
    const decision=await createDispatcher(repository,false).resolveByCodeReadOnly({message:"/동적 인수",userId:"operator",hasTrustedDisplayName:true},"ADMIN_DYNAMIC");
    assert.deepEqual([decision.route,decision.commandCode],["SHADOW","ADMIN_DYNAMIC"]);assert.deepEqual(repository.recorded,[]);
  });
  it("supports a query-only Maria route reader and rejects an explicit record attempt", async () => {
    const queries: string[] = [];
    const reader = new MariaCommandRouteReader({
      query: async <T>(sql: string) => {
        queries.push(sql);
        return [{ command_code: profile.commandCode, handler_key: profile.handlerKey, auth_scope: profile.authScope, rollout_state: "ACTIVE" }] as T;
      }
    });
    const dispatcher = new CommandDispatcher(reader, {
      enabled: true, allowAllCanaries: false, canaryUserIds: new Set()
    });
    const input = { eventId: "query-only", message: "/내정보", userId: "user-1", hasTrustedDisplayName: false };
    const decision = await dispatcher.resolveReadOnly(input);
    assert.equal(decision.route, "MODERN");
    assert.equal(queries.length, 1);
    await assert.rejects(() => dispatcher.recordDecision(input, decision), /COMMAND_DISPATCH_WRITER_REQUIRED/);
  });

  it("resolves a route without writing before the AppWiring claim", async () => {
    const repository = new MemoryRepository(new Map([["/내정보", profile]]));
    const dispatcher = createDispatcher(repository);
    const input = {
      eventId: "event-read-only", message: "/내정보", userId: "user-1", hasTrustedDisplayName: false
    };

    const decision = await dispatcher.resolveReadOnly(input);
    assert.equal(decision.route, "MODERN");
    assert.deepEqual(repository.recorded, []);

    await dispatcher.recordDecision(input, decision);
    assert.deepEqual(repository.recorded, [decision]);
  });

  it("routes an exact canary command to the modern handler", async () => {
    const repository = new MemoryRepository(new Map([["/내정보", profile]]));
    const decision = await createDispatcher(repository).resolve({
      eventId: "event-1", message: "/내정보", userId: "user-1", hasTrustedDisplayName: false
    });
    assert.equal(decision.route, "MODERN");
    assert.equal(decision.handlerKey, "USER_PROFILE");
    assert.deepEqual(repository.recorded, [decision]);
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
