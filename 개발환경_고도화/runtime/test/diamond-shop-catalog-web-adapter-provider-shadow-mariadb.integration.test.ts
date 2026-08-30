import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { DiamondShopCatalogAdminService } from "../src/shop/diamond-shop-catalog-admin-service.js";
import { DiamondShopCatalogWebAdapterProvider } from "../src/shop/diamond-shop-catalog-web-adapter-provider.js";
import { DIAMOND_WEB_FIXTURE, seedDiamondShopCatalogWebOperators } from "./fixtures/diamond-shop-catalog-web-adapter.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true"
  && process.env.DIAMOND_SHOP_WEB_ADAPTER_SHADOW_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "shadow-not-configured";

describe("diamond shop catalog web adapter provider Shadow", { skip: !enabled }, () => {
  let database: DatabaseClient;
  before(async () => {
    database = createDatabaseClient({
      enabled: true,
      host: required("DATABASE_HOST"),
      port: Number(required("DATABASE_PORT")),
      user: required("DATABASE_USER"),
      password: required("DATABASE_PASSWORD"),
      name: required("DATABASE_NAME"),
      connectionLimit: 4,
      connectTimeoutMs: 5_000,
    });
    await seedDiamondShopCatalogWebOperators(database);
  });
  after(async () => { if (database) await database.close(); });

  it("keeps the unchanged Iris snapshot projection equal and emits no Iris artifacts", async () => {
    const iris = new DiamondShopCatalogAdminService(database);
    const provider = new DiamondShopCatalogWebAdapterProvider(database, iris);
    assert.deepEqual(await provider.readSnapshot(), await iris.readSnapshot());
    const before = (await database.query<Array<{ executions: bigint; outboxes: bigint }>>(
      "SELECT (SELECT COUNT(*) FROM command_executions) executions,(SELECT COUNT(*) FROM outbox_messages) outboxes",
    ))[0]!;
    const snapshot = await provider.readSnapshot();
    const result = await provider.add({
      source: "lease2361-shadow",
      operatorId: DIAMOND_WEB_FIXTURE.managerOperatorId,
      idempotencyKey: `shadow-${snapshot.catalogVersion.toString()}`,
      expectedVersion: snapshot.catalogVersion,
      reason: "Lease2361 synthetic Shadow projection comparison",
      displayName: `Lease2361 Shadow ${snapshot.catalogVersion.toString()}`,
      quantity: 5n,
      price: 61n,
    });
    const providerAfter = await provider.readSnapshot();
    const irisAfter = await iris.readSnapshot();
    assert.deepEqual(providerAfter, irisAfter);
    assert.equal(irisAfter.items.some((item) => item.productId === result.productId), true);
    const after = (await database.query<Array<{ executions: bigint; outboxes: bigint }>>(
      "SELECT (SELECT COUNT(*) FROM command_executions) executions,(SELECT COUNT(*) FROM outbox_messages) outboxes",
    ))[0]!;
    assert.deepEqual(after, before);
  });
});
