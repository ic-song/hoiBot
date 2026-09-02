import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { parseCanonicalCurrencyBalanceMinorAmount, parseCanonicalCurrencyMinorAmount } from "../src/currency/canonical-currency-amount.js";
import { MariaCanonicalCurrencyRepository } from "../src/currency/maria-canonical-currency-repository.js";

const playerId = "a1b2c3d4";
const currencyId = "e5f6g7h8";
const unsignedBigintMax = 18_446_744_073_709_551_615n;

function transactionFor(query: (sql: string) => unknown, writes: Array<{ sql: string; values: readonly unknown[] }>): DatabaseTransaction {
  return {
    query: async <T>(sql: string): Promise<T> => query(sql) as T,
    execute: async (sql: string, values: readonly unknown[] = []): Promise<DatabaseWriteResult> => {
      writes.push({ sql, values });
      return { affectedRows: 1n, insertId: 0n };
    },
  };
}

function databaseFor(query: (sql: string) => unknown, writes: Array<{ sql: string; values: readonly unknown[] }>): DatabaseClient {
  const transaction = transactionFor(query, writes);
  return { ...transaction, ping: async () => undefined, verifyRollback: async () => true, withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(transaction), close: async () => undefined };
}

function adjustment(requestKey = "evt-1") {
  return { actor: "tester", playerId, currencyId, deltaMinorAmount: 5n, operationKind: "credit", reasonKey: "fixture", requestKey };
}

function replayRow() {
  return { currency_operation_id: "m1n2p3q4", player_currency_balance_id: "i1j2k3m4", operation_kind: "credit", payload_fingerprint: "", balance_after_minor_amount: "9007199254740993005" };
}

function adjustmentFingerprint(input = adjustment()): string {
  return createHash("sha256").update(JSON.stringify([
    ["currencyId", input.currencyId], ["deltaMinorAmount", input.deltaMinorAmount.toString()],
    ["operationKind", input.operationKind], ["reasonKey", input.reasonKey],
  ]), "utf8").digest("hex");
}

function definitionInput() {
  return { actor: "tester", sourceSystem: "LEGACY_JSON", sourceNamespace: "memberCurrency", sourceIdentifier: "point", currencyName: "포인트", decimalPlaces: 3, active: true };
}

function definitionFingerprint(): string {
  return createHash("sha256").update(JSON.stringify([["currencyName", "포인트"], ["decimalPlaces", 3], ["active", true]]), "utf8").digest("hex");
}

function lockError(errno: 1205 | 1213, exposeAs: "code" | "errno" = "code"): Error & { code?: string; errno?: number } {
  const error = new Error(errno === 1205 ? "lock wait timeout" : "deadlock") as Error & { code?: string; errno?: number };
  if (exposeAs === "code") error.code = errno === 1205 ? "ER_LOCK_WAIT_TIMEOUT" : "ER_LOCK_DEADLOCK";
  else error.errno = errno;
  return error;
}

