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
    bodyLimitBytes: 1_048_576,
    rawPayloadLogging: true,
    recentEventsEnabled: true,
    recentEventLimit: 2,
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

  it("integrates VERSION-001 through VERSION-006 at the Iris entrypoint", async () => {
    const app = buildApp(createConfig());
    const request = (msg: unknown) => app.inject({
      method: "POST",
      url: "/api/v1/integrations/iris/events",
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
      payload: { msg, room: "테스트방", sender: "일반 사용자", json: {} }
    });

    // VERSION-001 exact reply and VERSION-004 sender-independent behavior.
    const exact = await request("/호이봇버전");
    assert.equal(exact.statusCode, 202);
    assert.equal(exact.json().commandReply, "ver_2.393");

    // VERSION-002 exact guard keeps suffix and whitespace out of the adapter.
    assert.equal((await request("/호이봇버전 1")).json().commandReply, undefined);
    assert.equal((await request("/호이봇버전 ")).json().commandReply, undefined);

    // VERSION-003 is pinned to the legacy source value, while VERSION-005 is stateless.
    assert.equal((await request("/호이봇버전")).json().commandReply, "ver_2.393");
    assert.equal((await request("/호이봇버전")).json().commandReply, "ver_2.393");

    // VERSION-006 stays identical after a fresh runtime entrypoint is built.
    await app.close();
    const restarted = buildApp(createConfig());
    const afterRestart = await restarted.inject({
      method: "POST",
      url: "/api/v1/integrations/iris/events",
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
      payload: { msg: "/호이봇버전" }
    });
    assert.equal(afterRestart.json().commandReply, "ver_2.393");
    await restarted.close();
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
