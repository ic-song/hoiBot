import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { dispatchAccountSwitchCommand } from "../src/app.js";
import type { AccountPlatformKakaoEventContext } from "../src/account-platform/account-platform-iris-context-provider.js";
import type { NormalizedIrisEvent } from "../src/integration/iris-normalizer.js";
import type { PendingReply } from "../src/integration/event-processing-service.js";
import { ApplicationError } from "../src/shared/application-error.js";

function event(message: string): NormalizedIrisEvent {
  return {
    eventId: "iris:switch-1",
    providerEventId: "switch-1",
    providerCode: "iris",
    eventKind: "1",
    direction: "incoming",
    channelId: "room-a",
    userId: "user-a",
    displayName: "호이",
    displayNameSource: "kakao_db",
    displayNameTrust: "trusted",
    message,
    eventCode: "message.created",
    eventCategory: "message",
    monitoringGroup: "text",
    eventMetadata: {},
    payloadHash: "a".repeat(64),
  };
}

function prepared(message: string): AccountPlatformKakaoEventContext {
  return {
    eventId: "iris:switch-1",
    externalUserId: "user-a",
    channelId: "room-a",
    message,
    actor: {
      source: "ACCOUNT_PLATFORM_CONTEXT",
      portalAccountId: "portal01",
      playerId: "101",
      platformContextMembershipId: "member01",
      selectionVersion: 4,
    },
  };
}

function replyQueue(calls: Array<{ commandCode: string; data: string }>) {
  return {
    queueCommandReply: async (input: NormalizedIrisEvent, commandCode: string, data: string): Promise<PendingReply> => {
      calls.push({ commandCode, data });
      return { outboxId: "outbox-1", room: input.channelId!, data };
    },
  };
}

describe("account platform app ingress", () => {
  it("prepares one room snapshot and queues the successful /계정변경 reply", async () => {
    const calls: string[] = [];
    const context = prepared("/계정변경 202");
    const provider = {
      prepareKakao: async () => { calls.push("prepare"); return context; },
      dispatchAccountSwitch: async (value: AccountPlatformKakaoEventContext) => {
        calls.push(`switch:${value.actor?.playerId}`);
        return { status: "changed" as const, data: "✅ 변경했어요.", playerId: "202", selectionVersion: 5, replayed: false };
      },
    };
    const queueCalls: Array<{ commandCode: string; data: string }> = [];
    const replies: PendingReply[] = [];

    const result = await dispatchAccountSwitchCommand(provider, replyQueue(queueCalls), true, false, event(context.message), replies);

    assert.equal(result, context);
    assert.deepEqual(calls, ["prepare", "switch:101"]);
    assert.deepEqual(queueCalls, [{ commandCode: "ACCOUNT_PLATFORM_SWITCH", data: "✅ 변경했어요." }]);
    assert.deepEqual(replies, [{ outboxId: "outbox-1", room: "room-a", data: "✅ 변경했어요." }]);
  });

  it("queues expected authentication and selection errors without running another command path", async () => {
    const context = prepared("/계정변경 202");
    const provider = {
      prepareKakao: async () => context,
      dispatchAccountSwitch: async () => {
        throw new ApplicationError("PLATFORM_CONTEXT_AUTH_REQUIRED", "이 방에서 먼저 계정 인증을 완료해 주세요.", 409);
      },
    };
    const queueCalls: Array<{ commandCode: string; data: string }> = [];
    const replies: PendingReply[] = [];

    await dispatchAccountSwitchCommand(provider, replyQueue(queueCalls), true, false, event(context.message), replies);

    assert.deepEqual(queueCalls, [{
      commandCode: "account_platform_switch_error",
      data: "이 방에서 먼저 계정 인증을 완료해 주세요.",
    }]);
    assert.equal(replies.length, 1);
  });

  it("does not prepare a snapshot outside the exact operational non-duplicate command boundary", async () => {
    let calls = 0;
    const provider = {
      prepareKakao: async () => { calls += 1; return prepared("/계정변경 202"); },
      dispatchAccountSwitch: async () => { calls += 1; return null; },
    };
    const queue = replyQueue([]);

    for (const input of [
      { operational: false, duplicate: false, message: "/계정변경 202" },
      { operational: true, duplicate: true, message: "/계정변경 202" },
      { operational: true, duplicate: false, message: "/계정변경" },
      { operational: true, duplicate: false, message: "/계정변경\n202" },
      { operational: true, duplicate: false, message: " /계정변경 202" },
    ]) {
      assert.equal(await dispatchAccountSwitchCommand(provider, queue, input.operational, input.duplicate, event(input.message), []), null);
    }
    assert.equal(calls, 0);
  });

  it("wires the provider once after Iris deduplication and uses the normalized command event", () => {
    const source = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
    assert.equal(source.match(/await dispatchAccountSwitchCommand\(/g)?.length, 1);
    assert.match(source, /new AccountPlatformIrisContextProvider\(database\)/);
    assert.match(source, /await dispatchAccountSwitchCommand\([\s\S]*?commandEvent,[\s\S]*?processing\?\.replies/);
  });
});
