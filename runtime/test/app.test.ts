import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import { ItemProvider, type ItemDefinition, type ItemMutationContext, type ItemTypeHandler } from "../src/item-provider.js";
import { PackageProvider, type PackageCatalogRepository } from "../src/package-provider.js";

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

describe("package provider", () => {
  it("checks every mutation before consuming and granting items", async () => {
    const definitions = new Map<string, ItemDefinition>([
      ["package-item", { id: "package-item", type: "STACK", name: "패키지", stackable: true, metadata: {}, enabled: true }],
      ["reward-item", { id: "reward-item", type: "STACK", name: "보상", stackable: true, metadata: {}, enabled: true }]
    ]);
    const calls: string[] = [];
    const handler: ItemTypeHandler = {
      checkAdd: async (definition, quantity) => { calls.push(`checkAdd:${definition.id}:${quantity}`); },
      checkRemove: async (definition, quantity) => { calls.push(`checkRemove:${definition.id}:${quantity}`); },
      add: async (definition, quantity) => { calls.push(`add:${definition.id}:${quantity}`); },
      remove: async (definition, quantity) => { calls.push(`remove:${definition.id}:${quantity}`); }
    };
    const items = new ItemProvider({ findById: async (id) => definitions.get(id) });
    items.register("STACK", handler);
    const repository: PackageCatalogRepository = {
      getSnapshot: async () => ({ version: "test", packages: [] }),
      findByLegacyCommand: async () => undefined,
      findById: async () => ({
        id: "package-1",
        catalogVersion: "test",
        displayName: "테스트 패키지",
        legacyCommand: null,
        consumeItemId: "package-item",
        definitionStatus: "READY",
        enabled: true,
        maxOpenCount: 10
      }),
      listRewards: async () => [{
        packageId: "package-1",
        rewardOrder: 1,
        itemId: "reward-item",
        quantity: 3n,
        probability: null,
        targetSelector: null,
        metadataOverride: null
      }]
    };
    const provider = new PackageProvider(repository, items, {
      run: async (work) => work({ id: "transaction-1" })
    });

    const result = await provider.use({ requestKey: "request-1", userId: "user-1", packageId: "package-1", openCount: 2 });

    assert.deepEqual(result, { packageId: "package-1", openCount: 2, rewardCount: 1 });
    assert.deepEqual(calls, [
      "checkRemove:package-item:2",
      "checkAdd:reward-item:6",
      "remove:package-item:2",
      "add:reward-item:6"
    ]);
  });

  it("rejects an item type without a registered handler", async () => {
    const items = new ItemProvider({
      findById: async () => ({ id: "pet-title", type: "PET_TITLE", name: "펫타이틀", stackable: false, metadata: {}, enabled: true })
    });
    const context: ItemMutationContext = {
      ownerType: "PET",
      ownerId: "pet-1",
      transactionId: "transaction-1",
      requestKey: "request-1"
    };

    await assert.rejects(() => items.checkAdd("pet-title", 1n, context), /ITEM_HANDLER_NOT_REGISTERED:PET_TITLE/);
  });
});
