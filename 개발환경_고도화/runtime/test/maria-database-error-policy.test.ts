import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createScopedDatabaseClient, type DatabaseClient, type DatabaseTransaction, type RootTransactionDatabaseClient } from "../src/database.js";
import {
  classifyMariaDatabaseError,
  insertWithCuid8CollisionRetry,
  isMariaBusinessUniqueConflict,
  withMariaTransactionRetry,
} from "../src/shared/maria-database-error-policy.js";

function mariaError(code: string, errno: number, message: string): Error & { code: string; errno: number; sqlMessage: string } {
  return Object.assign(new Error(message), { code, errno, sqlMessage: message });
}

function databaseWithTransactions(work: (attempt: number, transaction: DatabaseTransaction) => Promise<unknown>, root = true): { database: DatabaseClient; attempts: () => number; transactions: () => readonly DatabaseTransaction[] } {
  let count = 0;
  const observed: DatabaseTransaction[] = [];
  const outside: DatabaseTransaction = { query: async <T>() => [] as T, execute: async () => ({ affectedRows: 1n, insertId: 0n }) };
  const run = async <T>(callback: (value: DatabaseTransaction) => Promise<T>): Promise<T> => {
    count += 1;
    const transaction: DatabaseTransaction = { query: outside.query, execute: outside.execute };
    observed.push(transaction);
    await work(count, transaction);
    return callback(transaction);
  };
  const database: DatabaseClient & Partial<RootTransactionDatabaseClient> = {
    ping: async () => undefined, verifyRollback: async () => true,
    query: outside.query, execute: outside.execute, close: async () => undefined,
    withTransaction: run,
  };
  if (root) database.withRootTransaction = run;
  return { database, attempts: () => count, transactions: () => observed };
}

