import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import type { DatabaseClient } from "../src/database.js";
import type { IrisKakaoDatabaseSnapshot } from "../src/integration/iris-kakao-database-inspector.js";

const TEST_TOKEN = "test-shared-token-1234";

function createConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: "test",
    host: "127.0.0.1",
    port: 3000,
    irisSharedToken: TEST_TOKEN,
    userVerificationPepper: "test-user-verification-pepper-123456",
    irisBaseUrl: "http://127.0.0.1:3000",
    irisImageForwardRoomId: "",
    irisEventMonitorRoomId: "",
    imageMaxBytes: 10_485_760,
    imageDownloadTimeoutMs: 10_000,
    bodyLimitBytes: 1_048_576,
    rawPayloadLogging: true,
    recentEventsEnabled: true,
    recentEventLimit: 2,
    database: {
      enabled: false,
      host: "",
      port: 3306,
      user: "",
      password: "",
      name: "",
      connectionLimit: 2,
      connectTimeoutMs: 1_000
    },
    version: "0.1.0-test",
    ...overrides
  };
}

function createDatabaseStub(overrides: Partial<DatabaseClient> = {}): DatabaseClient {
  return {
    ping: async () => undefined,
    verifyRollback: async () => true,
    query: async () => { throw new Error("Unexpected query in test stub."); },
    execute: async () => { throw new Error("Unexpected execute in test stub."); },
    withTransaction: async () => { throw new Error("Unexpected transaction in test stub."); },
    close: async () => undefined,
    ...overrides
  };
}

function createKakaoSnapshot(overrides: Partial<IrisKakaoDatabaseSnapshot> = {}): IrisKakaoDatabaseSnapshot {
  return {
    nickname: "테스 남",
    nicknameSource: "open_chat_member",
    db2IdentityTables: { rows: [{ name: "open_chat_member" }] },
    chatLog: { rows: [{ id: "9001", chat_id: "123", user_id: "456", type: "1" }] },
    chatRoom: { rows: [{ id: "123", link_id: "789", type: "OM" }] },
    openChatMember: { rows: [{ user_id: "456", link_id: "789", nickname: "테스 남", enc: "0" }] },
    friend: { rows: [] },
    openLink: { rows: [{ id: "789", name: "테스트 오픈채팅" }] },
    ...overrides
  };
}

