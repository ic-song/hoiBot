import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { ObjectCatalogWebAdapterProvider } from "../src/catalog/object-catalog-web-adapter-provider.js";
import { OBJECT_CATALOG_WEB_FIXTURE, seedObjectCatalogWebFixture } from "./fixtures/object-catalog-web-adapter.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("object catalog web adapter provider MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  let provider: ObjectCatalogWebAdapterProvider;
  const open = () => createDatabaseClient({
    enabled: true,
    host: required("DATABASE_HOST"),
    port: Number(required("DATABASE_PORT")),
    user: required("DATABASE_USER"),
    password: required("DATABASE_PASSWORD"),
    name: required("DATABASE_NAME"),
    connectionLimit: 8,
    connectTimeoutMs: 5_000,
  });

  before(async () => {
    database = open();
    await seedObjectCatalogWebFixture(database);
    provider = new ObjectCatalogWebAdapterProvider(database);
  });

  after(async () => {
    if (!database) return;
    try {
      await database.close();
    } catch (value) {
      const code = typeof value === "object" && value !== null && "code" in value ? (value as { code?: unknown }).code : undefined;
      if (code !== "ER_POOL_ALREADY_CLOSED") throw value;
    }
  });

  it("commits register/update/active once with rollback, replay and restart guarantees", async () => {
    const input = {
      source: OBJECT_CATALOG_WEB_FIXTURE.source,
      operatorId: OBJECT_CATALOG_WEB_FIXTURE.managerOperatorId,
      idempotencyKey: "lease2373-register",
      reason: "Lease2373 concurrent register",
      objectKey: OBJECT_CATALOG_WEB_FIXTURE.objectKey,
      objectType: "CURRENCY" as const,
      displayName: "Lease2373 합성 크레딧",
      metadata: { fixture: true },
      aliases: [{ type: "legacy_code" as const, value: "lease2373_credit" }],
      sourceBindings: [{ system: "RUNTIME_DB" as const, table: "currency_definitions", key: OBJECT_CATALOG_WEB_FIXTURE.currencyCode }],
    };
    const concurrent = await Promise.all([provider.register(input), provider.register(input)]);
    assert.deepEqual(concurrent.map((value) => value.replayed).sort(), [false, true]);
    assert.equal(concurrent[0]!.object.objectKey, concurrent[1]!.object.objectKey);
    assert.equal(concurrent[0]!.object.version, "1");
    await assert.rejects(() => provider.register({ ...input, displayName: "다른 payload" }), /다른 요청 payload/);
    await assert.rejects(() => provider.register({
      ...input,
      operatorId: OBJECT_CATALOG_WEB_FIXTURE.unprivilegedOperatorId,
      idempotencyKey: "lease2373-unprivileged",
      objectKey: "currency.lease2373_denied",
    }), /권한/);

    const updated = await provider.update({
      ...input,
      operatorId: OBJECT_CATALOG_WEB_FIXTURE.superAdminOperatorId,
      idempotencyKey: "lease2373-update",
      reason: "Lease2373 super_admin update",
      expectedVersion: "1",
      displayName: "Lease2373 수정 크레딧",
      active: true,
    });
    assert.equal(updated.object.version, "2");

    const rollbackBefore = (await database.query<Array<{ objects: bigint; changes: bigint; operations: bigint; audits: bigint; outboxes: bigint }>>(
      `SELECT
       (SELECT COUNT(*) FROM object_registry WHERE object_key=?) objects,
       (SELECT COUNT(*) FROM object_catalog_change_log change_log JOIN object_registry object ON object.id=change_log.object_id WHERE object.object_key=?) changes,
       (SELECT COUNT(*) FROM operations WHERE idempotency_scope='object.catalog.web') operations,
       (SELECT COUNT(*) FROM command_audit WHERE action_code LIKE 'object.catalog.web.%') audits,
       (SELECT COUNT(*) FROM outbox_messages WHERE message_type='object_catalog.changed') outboxes`,
      [input.objectKey, input.objectKey],
    ))[0]!;
    await database.execute("CREATE TRIGGER lease2373_fail_object_web_audit BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Lease2373 synthetic audit rollback'");
    try {
      await assert.rejects(() => provider.update({
        ...input,
        idempotencyKey: "lease2373-rollback",
        reason: "Lease2373 rollback",
        expectedVersion: "2",
        displayName: "롤백 대상",
        active: true,
      }), /Lease2373 synthetic audit rollback/);
    } finally {
      await database.execute("DROP TRIGGER lease2373_fail_object_web_audit");
    }
    const rollbackAfter = (await database.query<Array<typeof rollbackBefore>>(
      `SELECT
       (SELECT COUNT(*) FROM object_registry WHERE object_key=?) objects,
       (SELECT COUNT(*) FROM object_catalog_change_log change_log JOIN object_registry object ON object.id=change_log.object_id WHERE object.object_key=?) changes,
       (SELECT COUNT(*) FROM operations WHERE idempotency_scope='object.catalog.web') operations,
       (SELECT COUNT(*) FROM command_audit WHERE action_code LIKE 'object.catalog.web.%') audits,
       (SELECT COUNT(*) FROM outbox_messages WHERE message_type='object_catalog.changed') outboxes`,
      [input.objectKey, input.objectKey],
    ))[0]!;
    assert.deepEqual(rollbackAfter, rollbackBefore);

    const activeInput = {
      source: input.source,
      operatorId: input.operatorId,
      idempotencyKey: "lease2373-disable",
      reason: "Lease2373 stable objectKey disable",
      objectKey: input.objectKey,
      objectType: input.objectType,
      expectedVersion: "2",
      active: false,
    };
    const disabled = await provider.setActive(activeInput);
    assert.equal(disabled.status, "deactivated");
    assert.equal(disabled.object.objectKey, input.objectKey);
    assert.equal(disabled.object.version, "3");

    await database.close();
    database = open();
    provider = new ObjectCatalogWebAdapterProvider(database);
    const restartReplay = await provider.setActive(activeInput);
    assert.equal(restartReplay.replayed, true);
    assert.equal(restartReplay.operationId, disabled.operationId);
    const final = (await database.query<Array<{ operations: bigint; changes: bigint; audits: bigint; outboxes: bigint; executions: bigint; reason: string }>>(
      `SELECT
       (SELECT COUNT(*) FROM operations WHERE idempotency_scope='object.catalog.web') operations,
       (SELECT COUNT(*) FROM object_catalog_change_log change_log JOIN object_registry object ON object.id=change_log.object_id WHERE object.object_key=?) changes,
       (SELECT COUNT(*) FROM command_audit audit JOIN operations operation ON operation.id=audit.operation_id WHERE operation.idempotency_scope='object.catalog.web') audits,
       (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation ON operation.id=outbox.operation_id WHERE operation.idempotency_scope='object.catalog.web') outboxes,
       (SELECT COUNT(*) FROM command_executions execution JOIN operations operation ON operation.id=execution.operation_id WHERE operation.idempotency_scope='object.catalog.web') executions,
       (SELECT reason FROM command_audit WHERE operation_id=? LIMIT 1) reason`,
      [input.objectKey, disabled.operationId],
    ))[0]!;
    assert.deepEqual(final, { operations: 3n, changes: 3n, audits: 3n, outboxes: 3n, executions: 0n, reason: activeInput.reason });
  });
});
