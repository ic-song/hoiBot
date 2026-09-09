import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { CurrentTransactionDatabaseClient, DatabaseClient, DatabaseTransaction, DatabaseWriteResult, RootTransactionDatabaseClient } from "../src/database.js";
import { CanonicalItemInventoryRepository } from "../src/inventory/canonical-item-inventory-repository.js";

type Write = { sql: string; values: readonly unknown[] };

function database(query: (sql: string) => unknown[] = () => [], onExecute: (sql: string, values: readonly unknown[]) => DatabaseWriteResult | Error = () => ({ affectedRows: 1n, insertId: 0n })): { database: DatabaseClient & RootTransactionDatabaseClient; writes: Write[]; reads: string[] } {
  const writes: Write[] = [];
  const reads: string[] = [];
  const transaction: DatabaseTransaction = {
    query: async <T>(sql: string): Promise<T> => {
      reads.push(sql);
      if (sql.startsWith("SELECT player_id FROM canonical_players WHERE player_id=")) return [{ player_id: "p1234567" }] as T;
      if (sql.startsWith("SELECT item_id FROM canonical_item_definitions WHERE item_id=")) return [{ item_id: "i1234567" }] as T;
      return query(sql) as T;
    },
    execute: async (sql: string, values: readonly unknown[] = []): Promise<DatabaseWriteResult> => {
      writes.push({ sql, values });
      const result = onExecute(sql, values);
      if (result instanceof Error) throw result;
      return result;
    }
  };
  const withRootTransaction = async <T>(work: (tx: DatabaseTransaction) => Promise<T>): Promise<T> => work(transaction);
  return { database: { ping: async () => undefined, verifyRollback: async () => true, query: transaction.query, execute: transaction.execute, withTransaction: withRootTransaction, withRootTransaction, close: async () => undefined }, writes, reads };
}

function replayRow(quantity: bigint, delta = 1n, reason = "REWARD") {
  return { item_inventory_operation_id: "o1234567", operation_status: "completed", resulting_quantity: quantity,
    ledger_entry_id: "l1234567", ledger_player_id: "p1234567", ledger_item_id: "i1234567",
    owned_item_stack_id: "s1234567", owned_item_id: null, quantity_delta: delta, reason_type: reason, ledger_count: 1n };
}

// 빈 stack을 먼저 본 두 요청 중 패배자가 재시작한 뒤, 승자 stack에 별도 수량·원장을 누적하는 상태 기반 경쟁 모형입니다.
function competingFirstStackDatabase(): { database: DatabaseClient; state: { quantity: bigint; operations: Map<string, bigint>; ledgerDeltas: bigint[]; stackInsertAttempts: number; stackUpdated: boolean } } {
  const state = { quantity: 0n, operations: new Map<string, bigint>(), ledgerDeltas: [] as bigint[], stackInsertAttempts: 0, stackUpdated: false };
  let transactionAttempt = 0;
  const withRootTransaction = async <T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> => {
      transactionAttempt += 1;
      let operationKey = "";
      let pendingQuantity: bigint | null = null;
      let pendingLedgerDelta: bigint | null = null;
      const transaction: DatabaseTransaction = {
        query: async <R>(sql: string, values: readonly unknown[] = []): Promise<R> => {
          if (sql.includes("canonical_item_inventory_operations operation")) {
            const existing = state.operations.get(String(values[1]));
            return (existing === undefined ? [] : [replayRow(existing, String(values[1]) === "request-a" ? 2n : 3n)]) as R;
          }
          if (sql.startsWith("SELECT player_id FROM canonical_players")) return [{ player_id: "p1234567" }] as R;
          if (sql.startsWith("SELECT item_id FROM canonical_item_definitions")) return [{ item_id: "i1234567" }] as R;
          if (sql.includes("canonical_owned_item_stacks")) {
            return (state.quantity === 0n ? [] : [{ owned_item_stack_id: "s1234567", quantity: state.quantity }]) as R;
          }
          return [] as R;
        },
        execute: async (sql: string, values: readonly unknown[] = []): Promise<DatabaseWriteResult> => {
          if (sql.includes("INSERT INTO canonical_item_inventory_operations")) operationKey = String(values[2]);
          if (sql.includes("INSERT INTO canonical_owned_item_stacks")) {
            state.stackInsertAttempts += 1;
            if (transactionAttempt === 1) {
              state.quantity = 2n;
              state.operations.set("request-a", 2n);
              state.ledgerDeltas.push(2n);
              throw Object.assign(new Error("Duplicate entry for key 'uq_canonical_owned_item_stacks_player_item'"), { code: "ER_DUP_ENTRY", errno: 1062, sqlMessage: "Duplicate entry for key 'uq_canonical_owned_item_stacks_player_item'" });
            }
          }
          if (sql.startsWith("UPDATE canonical_owned_item_stacks")) { pendingQuantity = BigInt(values[0] as bigint); state.stackUpdated = true; }
          if (sql.includes("INSERT INTO canonical_item_inventory_ledger_entries")) pendingLedgerDelta = BigInt(values[5] as bigint);
          return { affectedRows: 1n, insertId: 0n };
        }
      };
      const result = await work(transaction);
      if (pendingQuantity !== null) state.quantity = pendingQuantity;
      if (pendingLedgerDelta !== null) state.ledgerDeltas.push(pendingLedgerDelta);
      if (operationKey !== "") state.operations.set(operationKey, state.quantity);
      return result;
    };
  const database: DatabaseClient & RootTransactionDatabaseClient = {
    ping: async () => undefined, verifyRollback: async () => true, close: async () => undefined,
    query: async <T>(): Promise<T> => [] as T,
    execute: async (): Promise<DatabaseWriteResult> => ({ affectedRows: 1n, insertId: 0n }),
    withTransaction: withRootTransaction,
    withRootTransaction
  };
  return { database, state };
}