describe("canonical currency amount", () => {
  it("converts unsafe and fractional source strings to minor-unit bigint without Number", () => {
    assert.equal(parseCanonicalCurrencyMinorAmount("1000311850886090.5", 3), 1_000_311_850_886_090_500n);
    assert.equal(parseCanonicalCurrencyMinorAmount("742", 0), 742n);
  });

  it("fails closed for excess precision, malformed text, and signed BIGINT overflow", () => {
    assert.throws(() => parseCanonicalCurrencyMinorAmount("1.0001", 3), /SOURCE_PRECISION_EXCEEDED/);
    assert.throws(() => parseCanonicalCurrencyMinorAmount("not-a-number", 3), /SOURCE_AMOUNT_INVALID/);
    assert.throws(() => parseCanonicalCurrencyMinorAmount("9223372036854775.808", 3), /SOURCE_AMOUNT_OUT_OF_RANGE/);
    assert.throws(() => parseCanonicalCurrencyBalanceMinorAmount("-0.5", 3), /NEGATIVE_BALANCE_QUARANTINED/);
  });

  it("keeps the synthetic conversion fixture aligned", () => {
    const fixture = JSON.parse(readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/canonical-currency-ledger-v1.json", import.meta.url), "utf8")) as { conversionCases: Array<{ source: string; decimalPlaces: number; minorAmount?: string; disposition: string }> };
    for (const entry of fixture.conversionCases.filter((row) => row.disposition === "accept")) assert.equal(parseCanonicalCurrencyBalanceMinorAmount(entry.source, entry.decimalPlaces).toString(), entry.minorAmount);
  });
});

describe("MariaCanonicalCurrencyRepository", () => {
  it("atomically updates an unsafe-number-sized balance and appends one operation and ledger entry", async () => {
    const writes: Array<{ sql: string; values: readonly unknown[] }> = [];
    const database = databaseFor((sql) => {
      if (sql.includes("canonical_currency_operations")) return [];
      if (sql.includes("canonical_currency_definitions")) return [{ currency_id: currencyId, active_flag: true }];
      if (sql.includes("canonical_player_currency_balances")) return [{ player_currency_balance_id: "i1j2k3m4", balance_minor_amount: "9007199254740993000" }];
      if (sql.includes("object_identity_crosswalks")) return [];
      return [];
    }, writes);
    const result = await new MariaCanonicalCurrencyRepository(database).adjustBalance(adjustment());
    assert.equal(result.balanceAfterMinorAmount, 9_007_199_254_740_993_005n);
    assert.equal(result.replayed, false);
    const update = writes.find((entry) => entry.sql.startsWith("UPDATE canonical_player_currency_balances"));
    assert.equal(update?.values[0], "9007199254740993005");
    assert.equal(writes.filter((entry) => entry.sql.startsWith("INSERT INTO canonical_currency_operations")).length, 1);
    assert.equal(writes.filter((entry) => entry.sql.startsWith("INSERT INTO canonical_currency_ledger_entries")).length, 1);
  });

  it("replays an already committed request without balance or ledger writes", async () => {
    const writes: Array<{ sql: string; values: readonly unknown[] }> = [];
    let capturedFingerprint = "";
    const db = databaseFor((sql) => {
      if (sql.includes("canonical_currency_operations")) return [{ ...replayRow(), payload_fingerprint: capturedFingerprint }];
      return [];
    }, writes);
    const repository = new MariaCanonicalCurrencyRepository(db);
    // Capture the deterministic fingerprint from the first attempted insert in a separate fixture DB.
    const warmWrites: Array<{ sql: string; values: readonly unknown[] }> = [];
    const warm = databaseFor((sql) => sql.includes("canonical_currency_definitions") ? [{ currency_id: currencyId, active_flag: true }] : sql.includes("canonical_player_currency_balances") ? [{ player_currency_balance_id: "i1j2k3m4", balance_minor_amount: "0" }] : [], warmWrites);
    await new MariaCanonicalCurrencyRepository(warm).adjustBalance(adjustment());
    capturedFingerprint = String(warmWrites.find((entry) => entry.sql.startsWith("INSERT INTO canonical_currency_operations"))?.values[7]);
    const result = await repository.adjustBalance(adjustment());
    assert.equal(result.replayed, true);
    assert.equal(writes.length, 0);
  });

  it("rejects debit underflow inside the transaction", async () => {
    const writes: Array<{ sql: string; values: readonly unknown[] }> = [];
    const db = databaseFor((sql) => sql.includes("canonical_currency_definitions") ? [{ currency_id: currencyId, active_flag: 1 }] : sql.includes("canonical_player_currency_balances") ? [{ player_currency_balance_id: "i1j2k3m4", balance_minor_amount: "4" }] : [], writes);
    await assert.rejects(() => new MariaCanonicalCurrencyRepository(db).adjustBalance({ ...adjustment(), deltaMinorAmount: -5n, operationKind: "debit" }), /BALANCE_INSUFFICIENT/);
    assert.equal(writes.some((entry) => entry.sql.startsWith("UPDATE canonical_player_currency_balances")), false);
  });

  it("accepts request key 182 and rejects 183 before opening a transaction", async () => {
    let transactions = 0;
    const writes: Array<{ sql: string; values: readonly unknown[] }> = [];
    const transaction = transactionFor((sql) => sql.includes("canonical_currency_definitions") ? [{ currency_id: currencyId, active_flag: 1 }] : sql.includes("canonical_player_currency_balances") ? [{ player_currency_balance_id: "i1j2k3m4", balance_minor_amount: "0" }] : [], writes);
    const db: DatabaseClient = { ...transaction, ping: async () => undefined, verifyRollback: async () => true, withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => { transactions += 1; return work(transaction); }, close: async () => undefined };
    await new MariaCanonicalCurrencyRepository(db).adjustBalance(adjustment("r".repeat(182)));
    assert.equal(transactions, 1);
    await assert.rejects(() => new MariaCanonicalCurrencyRepository(db).adjustBalance(adjustment("r".repeat(183))), /REQUEST_KEY_INVALID/);
    assert.equal(transactions, 1);
  });

  it("retries a deadlocked transaction and performs the committed mutation only once", async () => {
    let transactions = 0;
    const writes: Array<{ sql: string; values: readonly unknown[] }> = [];
    const transaction = transactionFor((sql) => sql.includes("canonical_currency_definitions") ? [{ currency_id: currencyId, active_flag: 1 }] : sql.includes("canonical_player_currency_balances") ? [{ player_currency_balance_id: "i1j2k3m4", balance_minor_amount: "7" }] : [], writes);
    const db: DatabaseClient = {
      ...transaction, ping: async () => undefined, verifyRollback: async () => true, close: async () => undefined,
      query: async <T>(): Promise<T> => [] as T,
      withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>): Promise<T> => {
        transactions += 1;
        if (transactions === 1) throw Object.assign(new Error("deadlock"), { code: "ER_LOCK_DEADLOCK", errno: 1213 });
        return work(transaction);
      },
    };
    const result = await new MariaCanonicalCurrencyRepository(db).adjustBalance(adjustment());
    assert.equal(transactions, 2);
    assert.equal(result.balanceAfterMinorAmount, 12n);
    assert.equal(writes.filter((entry) => entry.sql.startsWith("INSERT INTO canonical_currency_ledger_entries")).length, 1);
  });

  it("returns committed replay after a business-unique collision instead of applying again", async () => {
    let transactions = 0;
    let fingerprint = "";
    const writes: Array<{ sql: string; values: readonly unknown[] }> = [];
    const transaction = transactionFor((sql) => sql.includes("canonical_currency_definitions") ? [{ currency_id: currencyId, active_flag: 1 }] : sql.includes("canonical_player_currency_balances") ? [{ player_currency_balance_id: "i1j2k3m4", balance_minor_amount: "1" }] : [], writes);
    const db: DatabaseClient = {
      ...transaction, ping: async () => undefined, verifyRollback: async () => true, close: async () => undefined,
      query: async <T>(): Promise<T> => [{ ...replayRow(), payload_fingerprint: fingerprint }] as T,
      withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>): Promise<T> => {
        transactions += 1;
        const result = await work(transaction);
        fingerprint = String(writes.find((entry) => entry.sql.startsWith("INSERT INTO canonical_currency_operations"))?.values[7]);
        throw Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY", errno: 1062, result });
      },
    };
    const result = await new MariaCanonicalCurrencyRepository(db).adjustBalance(adjustment());
    assert.equal(transactions, 1);
    assert.equal(result.replayed, true);
    assert.equal(result.balanceAfterMinorAmount, 9_007_199_254_740_993_005n);
  });

  it("allows the exact unsigned BIGINT maximum and rejects maximum plus one before any write", async () => {
    const exactWrites: Array<{ sql: string; values: readonly unknown[] }> = [];
    const exactDb = databaseFor((sql) => sql.includes("canonical_currency_definitions") ? [{ currency_id: currencyId, active_flag: 1 }] : sql.includes("canonical_player_currency_balances") ? [{ player_currency_balance_id: "i1j2k3m4", balance_minor_amount: (unsignedBigintMax - 5n).toString() }] : [], exactWrites);
    const exact = await new MariaCanonicalCurrencyRepository(exactDb).adjustBalance(adjustment());
    assert.equal(exact.balanceAfterMinorAmount, unsignedBigintMax);

    const overflowWrites: Array<{ sql: string; values: readonly unknown[] }> = [];
    const overflowDb = databaseFor((sql) => sql.includes("canonical_currency_definitions") ? [{ currency_id: currencyId, active_flag: 1 }] : sql.includes("canonical_player_currency_balances") ? [{ player_currency_balance_id: "i1j2k3m4", balance_minor_amount: unsignedBigintMax.toString() }] : [], overflowWrites);
    await assert.rejects(() => new MariaCanonicalCurrencyRepository(overflowDb).adjustBalance({ ...adjustment(), deltaMinorAmount: 1n }), /BALANCE_OVERFLOW/);
    assert.equal(overflowWrites.length, 0);
  });

  it("rejects every payload dimension change on the same player request key without writes", async () => {
    const original = adjustment();
    const prior = { ...replayRow(), payload_fingerprint: adjustmentFingerprint(original), balance_after_minor_amount: "5" };
    const variants = [
      { ...original, currencyId: "f6g7h8j9" },
      { ...original, deltaMinorAmount: 6n },
      { ...original, operationKind: "debit" },
      { ...original, reasonKey: "different" },
    ];
    for (const variant of variants) {
      const writes: Array<{ sql: string; values: readonly unknown[] }> = [];
      const db = databaseFor((sql) => sql.includes("canonical_currency_operations") ? [prior] : [], writes);
      await assert.rejects(() => new MariaCanonicalCurrencyRepository(db).adjustBalance(variant), /REQUEST_PAYLOAD_CONFLICT/);
      assert.equal(writes.length, 0);
    }
  });

  for (const exposeAs of ["code", "errno"] as const) {
    it(`retries 1205 exposed as ${exposeAs} and succeeds on the second transaction`, async () => {
      let transactions = 0;
      const writes: Array<{ sql: string; values: readonly unknown[] }> = [];
      const transaction = transactionFor((sql) => sql.includes("canonical_currency_definitions") ? [{ currency_id: currencyId, active_flag: 1 }] : sql.includes("canonical_player_currency_balances") ? [{ player_currency_balance_id: "i1j2k3m4", balance_minor_amount: "1" }] : [], writes);
      const db: DatabaseClient = { ...transaction, ping: async () => undefined, verifyRollback: async () => true, close: async () => undefined, query: async <T>(): Promise<T> => [] as T, withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>): Promise<T> => { transactions += 1; if (transactions === 1) throw lockError(1205, exposeAs); return work(transaction); } };
      const result = await new MariaCanonicalCurrencyRepository(db).adjustBalance(adjustment());
      assert.equal(transactions, 2);
      assert.equal(result.balanceAfterMinorAmount, 6n);
      assert.equal(writes.filter((entry) => entry.sql.startsWith("INSERT INTO canonical_currency_ledger_entries")).length, 1);
    });
  }

  for (const errno of [1205, 1213] as const) {
    it(`stops after exactly three persistent ${errno} transaction failures and preserves the original error`, async () => {
      let transactions = 0;
      const original = lockError(errno, "errno");
      const writes: Array<{ sql: string; values: readonly unknown[] }> = [];
      const transaction = transactionFor(() => [], writes);
      const db: DatabaseClient = { ...transaction, ping: async () => undefined, verifyRollback: async () => true, close: async () => undefined, query: async <T>(): Promise<T> => [] as T, withTransaction: async <T>(): Promise<T> => { transactions += 1; throw original; } };
      await assert.rejects(() => new MariaCanonicalCurrencyRepository(db).adjustBalance(adjustment()), (error: unknown) => error === original);
      assert.equal(transactions, 3);
      assert.equal(writes.length, 0);
    });
  }

  for (const failure of [lockError(1205, "code"), lockError(1213, "errno"), Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY", errno: 1062 })]) {
    it(`registerDefinition returns committed replay after ${failure.code ?? failure.errno}`, async () => {
      let transactions = 0;
      const writes: Array<{ sql: string; values: readonly unknown[] }> = [];
      const transaction = transactionFor(() => [], writes);
      const db: DatabaseClient = { ...transaction, ping: async () => undefined, verifyRollback: async () => true, close: async () => undefined, query: async <T>(): Promise<T> => [{ currency_id: currencyId, payload_fingerprint: definitionFingerprint() }] as T, withTransaction: async <T>(): Promise<T> => { transactions += 1; throw failure; } };
      const result = await new MariaCanonicalCurrencyRepository(db).registerDefinition(definitionInput());
      assert.deepEqual(result, { currencyId, replayed: true });
      assert.equal(transactions, 1);
      assert.equal(writes.length, 0);
    });
  }

  it("registerDefinition rejects a committed replay with a different payload without writes", async () => {
    const writes: Array<{ sql: string; values: readonly unknown[] }> = [];
    const db = databaseFor((sql) => sql.includes("canonical_currency_definition_imports") ? [{ currency_id: currencyId, payload_fingerprint: "different" }] : [], writes);
    await assert.rejects(() => new MariaCanonicalCurrencyRepository(db).registerDefinition(definitionInput()), /DEFINITION_PAYLOAD_CONFLICT/);
    assert.equal(writes.length, 0);
  });

  for (const errno of [1205, 1213] as const) {
    it(`registerDefinition stops after three persistent ${errno} failures and preserves the original error`, async () => {
      let transactions = 0;
      const original = lockError(errno, errno === 1205 ? "code" : "errno");
      const writes: Array<{ sql: string; values: readonly unknown[] }> = [];
      const transaction = transactionFor(() => [], writes);
      const db: DatabaseClient = { ...transaction, ping: async () => undefined, verifyRollback: async () => true, close: async () => undefined, query: async <T>(): Promise<T> => [] as T, withTransaction: async <T>(): Promise<T> => { transactions += 1; throw original; } };
      await assert.rejects(() => new MariaCanonicalCurrencyRepository(db).registerDefinition(definitionInput()), (error: unknown) => error === original);
      assert.equal(transactions, 3);
      assert.equal(writes.length, 0);
    });
  }
});
