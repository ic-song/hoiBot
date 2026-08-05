import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IrisKakaoDatabaseInspector } from "../src/integration/iris-kakao-database-inspector.js";
import type { NormalizedIrisEvent } from "../src/integration/iris-normalizer.js";

function createEvent(overrides: Partial<NormalizedIrisEvent> = {}): NormalizedIrisEvent {
  return {
    eventId: "iris:9001",
    providerEventId: "9001",
    providerCode: "iris",
    eventKind: "1",
    origin: "MSG",
    direction: "incoming",
    channelId: "123",
    userId: "456",
    displayName: "Iris 이름",
    message: "/info",
    payloadHash: "hash",
    ...overrides
  };
}

describe("Iris KakaoTalk database inspector", () => {
  it("queries all related tables and prioritizes the room-scoped open-chat nickname", async () => {
    const calls: Array<{ sql: string; bind: readonly string[] }> = [];
    const inspector = new IrisKakaoDatabaseInspector("http://iris.test", async (sql, bind) => {
      calls.push({ sql, bind });
      if (sql.includes("sqlite_master")) {
        return [{ name: "friends" }, { name: "open_chat_member" }];
      }
      if (sql.includes("open_chat_member")) {
        return [{ user_id: "456", link_id: "789", nickname: "DB 이름" }];
      }
      if (sql.includes("db2.friends")) return [{ id: "456", name: "친구 이름" }];
      return [];
    });

    const result = await inspector.inspect(createEvent());

    assert.equal(calls.length, 6);
    assert.equal(calls.slice(1).every((call) => call.sql.includes("?") && call.bind.length > 0), true);
    assert.equal(result.nickname, "DB 이름");
    assert.equal(result.nicknameSource, "open_chat_member");
  });

  it("keeps per-table errors visible and falls back to the Iris sender", async () => {
    const inspector = new IrisKakaoDatabaseInspector("http://iris.test", async () => {
      throw new Error("query unavailable");
    });

    const result = await inspector.inspect(createEvent());

    assert.equal(result.nickname, "Iris 이름");
    assert.equal(result.nicknameSource, "iris_sender");
    assert.equal(result.chatLog.error, "query unavailable");
    assert.equal(result.openChatMember.error, "query unavailable");
  });
});