describe("RFA03 Maria database error policy", () => {
  it("classifies only exact Maria code/errno pairs and an explicit CUID8 primary-key context", () => {
    const primary = mariaError("ER_DUP_ENTRY", 1062, "Duplicate entry 'a1234567' for key 'PRIMARY'");
    assert.equal(classifyMariaDatabaseError(primary, { candidate: "a1234567" }).kind, "CUID8_PRIMARY_KEY_COLLISION");
    assert.equal(classifyMariaDatabaseError(primary).kind, "BUSINESS_UNIQUE_CONFLICT");
    assert.equal(classifyMariaDatabaseError(Object.assign(new Error(primary.message), { code: "ER_DUP_ENTRY" }), { candidate: "a1234567" }).kind, "OTHER");
    assert.equal(classifyMariaDatabaseError(mariaError("ER_DUP_ENTRY", 1213, primary.message), { candidate: "a1234567" }).kind, "OTHER");
    assert.equal(classifyMariaDatabaseError(mariaError("ER_CHECKREAD", 1020, "Record has changed since last read")).kind, "TRANSACTION_CHECK_READ_CONFLICT");
    assert.equal(classifyMariaDatabaseError(Object.assign(new Error("check read"), { code: "ER_CHECKREAD" })).kind, "OTHER");
    assert.equal(classifyMariaDatabaseError(mariaError("ER_CHECKREAD", 1205, "wrong errno")).kind, "OTHER");
  });

  it("keeps business UNIQUE and both FK directions out of CUID collision retry", () => {
    const unique = mariaError("ER_DUP_ENTRY", 1062, "Duplicate entry 'same' for key 'uq_object_identity_crosswalk_source'");
    assert.equal(classifyMariaDatabaseError(unique, { candidate: "a1234567" }).kind, "BUSINESS_UNIQUE_CONFLICT");
    const spoofedContext = { candidate: "a1234567", primaryKeyName: "uq_object_identity_crosswalk_source" };
    assert.equal(classifyMariaDatabaseError(unique, spoofedContext).kind, "BUSINESS_UNIQUE_CONFLICT");
    assert.equal(isMariaBusinessUniqueConflict(unique, "uq_object_identity_crosswalk_source"), true);
    assert.equal(classifyMariaDatabaseError(mariaError("ER_NO_REFERENCED_ROW_2", 1452, "Cannot add or update a child row")).kind, "FOREIGN_KEY_CONFLICT");
    assert.equal(classifyMariaDatabaseError(mariaError("ER_ROW_IS_REFERENCED_2", 1451, "Cannot delete or update a parent row")).kind, "FOREIGN_KEY_CONFLICT");
  });

  it("retries only confirmed CUID8 primary-key collisions with a strict upper bound", async () => {
    const candidates = ["a1234567", "b1234567"];
    let writes = 0;
    const result = await insertWithCuid8CollisionRetry(async () => {
      writes += 1;
      if (writes === 1) throw mariaError("ER_DUP_ENTRY", 1062, "Duplicate entry 'a1234567' for key 'PRIMARY'");
    }, { generate: () => candidates.shift()!, maxAttempts: 2 });
    assert.equal(result, "b1234567");
    assert.equal(writes, 2);

    writes = 0;
    await assert.rejects(insertWithCuid8CollisionRetry(async () => {
      writes += 1;
      throw mariaError("ER_DUP_ENTRY", 1062, "Duplicate entry 'same' for key 'uq_business'");
    }, { generate: () => "a1234567", maxAttempts: 2 }), (error: unknown) => classifyMariaDatabaseError(error).kind === "BUSINESS_UNIQUE_CONFLICT");
    assert.equal(writes, 1);

    const collision = mariaError("ER_DUP_ENTRY", 1062, "Duplicate entry 'a1234567' for key 'PRIMARY'");
    let exhaustion: unknown;
    writes = 0;
    try {
      await insertWithCuid8CollisionRetry(async () => { writes += 1; throw collision; }, { generate: () => "a1234567", maxAttempts: 2 });
    } catch (error) { exhaustion = error; }
    assert.equal((exhaustion as Error).message, "RFA03_CUID8_COLLISION_RETRY_EXHAUSTED");
    assert.equal((exhaustion as Error & { cause?: unknown }).cause, collision);
    assert.equal(writes, 2);
  });

  it("keeps the existing whole-transaction retry for domain-approved 1213/1205", async () => {
    for (const conflict of [
      mariaError("ER_LOCK_DEADLOCK", 1213, "Deadlock found"),
      mariaError("ER_LOCK_WAIT_TIMEOUT", 1205, "Lock wait timeout exceeded"),
    ]) {
      const harness = databaseWithTransactions(async (attempt) => { if (attempt === 1) throw conflict; });
      const result = await withMariaTransactionRetry(harness.database, { maxAttempts: 2, allowRetry: () => true }, async () => "committed");
      assert.equal(result, "committed");
      assert.equal(harness.attempts(), 2);
      assert.equal(harness.transactions().length, 2);
      assert.notEqual(harness.transactions()[0], harness.transactions()[1]);
    }
  });

  it("requires an explicit owner opt-in before allowRetry can receive exact 1020", async () => {
    const conflict = mariaError("ER_CHECKREAD", 1020, "Record has changed since last read");
    const defaultHarness = databaseWithTransactions(async () => { throw conflict; });
    await assert.rejects(withMariaTransactionRetry(defaultHarness.database, { maxAttempts: 3, allowRetry: () => true }, async () => "never"), (error) => error === conflict);
    assert.equal(defaultHarness.attempts(), 1);

    const optedIn = databaseWithTransactions(async (attempt) => { if (attempt === 1) throw conflict; });
    const observed: string[] = [];
    const result = await withMariaTransactionRetry(optedIn.database, { maxAttempts: 2, allowCheckReadConflict: true, allowRetry: (kind) => { observed.push(kind); return true; } }, async () => "committed");
    assert.equal(result, "committed");
    assert.equal(optedIn.attempts(), 2);
    assert.deepEqual(observed, ["TRANSACTION_CHECK_READ_CONFLICT"]);
  });

  it("keeps the exact final transaction conflict as the stable exhaustion cause", async () => {
    const conflict = mariaError("ER_LOCK_DEADLOCK", 1213, "Deadlock found");
    const harness = databaseWithTransactions(async () => { throw conflict; });
    let exhaustion: unknown;
    try {
      await withMariaTransactionRetry(harness.database, { maxAttempts: 2, allowRetry: () => true }, async () => "never");
    } catch (error) { exhaustion = error; }
    assert.equal((exhaustion as Error).message, "RFA03_TRANSACTION_RETRY_EXHAUSTED");
    assert.equal((exhaustion as Error & { cause?: unknown }).cause, conflict);
    assert.equal(harness.attempts(), 2);
    assert.notEqual(harness.transactions()[0], harness.transactions()[1]);
  });

  it("does not retry a scoped/savepoint client and propagates the original conflict to its root owner", async () => {
    const conflict = mariaError("ER_LOCK_DEADLOCK", 1213, "Deadlock found");
    const statements: string[] = [];
    let callbacks = 0;
    const parent: DatabaseTransaction = {
      query: async <T>() => [] as T,
      execute: async (sql) => { statements.push(sql); throw new Error("SAVEPOINT_CLEANUP_MUST_NOT_RUN"); },
    };
    const scoped = createScopedDatabaseClient(parent);
    await assert.rejects(withMariaTransactionRetry(scoped, { maxAttempts: 3, allowRetry: () => true }, async () => {
      callbacks += 1;
      throw conflict;
    }), (error) => error === conflict);
    assert.equal(callbacks, 1);
    assert.deepEqual(statements, []);

    const unbranded = databaseWithTransactions(async () => { throw conflict; }, false);
    await assert.rejects(withMariaTransactionRetry(unbranded.database, { maxAttempts: 3, allowRetry: () => true }, async () => "never"), /TRANSACTION_BOUNDARY_CAPABILITY_REQUIRED/);
    assert.equal(unbranded.attempts(), 0);
  });

  it("does not execute hostile accessors or proxy traps and preserves the original error", async () => {
    let accessorReads = 0;
    const accessor = new Error("hostile accessor");
    for (const [key, value] of [["code", "ER_DUP_ENTRY"], ["errno", 1062], ["sqlMessage", "Duplicate entry for key 'PRIMARY'"]] as const) {
      Object.defineProperty(accessor, key, { configurable: true, get: () => { accessorReads += 1; return value; } });
    }
    assert.equal(classifyMariaDatabaseError(accessor, { candidate: "a1234567" }).kind, "OTHER");
    await assert.rejects(insertWithCuid8CollisionRetry(async () => { throw accessor; }, { generate: () => "a1234567", maxAttempts: 2 }), (error) => error === accessor);
    assert.equal(accessorReads, 0);

    let proxyTraps = 0;
    const proxy = new Proxy(mariaError("ER_DUP_ENTRY", 1062, "Duplicate entry for key 'PRIMARY'"), {
      get: () => { proxyTraps += 1; throw new Error("HOSTILE_GET"); },
      getOwnPropertyDescriptor: () => { proxyTraps += 1; throw new Error("HOSTILE_DESCRIPTOR"); },
    });
    assert.equal(classifyMariaDatabaseError(proxy, { candidate: "a1234567" }).kind, "OTHER");
    let caughtProxy: unknown;
    try { await insertWithCuid8CollisionRetry(async () => { throw proxy; }, { generate: () => "a1234567", maxAttempts: 2 }); }
    catch (error) { caughtProxy = error; }
    assert.equal(caughtProxy, proxy);
    assert.equal(proxyTraps, 0);
  });

  it("preserves domain denial and deterministic UNIQUE/FK errors without another transaction", async () => {
    for (const error of [
      mariaError("ER_LOCK_DEADLOCK", 1213, "Deadlock found"),
      mariaError("ER_CHECKREAD", 1020, "Record has changed since last read"),
      mariaError("ER_DUP_ENTRY", 1062, "Duplicate entry for key 'uq_business'"),
      mariaError("ER_NO_REFERENCED_ROW_2", 1452, "Cannot add or update a child row"),
    ]) {
      const harness = databaseWithTransactions(async () => { throw error; });
      await assert.rejects(withMariaTransactionRetry(harness.database, { maxAttempts: 3, allowRetry: () => false }, async () => "never"), (caught) => caught === error);
      assert.equal(harness.attempts(), 1);
    }
  });
});