describe("hoiBot Lite server", () => {
  it("returns health and request id", async () => {
    const app = buildApp(createConfig());
    const response = await app.inject({ method: "GET", url: "/health/live" });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().status, "alive");
    assert.equal(response.headers["x-request-id"], response.json().requestId);
    await app.close();
  });

  it("returns pong", async () => {
    const app = buildApp(createConfig());
    const response = await app.inject({ method: "GET", url: "/api/v1/ping" });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().message, "pong");
    await app.close();
  });

  it("rejects an Iris event without a shared token", async () => {
    const app = buildApp(createConfig());
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/iris/events",
      payload: { msg: "/핑", room: "테스트방", sender: "테스터", json: {} }
    });

    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error.code, "UNAUTHORIZED");
    await app.close();
  });

  it("accepts and stores an authenticated Iris event", async () => {
    const app = buildApp(createConfig());
    const payload = {
      msg: "/핑",
      room: "테스트방",
      sender: "테스터",
      json: { _id: "1", chat_id: "2", user_id: "3" }
    };
    const accepted = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/iris/events",
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
      payload
    });
    const recent = await app.inject({
      method: "GET",
      url: "/api/v1/debug/recent-events",
      headers: { "x-iris-token": TEST_TOKEN }
    });

    assert.equal(accepted.statusCode, 202);
    assert.equal(recent.statusCode, 200);
    assert.deepEqual(recent.json().events[0].payload, payload);
    await app.close();
  });

  it("supports a query token for Iris endpoint compatibility", async () => {
    const app = buildApp(createConfig());
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/integrations/iris/events?token=${TEST_TOKEN}`,
      payload: { msg: "/핑" }
    });

    assert.equal(response.statusCode, 202);
    await app.close();
  });

  it("reports ready when the enabled database responds", async () => {
    let closed = false;
    const app = buildApp(createConfig({
      database: { ...createConfig().database, enabled: true }
    }), {
      database: createDatabaseStub({
        ping: async () => undefined,
        verifyRollback: async () => true,
        close: async () => { closed = true; }
      })
    });
    const response = await app.inject({ method: "GET", url: "/health/ready" });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().database, "ready");
    await app.close();
    assert.equal(closed, true);
  });

  it("reports not ready when the enabled database is unavailable", async () => {
    const app = buildApp(createConfig({
      database: { ...createConfig().database, enabled: true }
    }), {
      database: createDatabaseStub({
        ping: async () => { throw new Error("offline"); },
        verifyRollback: async () => false,
        close: async () => undefined
      })
    });
    const response = await app.inject({ method: "GET", url: "/health/ready" });

    assert.equal(response.statusCode, 503);
    assert.equal(response.json().database, "unavailable");
    await app.close();
  });

  it("replies with the sender name and pong for an exact /ping event", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const app = buildApp(createConfig(), {
      sendIrisTextReply: async (reply) => {
        replies.push(reply);
      }
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/integrations/iris/events?token=${TEST_TOKEN}`,
      payload: {
        msg: "/ping",
        room: "테스트방",
        sender: "테스터",
        json: { chat_id: "123" }
      }
    });

    assert.equal(response.statusCode, 202);
    assert.deepEqual(replies, [{ room: "123", data: "테스터 pong" }]);
    await app.close();
  });

  it("prefers the KakaoTalk database nickname for an exact /ping event", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const app = buildApp(createConfig(), {
      inspectIrisKakaoDatabase: async () => createKakaoSnapshot(),
      sendIrisTextReply: async (reply) => {
        replies.push(reply);
      }
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/integrations/iris/events?token=${TEST_TOKEN}`,
      payload: {
        msg: "/ping",
        room: "테스트방",
        sender: "오래된 Iris 이름",
        json: { id: "9001", chat_id: "123", user_id: "456", type: "1" }
      }
    });

    assert.equal(response.statusCode, 202);
    assert.deepEqual(replies, [{ room: "123", data: "테스 남 pong" }]);
    await app.close();
  });

  it("shows all Iris fields and related KakaoTalk database rows for /info", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const app = buildApp(createConfig(), {
      inspectIrisKakaoDatabase: async () => createKakaoSnapshot(),
      sendIrisTextReply: async (reply) => {
        replies.push(reply);
      }
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/integrations/iris/events?token=${TEST_TOKEN}`,
      payload: {
        msg: "/info",
        room: "테스트방",
        sender: "오래된 Iris 이름",
        json: {
          id: "9001",
          chat_id: "123",
          user_id: "456",
          type: "1",
          attachment: "{}",
          meta: "{\"revision\":3900550890436530177}",
          v: "{\"origin\":\"MSG\",\"isMine\":false}"
        }
      }
    });

    assert.equal(response.statusCode, 202);
    assert.equal(replies.length, 1);
    assert.match(replies[0]!.data, /\[Iris 원문: 최상위 필드\]/);
    assert.match(replies[0]!.data, /• sender: 오래된 Iris 이름/);
    assert.match(replies[0]!.data, /\[Iris 원문: json = 전달된 chat_logs 필드\]/);
    assert.match(replies[0]!.data, /• attachment: \{\}/);
    assert.match(replies[0]!.data, /"revision": "3900550890436530177"/);
    assert.doesNotMatch(replies[0]!.data, /3900550890436530000/);
    assert.match(replies[0]!.data, /\[KakaoTalk DB: chat_logs 현재 행\]/);
    assert.match(replies[0]!.data, /\[KakaoTalk DB: db2\.open_chat_member\]/);
    assert.match(replies[0]!.data, /• nickname: 테스 남/);
    assert.match(replies[0]!.data, /• 닉네임 출처: open_chat_member/);
    assert.match(replies[0]!.data, /• \/ping 응답 이름: 테스 남/);
    await app.close();
  });

  it("does not reply when text is appended to /ping", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const app = buildApp(createConfig(), {
      sendIrisTextReply: async (reply) => {
        replies.push(reply);
      }
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/integrations/iris/events?token=${TEST_TOKEN}`,
      payload: {
        msg: "/ping 설명",
        sender: "테스터",
        json: { chat_id: "123" }
      }
    });

    assert.equal(response.statusCode, 202);
    assert.deepEqual(replies, []);
    await app.close();
  });

  it("does not mirror an ordinary text event", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const app = buildApp(createConfig({ irisEventMonitorRoomId: "monitor-room" }), {
      sendIrisTextReply: async (reply) => { replies.push(reply); }
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/integrations/iris/events?token=${TEST_TOKEN}`,
      payload: {
        msg: "이벤트 테스트",
        room: "원본방",
        sender: "테스터",
        json: {
          id: "event-monitor-1",
          chat_id: "source-room",
          user_id: "user-1",
          type: "1",
          attachment: "{\"mentions\":[]}",
          v: "{\"origin\":\"MSG\",\"isMine\":false}"
        }
      }
    });

    assert.equal(response.statusCode, 202);
    assert.deepEqual(replies, []);
    await app.close();
  });

  it("mirrors a type=1 mention event to the configured TEST room", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const app = buildApp(createConfig({ irisEventMonitorRoomId: "monitor-room" }), {
      sendIrisTextReply: async (reply) => { replies.push(reply); }
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/integrations/iris/events?token=${TEST_TOKEN}`,
      payload: {
        msg: "@봇 테스트",
        room: "원본방",
        sender: "테스터",
        json: {
          id: "event-monitor-mention-1",
          chat_id: "source-room",
          user_id: "user-1",
          type: "1",
          attachment: "{\"mentions\":[{\"user_id\":\"bot\",\"at\":[1],\"len\":1}]}",
          v: "{\"origin\":\"MSG\",\"isMine\":false}"
        }
      }
    });

    assert.equal(response.statusCode, 202);
    assert.equal(replies.length, 1);
    assert.equal(replies[0]!.room, "monitor-room");
    assert.match(replies[0]!.data, /멘션 감지/);
    assert.match(replies[0]!.data, /• origin: MSG/);
    assert.match(replies[0]!.data, /• attachment keys: mentions/);
    await app.close();
  });

  it("reports an image detection as text without forwarding image data", async () => {
    const textReplies: Array<{ room: string; data: string }> = [];
    const imageReplies: Array<{ room: string; imageUrl: string }> = [];
    const app = buildApp(createConfig({ irisEventMonitorRoomId: "monitor-room" }), {
      sendIrisTextReply: async (reply) => { textReplies.push(reply); },
      sendIrisImageReply: async (reply) => { imageReplies.push(reply); }
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/integrations/iris/events?token=${TEST_TOKEN}`,
      payload: {
        msg: "사진",
        room: "원본방",
        sender: "테스터",
        json: {
          id: "event-monitor-image-1",
          chat_id: "source-room",
          user_id: "user-1",
          type: "2",
          attachment: "{\"url\":\"https://p.kakaocdn.net/private-image\",\"w\":100,\"h\":100}",
          v: "{\"origin\":\"MSG\",\"isMine\":false}"
        }
      }
    });

    assert.equal(response.statusCode, 202);
    assert.equal(textReplies.length, 1);
    assert.match(textReplies[0]!.data, /단일 이미지 감지/);
    assert.match(textReplies[0]!.data, /• attachment keys: url, w, h/);
    assert.doesNotMatch(textReplies[0]!.data, /private-image/);
    assert.deepEqual(imageReplies, []);
    await app.close();
  });

  it("does not mirror the event monitor's own outgoing message", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const app = buildApp(createConfig({ irisEventMonitorRoomId: "monitor-room" }), {
      sendIrisTextReply: async (reply) => { replies.push(reply); }
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/integrations/iris/events?token=${TEST_TOKEN}`,
      payload: {
        msg: "🔭 [Iris 이벤트 감지]\n• type: 1",
        room: "TEST",
        sender: "봇",
        json: {
          id: "event-monitor-loop-1",
          chat_id: "monitor-room",
          user_id: "bot-user",
          type: "1",
          v: "{\"origin\":\"WRITE\",\"isMine\":true}"
        }
      }
    });

    assert.deepEqual(replies, []);
    await app.close();
  });

  it("forwards a single image from any sender to the configured test room", async () => {
    const forwards: Array<{ room: string; imageUrl: string }> = [];
    const app = buildApp(createConfig({ irisImageForwardRoomId: "test-room-id" }), {
      sendIrisImageReply: async (input) => {
        forwards.push(input);
      }
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/integrations/iris/events?token=${TEST_TOKEN}`,
      payload: {
        msg: "image",
        json: {
          type: 2,
          chat_id: "source-room-id",
          user_id: "allowed-user-id",
          v: JSON.stringify({ isMine: true }),
          attachment: JSON.stringify({ url: "https://talk.kakaocdn.net/example.png" })
        }
      }
    });

    assert.equal(response.statusCode, 202);
    assert.deepEqual(forwards, [{
      room: "test-room-id",
      imageUrl: "https://talk.kakaocdn.net/example.png"
    }]);
    await app.close();
  });

  it("does not forward an image observed in the target room again", async () => {
    const forwards: Array<{ room: string; imageUrl: string }> = [];
    const app = buildApp(createConfig({ irisImageForwardRoomId: "test-room-id" }), {
      sendIrisImageReply: async (input) => {
        forwards.push(input);
      }
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/integrations/iris/events?token=${TEST_TOKEN}`,
      payload: {
        json: {
          type: 2,
          chat_id: "test-room-id",
          user_id: "allowed-user-id",
          v: JSON.stringify({ isMine: true }),
          attachment: JSON.stringify({ url: "https://talk.kakaocdn.net/example.png" })
        }
      }
    });

    assert.equal(response.statusCode, 202);
    assert.deepEqual(forwards, []);
    await app.close();
  });

  it("rejects a payload over the configured size", async () => {
    const app = buildApp(createConfig({ bodyLimitBytes: 128 }));
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/iris/events",
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
      payload: { msg: "가".repeat(200) }
    });

    assert.equal(response.statusCode, 413);
    assert.equal(response.json().error.code, "PAYLOAD_TOO_LARGE");
    await app.close();
  });
});
