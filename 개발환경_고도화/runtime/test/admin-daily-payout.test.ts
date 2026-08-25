import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { AdminDailyPayoutService, isAdminDailyPayoutCommand } from "../src/admin/daily-payout-service.js";

// 관리자 지급 SQL 순서와 mutation 유무를 기록하는 테스트 DB를 만듭니다.
function scriptedDatabase(queryResults: unknown[]) {
  const remaining = [...queryResults]; const sql: string[] = []; let insertId = 900n;
  const transaction: DatabaseTransaction = { query: async <T>(statement: string): Promise<T> => { sql.push(statement); if (remaining.length === 0) throw new Error(`Unexpected query: ${statement}`); return remaining.shift() as T; }, execute: async (statement: string): Promise<DatabaseWriteResult> => { sql.push(statement); insertId++; return { affectedRows: 1n, insertId }; } };
  const database: DatabaseClient = { ping: async () => undefined, verifyRollback: async () => true, query: async () => { throw new Error("Unexpected query"); }, execute: async () => { throw new Error("Unexpected execute"); }, withTransaction: async <T>(work: (tx: DatabaseTransaction) => Promise<T>) => work(transaction), close: async () => undefined };
  return { database, sql };
}

const operator = { operator_id: 11n, identity_id: 21n };
const policy = { policy_code: "legacy-admin-daily-v1", payout_amount: "1000000000.000", display_amount: "1000000000.000", version: 1n };
const recipients = [{ operator_id: 11n, player_id: 31n, current_display_name: "관리자1" }, { operator_id: 12n, player_id: 32n, current_display_name: "관리자2" }];
const accounts = [{ player_id: 31n, balance: "10.000", version: 1n }, { player_id: 32n, balance: "20.000", version: 2n }];

describe("admin daily payout policy", () => {
  it("accepts only the exact command", () => { assert.equal(isAdminDailyPayoutCommand("/관리자일당"), true); for (const value of ["/관리자일당 ", "/관리자일당 1", "/관리자일당추가"]) assert.equal(isAdminDailyPayoutCommand(value), false); });
});

describe("admin daily payout service", () => {
  it("pays every active linked admin in one audited transaction", async () => {
    const scripted = scriptedDatabase([[operator], [policy], [], recipients, accounts]);
    const result = await new AdminDailyPayoutService(scripted.database).handle({ externalUserId: "operator", channelId: "room", message: "/관리자일당", eventId: "event-normal" });
    assert.deepEqual({ status: result.status, count: result.recipientCount, amount: result.payoutAmount }, { status: "paid", count: "2", amount: "1000000000" });
    assert.equal(result.data, "관리자 2명에게 10억 포인트 지급을 완료했습니다.");
    for (const fragment of ["UPDATE currency_accounts", "INSERT INTO currency_ledger", "INSERT INTO admin_daily_payout_grants", "INSERT INTO command_audit", "INSERT INTO outbox_messages"]) assert.ok(scripted.sql.some((statement) => statement.includes(fragment)), fragment);
  });
  it("keeps an unauthorized identity completely silent and mutation-free", async () => {
    const scripted = scriptedDatabase([[]]);
    assert.deepEqual(await new AdminDailyPayoutService(scripted.database).handle({ externalUserId: "unknown", channelId: "room", message: "/관리자일당", eventId: "event-denied" }), { status: "ignored_unauthorized" });
    assert.equal(scripted.sql.length, 1);
  });
  it("replays the same event without querying recipients or writing again", async () => {
    const prior = { status: "paid", recipientCount: "2", payoutAmount: "1000000000", data: "prior" };
    const scripted = scriptedDatabase([[operator], [policy], [{ result_json: JSON.stringify(prior) }]]);
    const result = await new AdminDailyPayoutService(scripted.database).handle({ externalUserId: "operator", channelId: "room", message: "/관리자일당", eventId: "event-replay" });
    assert.equal(result.duplicate, true); assert.equal(scripted.sql.some((statement) => statement.includes("currency_accounts")), false);
  });
});
