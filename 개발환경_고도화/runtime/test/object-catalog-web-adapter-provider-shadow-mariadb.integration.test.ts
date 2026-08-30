import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { MariaObjectCatalogRepository } from "../src/catalog/maria-object-catalog-repository.js";
import { ObjectCatalogService } from "../src/catalog/object-catalog.js";
import { ObjectCatalogWebAdapterProvider } from "../src/catalog/object-catalog-web-adapter-provider.js";
import { OBJECT_CATALOG_WEB_FIXTURE, seedObjectCatalogWebFixture } from "./fixtures/object-catalog-web-adapter.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true"
  && process.env.OBJECT_CATALOG_WEB_ADAPTER_SHADOW_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "shadow-not-configured";

describe("object catalog web adapter provider Shadow", { skip: !enabled }, () => {
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
    await seedObjectCatalogWebFixture(database);
  });
  after(async () => { if (database) await database.close(); });

  it("matches the unchanged core projection and emits only internal provider outbox", async () => {
    const provider = new ObjectCatalogWebAdapterProvider(database);
    const core = new ObjectCatalogService(new MariaObjectCatalogRepository(database));
    const before = (await database.query<Array<{ executions: bigint; outboxes: bigint }>>(
      "SELECT (SELECT COUNT(*) FROM command_executions) executions,(SELECT COUNT(*) FROM outbox_messages) outboxes",
    ))[0]!;
    const registered = await provider.register({
      source: "lease2373-shadow",
      operatorId: OBJECT_CATALOG_WEB_FIXTURE.managerOperatorId,
      idempotencyKey: "lease2373-shadow-register",
      reason: "Lease2373 provider Shadow register",
      objectKey: OBJECT_CATALOG_WEB_FIXTURE.shadowObjectKey,
      objectType: "CURRENCY",
      displayName: "Lease2373 Shadow 크레딧",
      sourceBindings: [{ system: "RUNTIME_DB", table: "currency_definitions", key: OBJECT_CATALOG_WEB_FIXTURE.shadowCurrencyCode }],
    });
    assert.deepEqual(await core.getByKey(registered.object.objectKey, true), registered.object);
    const disabled = await provider.setActive({
      source: "lease2373-shadow",
      operatorId: OBJECT_CATALOG_WEB_FIXTURE.managerOperatorId,
      idempotencyKey: "lease2373-shadow-disable",
      reason: "Lease2373 provider Shadow disable",
      objectKey: registered.object.objectKey,
      objectType: registered.object.objectType,
      expectedVersion: registered.object.version,
      active: false,
    });
    assert.deepEqual(await core.getByKey(disabled.object.objectKey, true), disabled.object);
    const after = (await database.query<Array<{ executions: bigint; outboxes: bigint; internalOutboxes: bigint }>>(
      `SELECT (SELECT COUNT(*) FROM command_executions) executions,
       (SELECT COUNT(*) FROM outbox_messages) outboxes,
       (SELECT COUNT(*) FROM outbox_messages WHERE operation_id IN (?,?) AND provider_code='internal' AND message_type='object_catalog.changed') internalOutboxes`,
      [registered.operationId, disabled.operationId],
    ))[0]!;
    assert.equal(after.executions, before.executions);
    assert.equal(after.outboxes - before.outboxes, 2n);
    assert.equal(after.internalOutboxes, 2n);
  });
});