describe("canonical item inventory repository", () => {
  it("preserves the complete emoji and command-guide display name while retrying an item PK collision", async () => {
    const duplicate = Object.assign(new Error("Duplicate entry for key 'PRIMARY'"), { code: "ER_DUP_ENTRY" });
    let definitionAttempts = 0;
    const scripted = database(undefined, (sql) => {
      if (sql.includes("INSERT INTO canonical_item_definitions") && ++definitionAttempts === 1) return duplicate;
      return { affectedRows: 1n, insertId: 0n };
    });
    const candidates = ["a1234567", "b1234567", "c1234567"];
    const repository = new CanonicalItemInventoryRepository(scripted.database, () => candidates.shift()!, 3, () => new Date("2026-06-22T14:30:00.000Z"));
    const name = "다이아상자💎(/다이아상자오픈)";
    const result = await repository.registerDefinition({ actor: "seed", sourceSystem: "LEGACY_JSON", sourceNamespace: "member.bag", sourceIdentifier: name, itemName: name, itemKind: "BOX", stackable: true });
    assert.deepEqual(result, { itemId: "b1234567", replayed: false });
    assert.equal(definitionAttempts, 2);
    const definitionWrite = scripted.writes.find((write) => write.sql.includes("INSERT INTO canonical_item_definitions"));
    assert.ok(definitionWrite);
    assert.equal(definitionWrite.values[1], name);
    assert.equal(definitionWrite.values[10], "seed");
    assert.equal(definitionWrite.values[11], "2026-06-22 23:30:00");
  });

  it("uses the source import mapping as the idempotent definition boundary", async () => {
    const scripted = database((sql) => sql.includes("canonical_item_definition_imports") ? [{ item_id: "a1234567" }] : []);
    const repository = new CanonicalItemInventoryRepository(scripted.database, () => "b1234567");
    const result = await repository.registerDefinition({ actor: "seed", sourceSystem: "LEGACY_JSON", sourceNamespace: "member.bag", sourceIdentifier: "상자", itemName: "상자", itemKind: "BOX", stackable: true });
    assert.deepEqual(result, { itemId: "a1234567", replayed: true });
    assert.equal(scripted.writes.length, 0);
  });

  it("records one stack mutation, ledger entry, and replayable operation in the same transaction", async () => {
    const scripted = database((sql) => sql.includes("canonical_item_inventory_operations") ? [] : sql.includes("canonical_owned_item_stacks") ? [{ owned_item_stack_id: "s1234567", quantity: 2n }] : []);
    const candidates = ["o1234567", "l1234567"];
    const repository = new CanonicalItemInventoryRepository(scripted.database, () => candidates.shift()!, 2, () => new Date("2026-06-22T14:30:00.000Z"));
    const result = await repository.changeStackQuantity({ actor: "system", playerId: "p1234567", itemId: "i1234567", requestKey: "event-1", quantityDelta: 3n, reasonType: "REWARD" });
    assert.deepEqual(result, { quantity: 5n, replayed: false });
    assert.ok(scripted.writes.some((write) => write.sql.includes("canonical_item_inventory_ledger_entries")));
    assert.ok(scripted.writes.some((write) => write.sql.includes("operation_status='completed'")));
    assert.equal(scripted.writes.length, 4);
    assert.deepEqual(scripted.reads.map((sql) => sql.includes("canonical_item_inventory_operations operation") ? "replay" : sql.includes("canonical_players") ? "player" : sql.includes("canonical_item_definitions") ? "definition" : sql.includes("canonical_owned_item_stacks") ? "stack" : "other"), ["replay", "player", "definition", "stack"]);
    assert.ok(scripted.writes.every((write) => !write.sql.includes("item_name") || write.sql.includes("canonical_item_definitions")));
  });

  it("returns a completed operation as replay without another inventory mutation", async () => {
    const scripted = database((sql) => sql.includes("canonical_item_inventory_operations operation") ? [replayRow(7n)] : []);
    const repository = new CanonicalItemInventoryRepository(scripted.database);
    const result = await repository.changeStackQuantity({ actor: "system", playerId: "p1234567", itemId: "i1234567", requestKey: "event-1", quantityDelta: 1n, reasonType: "REWARD" });
    assert.deepEqual(result, { quantity: 7n, replayed: true });
    assert.equal(scripted.writes.length, 0);
  });

  it("treats a player source UNIQUE conflict as a concurrent registration replay, not a CUID collision", async () => {
    let reads = 0;
    const sourceDuplicate = Object.assign(new Error("Duplicate entry for key 'uq_canonical_players_source'"), { code: "ER_DUP_ENTRY" });
    const scripted = database((sql) => sql.includes("canonical_players") && ++reads > 1 ? [{ player_id: "p1234567" }] : [], (sql) => sql.includes("INSERT INTO canonical_players") ? sourceDuplicate : { affectedRows: 1n, insertId: 0n });
    const repository = new CanonicalItemInventoryRepository(scripted.database, () => "a1234567", 2);
    const result = await repository.registerPlayer({ actor: "import", sourceSystem: "LEGACY_JSON", sourceIdentifier: "same-user" });
    assert.deepEqual(result, { playerId: "p1234567", replayed: true });
    assert.equal(scripted.writes.filter((write) => write.sql.includes("INSERT INTO canonical_players")).length, 1);
  });

  it("returns a concurrent identical request from the completed operation rather than retrying its CUID", async () => {
    let reads = 0;
    const requestDuplicate = Object.assign(new Error("Duplicate entry for key 'uq_canonical_item_inventory_operations_player_request'"), { code: "ER_DUP_ENTRY", errno: 1062, sqlMessage: "Duplicate entry for key 'uq_canonical_item_inventory_operations_player_request'" });
    const scripted = database((sql) => sql.includes("canonical_item_inventory_operations operation") && ++reads > 1 ? [replayRow(9n)] : [], (sql) => sql.includes("INSERT INTO canonical_item_inventory_operations") ? requestDuplicate : { affectedRows: 1n, insertId: 0n });
    const repository = new CanonicalItemInventoryRepository(scripted.database, () => "a1234567", 2);
    const result = await repository.changeStackQuantity({ actor: "system", playerId: "p1234567", itemId: "i1234567", requestKey: "same-event", quantityDelta: 1n, reasonType: "REWARD" });
    assert.deepEqual(result, { quantity: 9n, replayed: true });
    assert.equal(scripted.writes.filter((write) => write.sql.includes("INSERT INTO canonical_item_inventory_operations")).length, 1);
  });

  it("restarts a losing different request after first-stack contention and applies its own ledger delta", async () => {
    const scripted = competingFirstStackDatabase();
    const candidates = ["a1234567", "b1234567", "c1234567", "d1234567"];
    const repository = new CanonicalItemInventoryRepository(scripted.database, () => candidates.shift()!, 3);
    const result = await repository.changeStackQuantity({ actor: "system", playerId: "p1234567", itemId: "i1234567", requestKey: "request-b", quantityDelta: 3n, reasonType: "REWARD" });
    assert.deepEqual(result, { quantity: 5n, replayed: false });
    assert.equal(scripted.state.stackInsertAttempts, 1);
    assert.equal(scripted.state.stackUpdated, true);
    assert.equal(scripted.state.quantity, 5n);
    assert.deepEqual(Array.from(scripted.state.operations.entries()).sort((left, right) => left[0].localeCompare(right[0])), [["request-a", 2n], ["request-b", 5n]]);
    assert.deepEqual(scripted.state.ledgerDeltas, [2n, 3n]);
  });

  it("rejects an insufficient debit before creating a ledger entry", async () => {
    const scripted = database((sql) => sql.includes("canonical_item_inventory_operations") ? [] : sql.includes("canonical_owned_item_stacks") ? [{ owned_item_stack_id: "s1234567", quantity: 1n }] : []);
    const repository = new CanonicalItemInventoryRepository(scripted.database, () => "a1234567");
    await assert.rejects(repository.changeStackQuantity({ actor: "system", playerId: "p1234567", itemId: "i1234567", requestKey: "event-1", quantityDelta: -2n, reasonType: "USE" }), /INSUFFICIENT_QUANTITY/);
    assert.equal(scripted.writes.some((write) => write.sql.includes("canonical_item_inventory_ledger_entries")), false);
    assert.equal(scripted.writes.length, 0);
  });

  it("inserts an absent stack directly at its final quantity with exactly four DML statements", async () => {
    const scripted = database(() => []);
    const candidates = ["o1234567", "s1234567", "l1234567"];
    const repository = new CanonicalItemInventoryRepository(scripted.database, () => candidates.shift()!);
    const result = await repository.changeStackQuantity({ actor: "system", playerId: "p1234567", itemId: "i1234567", requestKey: "new-stack", quantityDelta: 4n, reasonType: "REWARD" });
    assert.deepEqual(result, { quantity: 4n, replayed: false });
    assert.equal(scripted.writes.length, 4);
    const insert = scripted.writes.find((write) => write.sql.includes("INSERT INTO canonical_owned_item_stacks"));
    assert.equal(insert?.values[3], 4n);
    assert.equal(scripted.writes.some((write) => write.sql.startsWith("UPDATE canonical_owned_item_stacks")), false);
  });

  it("rejects replay payload drift and a non-terminal or non-single-ledger operation without DML", async () => {
    for (const row of [
      { ...replayRow(2n), ledger_item_id: "j1234567" },
      { ...replayRow(2n), operation_status: "processing" },
      { ...replayRow(2n), ledger_count: 2n },
    ]) {
      const scripted = database((sql) => sql.includes("canonical_item_inventory_operations operation") ? [row] : []);
      const repository = new CanonicalItemInventoryRepository(scripted.database);
      await assert.rejects(repository.changeStackQuantity({ actor: "system", playerId: "p1234567", itemId: "i1234567", requestKey: "event-1", quantityDelta: 1n, reasonType: "REWARD" }), /CANONICAL_ITEM_REPLAY_CORRUPTED/);
      assert.equal(scripted.writes.length, 0);
    }
  });

  it("prevalidates CUID8, signed delta, UINT64 result, ASCII reason, and actor before DML", async () => {
    const scripted = database((sql) => sql.includes("canonical_owned_item_stacks") ? [{ owned_item_stack_id: "s1234567", quantity: MAX_UINT64 }] : []);
    const repository = new CanonicalItemInventoryRepository(scripted.database);
    const valid = { actor: "system", playerId: "p1234567", itemId: "i1234567", requestKey: "event-1", quantityDelta: 1n, reasonType: "REWARD" } as const;
    await assert.rejects(repository.changeStackQuantity({ ...valid, playerId: "bad" }), /CANONICAL_ITEM_ID_INVALID/);
    await assert.rejects(repository.changeStackQuantity({ ...valid, quantityDelta: 9_223_372_036_854_775_808n }), /CANONICAL_ITEM_QUANTITY_DELTA_INVALID/);
    await assert.rejects(repository.changeStackQuantity({ ...valid, reasonType: "보상" }), /CANONICAL_ITEM_REASON_TYPE_INVALID/);
    await assert.rejects(repository.changeStackQuantity({ ...valid, actor: " " }), /OBJECT_AUDIT_ACTOR_INVALID/);
    await assert.rejects(repository.changeStackQuantity(valid), /CANONICAL_ITEM_QUANTITY_OVERFLOW/);
    assert.equal(scripted.writes.length, 0);
  });

  it("uses one current transaction attempt and leaves 1213 retry to the outer owner", async () => {
    const deadlock = Object.assign(new Error("deadlock"), { code: "ER_LOCK_DEADLOCK", errno: 1213 });
    let currentAttempts = 0;
    const transaction: DatabaseTransaction = { query: async () => { throw deadlock; }, execute: async () => ({ affectedRows: 1n, insertId: 0n }) };
    const scoped: DatabaseClient & CurrentTransactionDatabaseClient = {
      ping: async () => undefined, verifyRollback: async () => true, close: async () => undefined,
      query: transaction.query, execute: transaction.execute,
      withTransaction: async () => { throw new Error("nested retry forbidden"); },
      withCurrentTransaction: async (work) => { currentAttempts += 1; return work(transaction); },
    };
    const repository = new CanonicalItemInventoryRepository(scoped);
    await assert.rejects(repository.changeStackQuantity({ actor: "system", playerId: "p1234567", itemId: "i1234567", requestKey: "outer-owned", quantityDelta: 1n, reasonType: "REWARD" }), (error) => error === deadlock);
    assert.equal(currentAttempts, 1);
  });

  it("retries exact 1213 only as fresh root transactions", async () => {
    const scripted = database(() => []);
    const root = scripted.database.withRootTransaction.bind(scripted.database);
    let rootAttempts = 0;
    scripted.database.withRootTransaction = async (work) => {
      rootAttempts += 1;
      if (rootAttempts === 1) throw Object.assign(new Error("deadlock"), { code: "ER_LOCK_DEADLOCK", errno: 1213 });
      return root(work);
    };
    const candidates = ["o1234567", "s1234567", "l1234567"];
    const result = await new CanonicalItemInventoryRepository(scripted.database, () => candidates.shift()!).changeStackQuantity({ actor: "system", playerId: "p1234567", itemId: "i1234567", requestKey: "root-owned", quantityDelta: 1n, reasonType: "REWARD" });
    assert.deepEqual(result, { quantity: 1n, replayed: false });
    assert.equal(rootAttempts, 2);
  });

  it("fails closed on an unrelated 1062 and a code-only pseudo duplicate", async () => {
    for (const error of [
      Object.assign(new Error("Duplicate entry for key 'uq_canonical_item_inventory_ledger_operation'"), { code: "ER_DUP_ENTRY", errno: 1062, sqlMessage: "Duplicate entry for key 'uq_canonical_item_inventory_ledger_operation'" }),
      Object.assign(new Error("Duplicate entry for key 'uq_canonical_owned_item_stacks_player_item'"), { code: "ER_DUP_ENTRY" }),
    ]) {
      const scripted = database(() => [], (sql) => sql.includes("INSERT INTO canonical_item_inventory_operations") ? error : { affectedRows: 1n, insertId: 0n });
      const repository = new CanonicalItemInventoryRepository(scripted.database, () => "o1234567");
      await assert.rejects(repository.changeStackQuantity({ actor: "system", playerId: "p1234567", itemId: "i1234567", requestKey: "fail-closed", quantityDelta: 1n, reasonType: "REWARD" }), (caught) => caught === error);
      assert.equal(scripted.writes.filter((write) => write.sql.includes("INSERT INTO canonical_item_inventory_operations")).length, 1);
    }
  });

  it("keeps caller DML order unchanged while exposing current-transaction capability", () => {
    const petSource = readFileSync(new URL("../src/pet/pet-title-canonical-mutation-provider.ts", import.meta.url), "utf8");
    const raidSource = readFileSync(new URL("../src/raid/raid-strike-seal-canonical-ownership-provider.ts", import.meta.url), "utf8");
    assert.match(petSource, /withCurrentTransaction:\s*\(work\)\s*=>\s*work\(controlledParticipant\(participant\)\)/);
    assert.ok(petSource.indexOf("SELECT quantity FROM canonical_owned_item_stacks") < petSource.indexOf("changeStackQuantity({"));
    assert.ok(raidSource.includes("withCurrentTransaction:<T>(work:(current:DatabaseTransaction)=>Promise<T>)=>work(transaction)"));
    assert.ok(raidSource.indexOf("this.resolve(transaction)") < raidSource.indexOf("changeStackQuantity({"));
  });

  it("keeps definition seed and ownership import separate in the synthetic import contract", () => {
    const fixture = JSON.parse(readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/canonical-item-inventory-seed-v1.json", import.meta.url), "utf8")) as { definitionSeeds: Array<{ itemName: string }>; ownershipImports: unknown[] };
    assert.equal(fixture.definitionSeeds[0]?.itemName, "다이아상자💎(/다이아상자오픈)");
    assert.equal(fixture.ownershipImports.length, 1);
  });
});

const MAX_UINT64 = 18_446_744_073_709_551_615n;
