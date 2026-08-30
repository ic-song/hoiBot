import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient } from "../src/database.js";
import { DiamondShopCatalogWebAdapterProvider } from "../src/shop/diamond-shop-catalog-web-adapter-provider.js";

describe("diamond shop catalog web adapter provider", () => {
  it("rejects missing reason and idempotency key before opening a transaction", async () => {
    let transactionCount = 0;
    const database = {
      withTransaction: async () => { transactionCount += 1; throw new Error("unexpected transaction"); },
    } as unknown as DatabaseClient;
    const provider = new DiamondShopCatalogWebAdapterProvider(database);
    await assert.rejects(() => provider.add({
      source: "admin-web",
      operatorId: "1",
      idempotencyKey: "add-1",
      expectedVersion: 1n,
      reason: "   ",
      displayName: "합성 상품",
      quantity: 1n,
      price: 1n,
    }), /reason/);
    await assert.rejects(() => provider.softDisable({
      source: "admin-web",
      operatorId: "1",
      idempotencyKey: " ",
      expectedVersion: 1n,
      reason: "합성 검증",
      productId: "00000000-0000-0000-0000-000000000001",
    }), /idempotencyKey/);
    assert.equal(transactionCount, 0);
  });

  it("rejects invalid operator and DECIMAL(30,0) overflow at the provider boundary", async () => {
    const database = { withTransaction: async () => { throw new Error("unexpected transaction"); } } as unknown as DatabaseClient;
    const provider = new DiamondShopCatalogWebAdapterProvider(database);
    await assert.rejects(() => provider.add({
      source: "admin-web",
      operatorId: "operator-name",
      idempotencyKey: "invalid-operator",
      expectedVersion: 1n,
      reason: "합성 검증",
      displayName: "합성 상품",
      quantity: 1n,
      price: 1n,
    }), /operatorId/);
    await assert.rejects(() => provider.add({
      source: "admin-web",
      operatorId: "1",
      idempotencyKey: "overflow",
      expectedVersion: 1n,
      reason: "합성 검증",
      displayName: "합성 상품",
      quantity: 1000000000000000000000000000000n,
      price: 1n,
    }), /수량 또는 가격/);
  });

  it("delegates snapshot reads to the unchanged Iris catalog service boundary", async () => {
    const expected = { catalogVersion: 7n, bootstrapSource: "legacy.defaultShop", bootstrapVersion: "fixture", bootstrapStatus: "verified", items: [] } as const;
    const catalog = { readSnapshot: async () => expected };
    const provider = new DiamondShopCatalogWebAdapterProvider({} as DatabaseClient, catalog);
    assert.equal(await provider.readSnapshot(), expected);
  });
});
