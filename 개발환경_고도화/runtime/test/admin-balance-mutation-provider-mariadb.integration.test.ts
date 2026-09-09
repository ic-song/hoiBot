import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { AdminBalanceMutationProvider } from "../src/admin/admin-balance-mutation-provider.js";
import { MariaAdminBalanceMutationRepository } from "../src/admin/maria-admin-balance-mutation-repository.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";
const open = (): DatabaseClient => createDatabaseClient({
  enabled: true,
  host: required("DATABASE_HOST"),
  port: Number(required("DATABASE_PORT")),
  user: required("DATABASE_USER"),
  password: required("DATABASE_PASSWORD"),
  name: required("DATABASE_NAME"),
  connectionLimit: 2,
  connectTimeoutMs: 5000,
});

function transactionClient(transaction: DatabaseTransaction): DatabaseClient {
  return {
    ping: async () => undefined,
    verifyRollback: async () => true,
    query: transaction.query,
    execute: transaction.execute,
    withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(transaction),
    close: async () => undefined,
  };
}

describe("admin balance mutation provider MariaDB transaction", { skip: !enabled }, () => {
  it("applies, replays, rolls back to a new version, aborts the outer transaction, and reconnects unchanged", async () => {
    let database = open();
    const before = await new MariaAdminBalanceMutationRepository(database).readCurrent("home_badge");
    const operator = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE status='active' ORDER BY id LIMIT 1"))[0];
    assert.ok(operator, "active synthetic admin operator required");
    const first = before.values.find((entry) => entry.editable)!;
    const next = (BigInt(first.value) + 1n).toString();
    const sentinel = new Error("synthetic outer rollback");
    await assert.rejects(database.withTransaction(async (transaction) => {
      const client = transactionClient(transaction);
      const repository = new MariaAdminBalanceMutationRepository(client);
      const provider = new AdminBalanceMutationProvider(client, repository);
      const base = { mode: "apply" as const, domain: "home_badge" as const, operatorId: operator.id.toString(), expectedVersion: before.version, reason: "MariaDB 합성 수치 변경", changes: [{ key: first.key, value: next }] };
      const preview = await provider.preview(base);
      const idempotencyKey = `balance-maria-${randomUUID()}`;
      const applied = await provider.apply({ ...base, idempotencyKey, confirmationToken: preview.confirmationToken, confirmed: true });
      assert.equal(applied.replayed, false);
      assert.equal((await provider.apply({ ...base, idempotencyKey, confirmationToken: preview.confirmationToken, confirmed: true })).replayed, true);
      const rollbackBase = { mode: "rollback" as const, domain: "home_badge" as const, operatorId: operator.id.toString(), expectedVersion: applied.version, targetVersion: before.version, reason: "MariaDB 합성 수치 rollback" };
      const rollbackPreview = await provider.preview(rollbackBase);
      const rolledBack = await provider.rollback({ ...rollbackBase, idempotencyKey: `balance-maria-rollback-${randomUUID()}`, confirmationToken: rollbackPreview.confirmationToken, confirmed: true });
      assert.notEqual(rolledBack.version, before.version);
      assert.equal((await repository.readCurrent("home_badge")).values.find((entry) => entry.key === first.key)!.value, first.value);
      throw sentinel;
    }), (error: unknown) => error === sentinel);
    await database.close();
    database = open();
    const afterReconnect = await new MariaAdminBalanceMutationRepository(database).readCurrent("home_badge");
    assert.equal(afterReconnect.version, before.version);
    assert.equal(afterReconnect.values.find((entry) => entry.key === first.key)!.value, first.value);
    await database.close();
  });
});
