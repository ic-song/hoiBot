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
    displayNameSource: "iris_cache",
    displayNameTrust: "untrusted",
    message: "/info",
    eventCode: "message.created.text",
    eventCategory: "message",
    monitoringGroup: "text",
    eventMetadata: {},
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
      if (sql.includes("db2.open_link")) return [{ id: "789", name: "실제 오픈채팅방" }];
      if (sql.includes("db2.friends")) return [{ id: "456", name: "친구 이름" }];
      return [];
    });

    const result = await inspector.inspect(createEvent());

    assert.equal(calls.length, 6);
    assert.equal(calls.slice(1).every((call) => call.sql.includes("?") && call.bind.length > 0), true);
    assert.equal(result.nickname, "DB 이름");
    assert.equal(result.nicknameSource, "open_chat_member");
    assert.equal(result.roomName, "실제 오픈채팅방");
    assert.equal(result.roomNameSource, "open_link");
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

  it("queries the correlated target row with string-safe room and message ids", async () => {
    const calls: Array<{ sql: string; bind: readonly string[] }> = [];
    const inspector = new IrisKakaoDatabaseInspector("http://iris.test", async (sql, bind) => {
      calls.push({ sql, bind });
      if (sql.includes("sqlite_master")) return [{ name: "open_chat_member" }];
      if (sql.includes("FROM db1.chat_logs")) {
        return [{ id: "3901202722747983874", message: "가리기 전 원본" }];
      }
      return [];
    });

    const result = await inspector.inspect(createEvent({
      channelId: "18490428324717856",
      targetProviderEventId: "3901202722747983874",
      eventCode: "message.hidden_by_host",
      eventCategory: "moderation"
    }));
    const targetCall = calls.find((call) => call.sql.includes("FROM db1.chat_logs"));

    assert.deepEqual(targetCall?.bind, ["18490428324717856", "3901202722747983874"]);
    assert.match(targetCall?.sql ?? "", /WHERE chat_id = \? AND id = \?/);
    assert.equal(result.targetChatLog.rows[0]?.message, "가리기 전 원본");
  });

  it("follows a host-blind feedType 13 row to the actual message through prev_id", async () => {
    const calls: Array<{ sql: string; bind: readonly string[] }> = [];
    const inspector = new IrisKakaoDatabaseInspector("http://iris.test", async (sql, bind) => {
      calls.push({ sql, bind });
      if (sql.includes("sqlite_master")) return [{ name: "open_chat_member" }];
      if (sql.includes("FROM db1.chat_logs") && bind[1] === "feed-row-1") {
        return [{
          id: "feed-row-1",
          type: "0",
          message: "{\"feedType\":13}",
          v: "{\"origin\":\"WRITE\"}",
          prev_id: "actual-message-1"
        }];
      }
      if (sql.includes("FROM db1.chat_logs") && bind[1] === "actual-message-1") {
        return [{ id: "actual-message-1", type: "1", message: "실제 가려진 본문" }];
      }
      return [];
    });

    const result = await inspector.inspect(createEvent({
      channelId: "monitor-room",
      targetProviderEventId: "feed-row-1",
      eventCode: "message.hidden_by_host",
      eventCategory: "moderation"
    }));

    assert.equal(result.targetChatLog.rows[0]?.message, "실제 가려진 본문");
    assert.equal(calls.some((call) => call.bind[1] === "actual-message-1"), true);
  });

  it("rebuilds an in-place rewritten host-blind row from previous_message", async () => {
    const calls: Array<{ sql: string; bind: readonly string[] }> = [];
    const inspector = new IrisKakaoDatabaseInspector("http://iris.test", async (sql, bind) => {
      calls.push({ sql, bind });
      if (sql.includes("sqlite_master")) return [{ name: "open_chat_member" }];
      if (sql.includes("FROM db1.chat_logs") && bind.length === 2) {
        return [{
          id: "rewritten-row-1",
          type: "0",
          message: "{\"feedType\":13}",
          v: "{\"origin\":\"MSG\",\"enc\":31,\"previous_message\":\"ciphertext\",\"previous_enc\":31}",
          prev_id: "unrelated-previous-row"
        }];
      }
      if (sql.includes("? AS type") && bind[1] === "ciphertext") {
        return [{ id: "rewritten-row-1", type: "1", message: "복호화된 사용자 원문" }];
      }
      return [];
    });

    const result = await inspector.inspect(createEvent({
      channelId: "monitor-room",
      targetProviderEventId: "rewritten-row-1",
      eventCode: "message.hidden_by_host",
      eventCategory: "moderation",
      eventMetadata: { targetType: 1 }
    }));
    const decryptCall = calls.find((call) => call.sql.includes("? AS type"));

    assert.deepEqual(decryptCall?.bind.slice(0, 2), ["1", "ciphertext"]);
    assert.equal(result.targetChatLog.rows[0]?.message, "복호화된 사용자 원문");
  });

  it("rebuilds the immediately previous body for an edited message from modifyLog", async () => {
    const calls: Array<{ sql: string; bind: readonly string[] }> = [];
    const inspector = new IrisKakaoDatabaseInspector("http://iris.test", async (sql, bind) => {
      calls.push({ sql, bind });
      if (sql.includes("sqlite_master")) return [{ name: "open_chat_member" }];
      if (sql.includes("FROM db1.chat_logs") && bind.length === 2) {
        return [{ id: "edited-row-1", user_id: "author-1", type: "1", message: "수정 후", v: "{\"origin\":\"MSG\",\"modifyRevision\":1,\"modifyLog\":\"[{\\\"message\\\":\\\"previous-ciphertext\\\",\\\"revision\\\":0,\\\"enc\\\":31}]\"}" }];
      }
      if (sql.includes("? AS message") && bind[0] === "previous-ciphertext") {
        return [{ id: "edited-row-1", type: "1", message: "수정 전" }];
      }
      return [];
    });

    const result = await inspector.inspect(createEvent({
      channelId: "monitor-room", targetProviderEventId: "edited-row-1", eventCode: "message.edited", eventCategory: "moderation"
    }));

    assert.equal(result.targetChatLog.rows[0]?.message, "수정 후");
    assert.equal(result.previousTargetChatLog?.rows[0]?.message, "수정 전");
    assert.equal(calls.some((call) => call.sql.includes("? AS message") && call.bind[0] === "previous-ciphertext"), true);
  });

  it("resolves the actual target author instead of the system-event user", async () => {
    const calls: Array<{ sql: string; bind: readonly string[] }> = [];
    const inspector = new IrisKakaoDatabaseInspector("http://iris.test", async (sql, bind) => {
      calls.push({ sql, bind });
      if (sql.includes("sqlite_master")) return [{ name: "open_chat_member" }];
      if (sql.includes("FROM db1.chat_logs")) {
        return [{ id: "target-1", user_id: "actual-author", message: "삭제 전 원문" }];
      }
      if (sql.includes("open_chat_member") && bind[1] === "actual-author") {
        return [{ user_id: "actual-author", nickname: "실제 작성자" }];
      }
      if (sql.includes("open_chat_member")) {
        return [{ user_id: "system-user", nickname: "시스템 이벤트 사용자" }];
      }
      return [];
    });

    const result = await inspector.inspect(createEvent({
      userId: "system-user",
      targetProviderEventId: "target-1",
      eventCode: "message.deleted",
      eventCategory: "moderation"
    }));

    assert.equal(result.subjectUserId, "actual-author");
    assert.equal(result.nickname, "실제 작성자");
    assert.equal(calls.some((call) => call.bind[1] === "actual-author"), true);
  });
});
