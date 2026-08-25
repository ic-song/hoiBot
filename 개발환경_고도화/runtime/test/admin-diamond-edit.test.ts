import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAdminDiamondEditCommand, normalizeAdminDiamondEditDispatchMessage } from "../src/admin/admin-diamond-edit-service.js";
import { CurrencyService } from "../src/currency/currency-service.js";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";

// 관리자 다이아 변경의 SQL 순서와 실제 차감량을 기록하는 테스트 DB를 만듭니다.
function scriptedDatabase(queryResults: unknown[]) {
  const remaining = [...queryResults];
  const sql: string[] = [];
  let insertId = 700n;
  const transaction: DatabaseTransaction = {
    query: async <T>(statement: string): Promise<T> => { sql.push(statement); return remaining.shift() as T; },
    execute: async (statement: string): Promise<DatabaseWriteResult> => {
      sql.push(statement); insertId += 1n; return { affectedRows: 1n, insertId };
    }
  };
  const database: DatabaseClient = {
    ping: async () => undefined,
    verifyRollback: async () => true,
    query: async <T>(): Promise<T> => remaining.shift() as T,
    execute: async () => ({ affectedRows: 1n, insertId: 0n }),
    withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(transaction),
    close: async () => undefined
  };
  return { database, sql };
}

describe("admin diamond edit command boundary", () => {
  it("accepts only add/subtract with a target and positive integer amount", () => {
    for (const message of ["/다이아추가 회원 1", "/다이아차감 여러 단어 회원 250"]) assert.equal(isAdminDiamondEditCommand(message), true);
    for (const message of ["/다이아추가", "/다이아추가 회원 0", "/다이아차감 회원 -1", "/다이아추가 회원 2 안내"]) assert.equal(isAdminDiamondEditCommand(message), false);
  });

  it("normalizes parameterized aliases for DB dispatch", () => {
    assert.equal(normalizeAdminDiamondEditDispatchMessage("/다이아추가 여러 단어 회원 5"), "/다이아추가");
    assert.equal(normalizeAdminDiamondEditDispatchMessage("/다이아차감 회원 5"), "/다이아차감");
  });
});

describe("admin diamond currency provider", () => {
  it("adds the requested amount and writes account, ledger, audit, execution and outbox", async () => {
    const scripted = scriptedDatabase([[], [{ code: "diamond" }], [{ balance: "10.000", version: 2n }]]);
    const result = await new CurrencyService(scripted.database).adjustByAdmin({
      playerId: "21", targetDisplayName: "합성회원", currencyCode: "diamond", mode: "add", amount: "5",
      reasonCode: "admin_diamond_add", reason: "합성 검증", idempotencyKey: "event-add-1",
      actor: { type: "admin_operator", id: "7" }, sourceCode: "iris", sourceEventId: "event-add-1", irisReplyDestinationId: "room-1"
    });
    assert.deepEqual({ previous: result.previousBalance, actual: result.actualAmount, balance: result.balance },
      { previous: "10", actual: "5", balance: "15" });
    assert.equal(result.data, "✅ 다이아 추가 완료\n[합성회원] +5 (보유 15)");
    for (const fragment of ["UPDATE currency_accounts", "INSERT INTO currency_ledger", "INSERT INTO command_audit", "INSERT INTO command_executions", "INSERT INTO outbox_messages"]) {
      assert.ok(scripted.sql.some((statement) => statement.includes(fragment)), fragment);
    }
  });

  it("subtracts only the locked available balance when the request is larger", async () => {
    const scripted = scriptedDatabase([[], [{ code: "diamond" }], [{ balance: "10.000", version: 2n }]]);
    const result = await new CurrencyService(scripted.database).adjustByAdmin({
      playerId: "21", targetDisplayName: "합성회원", currencyCode: "diamond", mode: "subtract", amount: "20",
      reasonCode: "admin_diamond_subtract", reason: "합성 검증", idempotencyKey: "event-subtract-1",
      actor: { type: "admin_operator", id: "7" }, sourceCode: "iris", sourceEventId: "event-subtract-1", irisReplyDestinationId: "room-1"
    });
    assert.deepEqual({ requested: result.requestedAmount, actual: result.actualAmount, balance: result.balance },
      { requested: "20", actual: "10", balance: "0" });
    assert.equal(result.data, "✅ 다이아 차감 완료\n[합성회원] -10 (보유 0)");
  });
});
