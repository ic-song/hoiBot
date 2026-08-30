import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { DiamondShopCatalogWebAdapterProvider } from "../src/shop/diamond-shop-catalog-web-adapter-provider.js";
import { DIAMOND_WEB_FIXTURE, seedDiamondShopCatalogWebOperators } from "./fixtures/diamond-shop-catalog-web-adapter.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("diamond shop catalog web adapter provider MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  let provider: DiamondShopCatalogWebAdapterProvider;
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
    await seedDiamondShopCatalogWebOperators(database);
    provider = new DiamondShopCatalogWebAdapterProvider(database);
  });

  after(async () => {
    if (!database) return;
    try {
      await database.close();
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
      if (code !== "ER_POOL_ALREADY_CLOSED") throw error;
    }
  });

  it("commits add/disable once with role, fingerprint, version, rollback and restart guarantees", async () => {
    const beforeSnapshot = await provider.readSnapshot();
    const irisBefore = (await database.query<Array<{ executions: bigint; outboxes: bigint }>>(
      "SELECT (SELECT COUNT(*) FROM command_executions) executions,(SELECT COUNT(*) FROM outbox_messages) outboxes",
    ))[0]!;
    const duplicateInput = {
      source: DIAMOND_WEB_FIXTURE.source,
      operatorId: DIAMOND_WEB_FIXTURE.managerOperatorId,
      idempotencyKey: "lease2361-concurrent-add",
      expectedVersion: beforeSnapshot.catalogVersion,
      reason: "Lease2361 concurrent duplicate verification",
      displayName: "Lease2361 합성 상품",
      quantity: 2n,
      price: 31n,
    };
    const duplicateResults = await Promise.all([provider.add(duplicateInput), provider.add(duplicateInput)]);
    assert.deepEqual(duplicateResults.map((result) => result.replayed).sort(), [false, true]);
    assert.equal(duplicateResults[0]!.productId, duplicateResults[1]!.productId);
    assert.equal(duplicateResults[0]!.catalogVersion, (beforeSnapshot.catalogVersion + 1n).toString());

    await assert.rejects(() => provider.add({ ...duplicateInput, price: 32n }), /다른 요청 payload/);
    await assert.rejects(() => provider.add({
      ...duplicateInput,
      idempotencyKey: "lease2361-stale-version",
      displayName: "Lease2361 stale 상품",
    }), /먼저 변경/);
    await assert.rejects(() => provider.add({
      ...duplicateInput,
      operatorId: DIAMOND_WEB_FIXTURE.unprivilegedOperatorId,
      idempotencyKey: "lease2361-unprivileged",
      expectedVersion: beforeSnapshot.catalogVersion + 1n,
    }), /권한/);

    const superResult = await provider.add({
      ...duplicateInput,
      operatorId: DIAMOND_WEB_FIXTURE.superAdminOperatorId,
      idempotencyKey: "lease2361-super-add",
      expectedVersion: beforeSnapshot.catalogVersion + 1n,
      reason: "Lease2361 super_admin role verification",
      displayName: "Lease2361 super 상품",
      quantity: 3n,
      price: 47n,
    });
    assert.equal(superResult.catalogVersion, (beforeSnapshot.catalogVersion + 2n).toString());

    const rollbackBefore = (await database.query<Array<{ version: bigint; items: bigint; operations: bigint; events: bigint; audits: bigint }>>(
      `SELECT catalog_version version,
       (SELECT COUNT(*) FROM diamond_shop_catalog_items) items,
       (SELECT COUNT(*) FROM operations WHERE idempotency_scope='diamond.shop.catalog.web') operations,
       (SELECT COUNT(*) FROM diamond_shop_catalog_events) events,
       (SELECT COUNT(*) FROM command_audit WHERE action_code LIKE 'diamond.shop.catalog.web.%') audits
       FROM diamond_shop_catalog_state WHERE singleton_id=1`,
    ))[0]!;
    await database.execute("CREATE TRIGGER lease2361_fail_web_audit BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Lease2361 synthetic audit rollback'");
    try {
      await assert.rejects(() => provider.add({
        ...duplicateInput,
        idempotencyKey: "lease2361-audit-rollback",
        expectedVersion: rollbackBefore.version,
        displayName: "Lease2361 rollback 상품",
      }), /Lease2361 synthetic audit rollback/);
    } finally {
      await database.execute("DROP TRIGGER lease2361_fail_web_audit");
    }
    const rollbackAfter = (await database.query<Array<{ version: bigint; items: bigint; operations: bigint; events: bigint; audits: bigint }>>(
      `SELECT catalog_version version,
       (SELECT COUNT(*) FROM diamond_shop_catalog_items) items,
       (SELECT COUNT(*) FROM operations WHERE idempotency_scope='diamond.shop.catalog.web') operations,
       (SELECT COUNT(*) FROM diamond_shop_catalog_events) events,
       (SELECT COUNT(*) FROM command_audit WHERE action_code LIKE 'diamond.shop.catalog.web.%') audits
       FROM diamond_shop_catalog_state WHERE singleton_id=1`,
    ))[0]!;
    assert.deepEqual(rollbackAfter, rollbackBefore);

    const disableInput = {
      source: DIAMOND_WEB_FIXTURE.source,
      operatorId: DIAMOND_WEB_FIXTURE.managerOperatorId,
      idempotencyKey: "lease2361-stable-disable",
      expectedVersion: rollbackAfter.version,
      reason: "Lease2361 stable productId soft-disable verification",
      productId: duplicateResults[0]!.productId,
    };
    const disabled = await provider.softDisable(disableInput);
    assert.equal(disabled.status, "disabled");
    const productRows = await database.query<Array<{ enabled: number; version: bigint }>>(
      "SELECT enabled,version FROM diamond_shop_catalog_items WHERE product_id=?",
      [disabled.productId],
    );
    assert.deepEqual(productRows[0], { enabled: 0, version: 2n });

    await database.close();
    database = open();
    provider = new DiamondShopCatalogWebAdapterProvider(database);
    const restartedReplay = await provider.softDisable(disableInput);
    assert.equal(restartedReplay.replayed, true);
    assert.equal(restartedReplay.operationId, disabled.operationId);
    const finalRows = (await database.query<Array<{ operations: bigint; events: bigint; audits: bigint; executions: bigint; outboxes: bigint; reason: string }>>(
      `SELECT
       (SELECT COUNT(*) FROM operations WHERE idempotency_scope='diamond.shop.catalog.web') operations,
       (SELECT COUNT(*) FROM diamond_shop_catalog_events event JOIN operations operation ON operation.id=event.operation_id WHERE operation.idempotency_scope='diamond.shop.catalog.web') events,
       (SELECT COUNT(*) FROM command_audit audit JOIN operations operation ON operation.id=audit.operation_id WHERE operation.idempotency_scope='diamond.shop.catalog.web') audits,
       (SELECT COUNT(*) FROM command_executions execution JOIN operations operation ON operation.id=execution.operation_id WHERE operation.idempotency_scope='diamond.shop.catalog.web') executions,
       (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation ON operation.id=outbox.operation_id WHERE operation.idempotency_scope='diamond.shop.catalog.web') outboxes,
       (SELECT reason FROM command_audit WHERE operation_id=? LIMIT 1) reason`,
      [disabled.operationId],
    ))[0]!;
    assert.deepEqual(finalRows, {
      operations: 3n,
      events: 3n,
      audits: 3n,
      executions: 0n,
      outboxes: 0n,
      reason: disableInput.reason,
    });
    const irisAfter = (await database.query<Array<{ executions: bigint; outboxes: bigint }>>(
      "SELECT (SELECT COUNT(*) FROM command_executions) executions,(SELECT COUNT(*) FROM outbox_messages) outboxes",
    ))[0]!;
    assert.deepEqual(irisAfter, irisBefore);
  });
});
