import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { createDatabaseClient, createScopedDatabaseClient, type DatabaseClient } from "../src/database.js";
import { createCanonicalDomainItemProvider } from "../src/package/current-domain-package-runtime.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("canonical item definition adapter MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  let playerId: bigint;
  let itemId: bigint;
  const itemCode = "legacy_bag_8aa52459621254e1";

  before(async () => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 4, connectTimeoutMs: 5_000 });
    playerId = (await database.execute("INSERT INTO players(status,version) VALUES ('active',1)")).insertId;
    itemId = (await database.query<Array<{ id: bigint }>>("SELECT id FROM item_definitions WHERE code=? AND active=TRUE", [itemCode]))[0]!.id;
  });

  after(async () => { if (database) await database.close(); });

  async function seed(quantity: bigint): Promise<void> {
    await database.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,?,1) ON DUPLICATE KEY UPDATE quantity=VALUES(quantity),version=inventory_stacks.version+1", [playerId, itemId, quantity]);
  }

  it("removes a direct-bag stack through the shared handler and rolls back with its caller transaction", async () => {
    await seed(2n);
    let operationId = "";
    await database.withTransaction(async transaction => {
      const operation = await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'canonical.item.adapter',?,'system',NULL,'test','processing',UTC_TIMESTAMP(3))", [randomUUID(), randomUUID()]);
      operationId = operation.insertId.toString();
      await createCanonicalDomainItemProvider(createScopedDatabaseClient(transaction)).remove(itemCode, 2n, { ownerType: "USER", ownerId: playerId.toString(), transactionId: operationId, transactionHandle: transaction, requestKey: "remove-1", operation: "REMOVE" });
      await transaction.execute("UPDATE operations SET status='completed',completed_at=UTC_TIMESTAMP(3) WHERE id=?", [operation.insertId]);
    });
    const stack = (await database.query<Array<{ quantity: bigint }>>("SELECT quantity FROM inventory_stacks WHERE player_id=? AND item_id=?", [playerId, itemId]))[0]!;
    assert.equal(stack.quantity, 0n);
    const ledger = (await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM inventory_ledger WHERE operation_id=? AND quantity_delta=-2", [operationId]))[0]!;
    assert.equal(ledger.count, 1n);

    await seed(1n);
    await assert.rejects(() => database.withTransaction(async transaction => {
      const operation = await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'canonical.item.adapter',?,'system',NULL,'test','processing',UTC_TIMESTAMP(3))", [randomUUID(), randomUUID()]);
      await createCanonicalDomainItemProvider(createScopedDatabaseClient(transaction)).remove(itemCode, 1n, { ownerType: "USER", ownerId: playerId.toString(), transactionId: operation.insertId.toString(), transactionHandle: transaction, requestKey: "remove-rollback", operation: "REMOVE" });
      throw new Error("synthetic caller failure");
    }), /synthetic caller failure/);
    const restored = (await database.query<Array<{ quantity: bigint }>>("SELECT quantity FROM inventory_stacks WHERE player_id=? AND item_id=?", [playerId, itemId]))[0]!;
    assert.equal(restored.quantity, 1n);
    await database.ping();
  });
});
