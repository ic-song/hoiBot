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

  it("adapts exact free-market history aliases with newest-first, rank, fee-marker, and empty parity", async () => {
    const provider = { listCompletedLogs: () => [{ id: 1, itemName: "오래된", quantity: 1, price: 10, seller: "a", buyer: "b", completedAtMs: 1 }, { id: 2, itemName: "최신", quantity: 2, price: 20, seller: "c", buyer: "d", completedAtMs: 2, memberFeeApplied: true }], rankOf: (name: string) => `R:${name}` };
    const app = buildApp(createConfig(), provider);
    const exact = await app.inject({ method: "POST", url: "/api/v1/integrations/iris/events", headers: { authorization: `Bearer ${TEST_TOKEN}` }, payload: { msg: "/자유시장거래현황" } });
    const alias = await app.inject({ method: "POST", url: "/api/v1/integrations/iris/events", headers: { authorization: `Bearer ${TEST_TOKEN}` }, payload: { msg: "ㅅㅅ" } });
    const suffix = await app.inject({ method: "POST", url: "/api/v1/integrations/iris/events", headers: { authorization: `Bearer ${TEST_TOKEN}` }, payload: { msg: "ㅅㅅ 확인" } });
    assert.match(exact.json().commandReply, /1\. \[최신x2개\].*R:c.*R:d.*자유시장회원권/);
    assert.equal(alias.json().commandReply, exact.json().commandReply);
    assert.equal(suffix.json().commandReply, undefined);
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
