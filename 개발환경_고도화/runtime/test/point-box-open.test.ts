import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { isPointBoxOpenCommand, PointBoxOpenService } from "../src/inventory/point-box-open-service.js";
import { ApplicationError } from "../src/shared/application-error.js";

const owner = { identity_id: 11n, player_id: 21n, current_display_name: "합성회원 남", tier_code: "seedling" };
function scripted(results: unknown[]) {
  const left = [...results]; const sql: string[] = []; let id = 10n;
  const tx: DatabaseTransaction = { query: async <T>(q: string): Promise<T> => { sql.push(q); return left.shift() as T; }, execute: async (q: string): Promise<DatabaseWriteResult> => { sql.push(q); id++; return { affectedRows: 1n, insertId: id }; } };
  const database: DatabaseClient = { ping: async () => undefined, verifyRollback: async () => true, query: async () => { throw new Error("unexpected"); }, execute: async () => { throw new Error("unexpected"); }, withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(tx), close: async () => undefined };
  return { database, sql };
}
describe("point box guard", () => it("keeps exact/full numeric legacy guard", () => {
  for (const v of ["/포인트상자오픈", "/포인트상자오픈 0", "/포인트상자오픈\t002"]) assert.equal(isPointBoxOpenCommand(v), true);
  for (const v of ["/포인트상자오픈 ", "/포인트상자오픈 -1", "/포인트상자오픈 2 안내"]) assert.equal(isPointBoxOpenCommand(v), false);
}));
describe("point box transaction", () => {
  it("caps count and commits inventory plus currency ledgers", async () => {
    const db = scripted([[{ active_count: 0n }], [owner], [], [{ item_id: 51n, quantity: 3n, version: 2n }], [{ balance: "9000000000000000", version: 3n }]]);
    const result = await new PointBoxOpenService(db.database).handle({ externalUserId: "synthetic", channelId: "room", message: "/포인트상자오픈 99", eventId: "point-normal" });
    assert.deepEqual({ count: result.effectiveOpenCount, reward: result.rewardTotal, point: result.pointAfter }, { count: "3", reward: "300000000", point: "9000000300000000" });
    for (const part of ["DELETE FROM inventory_stacks", "UPDATE currency_accounts", "INSERT INTO inventory_ledger", "INSERT INTO currency_ledger", "INSERT INTO command_executions"]) assert.ok(db.sql.some((q) => q.includes(part)), part);
  });
  it("rejects zero after confirming a positive stack", async () => {
    const db = scripted([[{ active_count: 0n }], [owner], [], [{ item_id: 51n, quantity: 1n, version: 2n }]]);
    await assert.rejects(() => new PointBoxOpenService(db.database).handle({ externalUserId: "synthetic", channelId: "room", message: "/포인트상자오픈 0", eventId: "point-zero" }), (e: unknown) => e instanceof ApplicationError && e.code === "INVALID_POINT_BOX_OPEN");
  });
});
