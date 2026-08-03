import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";

const TEST_TOKEN = "test-shared-token-1234";

function createConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: "test",
    host: "127.0.0.1",
    port: 3000,
    irisSharedToken: TEST_TOKEN,
    irisBaseUrl: "http://127.0.0.1:3000",
    irisImageForwardRoomId: "",
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
      database: {
        ping: async () => undefined,
        verifyRollback: async () => true,
        close: async () => { closed = true; }
      }
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
      database: {
        ping: async () => { throw new Error("offline"); },
        verifyRollback: async () => false,
        close: async () => undefined
      }
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
