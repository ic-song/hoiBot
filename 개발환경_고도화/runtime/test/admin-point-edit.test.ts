import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPointEditCommandCandidate } from "../src/admin/iris-admin-command-service.js";
import { CurrencyService } from "../src/currency/currency-service.js";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";

// 포인트 절대값 설정의 SQL 순서와 원자 mutation을 기록하는 테스트 DB를 만듭니다.
function scriptedDatabase(queryResults: unknown[]) {
  const remaining = [...queryResults];
  const sql: string[] = [];
  let insertId = 900n;
  const transaction: DatabaseTransaction = {
    query: async <T>(statement: string): Promise<T> => { sql.push(statement); return remaining.shift() as T; },
    execute: async (statement: string): Promise<DatabaseWriteResult> => {
      sql.push(statement); insertId += 1n; return { affectedRows: 1n, insertId };
    }
  };
  const database: DatabaseClient = {
    ping: async () => undefined, verifyRollback: async () => true,
    query: async <T>(): Promise<T> => remaining.shift() as T,
    execute: async () => ({ affectedRows: 1n, insertId: 0n }),
    withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(transaction),
    close: async () => undefined
  };
  return { database, sql };
}

describe("admin point edit command boundary", () => {
  it("accepts only target and nonnegative integer amount", () => {
    for (const message of ["/포인트수정 회원 0", "/포인트수정 여러 단어 회원 250"]) assert.equal(isPointEditCommandCandidate(message), true);
    for (const message of ["/포인트수정", "/포인트수정 회원 -1", "/포인트수정 회원 1.5", "/포인트수정 회원 2 안내"]) assert.equal(isPointEditCommandCandidate(message), false);
  });
});

describe("currency absolute set provider", () => {
  it("calculates delta under lock and writes account, ledger, audit, execution and outbox", async () => {
    const scripted = scriptedDatabase([[], [{ code: "point" }], [{ balance: "100.000", version: 4n }]]);
    const result = await new CurrencyService(scripted.database).setAbsolute({
      playerId: "21", targetDisplayName: "합성회원", currencyCode: "point", balance: "250",
      reasonCode: "admin_point_edit", reason: "합성 검증", idempotencyKey: "event-point-1",
      actor: { type: "admin_operator", id: "7" }, sourceCode: "iris", sourceEventId: "event-point-1", irisReplyDestinationId: "room-1"
    });
    assert.deepEqual({ previous: result.previousBalance, balance: result.balance, delta: result.delta, version: result.version },
      { previous: "100", balance: "250", delta: "150", version: "5" });
    assert.equal(result.data, "✅ 포인트 수정 완료\n[합성회원] 100 → 250");
    for (const fragment of ["UPDATE currency_accounts", "INSERT INTO currency_ledger", "INSERT INTO command_audit", "INSERT INTO command_executions", "INSERT INTO outbox_messages"]) {
      assert.ok(scripted.sql.some((statement) => statement.includes(fragment)), fragment);
    }
  });

  it("allows zero and records a negative delta without a negative target balance", async () => {
    const scripted = scriptedDatabase([[], [{ code: "point" }], [{ balance: "100.000", version: 1n }]]);
    const result = await new CurrencyService(scripted.database).setAbsolute({
      playerId: "21", targetDisplayName: "합성회원", currencyCode: "point", balance: "0",
      reasonCode: "admin_point_edit", reason: "합성 0 검증", idempotencyKey: "event-point-zero",
      actor: { type: "admin_operator", id: "7" }, sourceCode: "iris"
    });
    assert.equal(result.delta, "-100");
    assert.equal(result.balance, "0");
  });
});
