import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { InventoryBulkSellService, isInventoryBulkSellCommand } from "../src/inventory/bulk-sell-service.js";

// 전체판매 SQL 순서와 mutation 유무를 기록하는 테스트 DB를 만듭니다.
function scriptedDatabase(queryResults: unknown[]) {
  const remaining = [...queryResults];
  const sql: string[] = [];
  let insertId = 800n;
  const transaction: DatabaseTransaction = {
    query: async <T>(statement: string): Promise<T> => {
      sql.push(statement);
      if (remaining.length === 0) throw new Error(`Unexpected query: ${statement}`);
      return remaining.shift() as T;
    },
    execute: async (statement: string): Promise<DatabaseWriteResult> => {
      sql.push(statement); insertId += 1n; return { affectedRows: 1n, insertId };
    }
  };
  const database: DatabaseClient = {
    ping: async () => undefined, verifyRollback: async () => true,
    query: async () => { throw new Error("Unexpected non-transactional query."); },
    execute: async () => { throw new Error("Unexpected non-transactional execute."); },
    withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(transaction),
    close: async () => undefined
  };
  return { database, sql };
}

const owner = { identity_id: 11n, player_id: 21n };
const stacks = [
  { item_id: 51n, code: "ITEM-SELL-A", display_name: "판매품A", quantity: 2n, version: 1n, unit_price: "100000.000" },
  { item_id: 52n, code: "ITEM-SELL-B", display_name: "판매품B", quantity: 1n, version: 3n, unit_price: "100000.000" }
];

describe("inventory bulk sell command policy", () => {
  it("accepts only the exact command", () => {
    assert.equal(isInventoryBulkSellCommand("/전체판매"), true);
    for (const message of [undefined, "/전체판매 ", "/전체판매 1", "/전체판매 안내", "/전체판매2"]) {
      assert.equal(isInventoryBulkSellCommand(message), false);
    }
  });
});

describe("inventory bulk sell service", () => {
  it("keeps the legacy silent block during an active castle siege", async () => {
    const scripted = scriptedDatabase([[{ active_count: 1n }]]);
    assert.deepEqual(await new InventoryBulkSellService(scripted.database).handle({
      externalUserId: "kakao-1", channelId: "room-1", message: "/전체판매", eventId: "event-siege"
    }), { status: "blocked_by_castle_siege" });
    assert.equal(scripted.sql.some((statement) => statement.startsWith("INSERT ") || statement.startsWith("UPDATE ")), false);
  });

  it("silently ignores an unregistered user", async () => {
    const scripted = scriptedDatabase([[{ active_count: 0n }], []]);
    assert.deepEqual(await new InventoryBulkSellService(scripted.database).handle({
      externalUserId: "unknown", channelId: "room-1", message: "/전체판매", eventId: "event-unknown"
    }), { status: "ignored_unregistered" });
  });

  it("sells only FK-policy allowed stacks and credits quantity times unit price atomically", async () => {
    const scripted = scriptedDatabase([[{ active_count: 0n }], [owner], [], stacks, [{ balance: "500.000", version: 4n }]]);
    const result = await new InventoryBulkSellService(scripted.database).handle({
      externalUserId: "kakao-1", channelId: "room-1", message: "/전체판매", eventId: "event-sell"
    });
    assert.deepEqual({ status: result.status, quantity: result.soldQuantity, delta: result.pointDelta, balance: result.pointBalance },
      { status: "sold", quantity: "3", delta: "300000", balance: "300500" });
    assert.equal(result.data, "가방 전체 판매가 완료되었습니다.\n판매 수량: 3개\n획득 포인트: 🅟300,000");
    assert.ok(scripted.sql.some((statement) => statement.includes("JOIN item_sale_policies policy") && statement.includes("policy.sellable=TRUE")));
    assert.equal(scripted.sql.filter((statement) => statement.includes("UPDATE inventory_stacks")).length, 2);
    for (const fragment of ["INSERT INTO inventory_ledger", "UPDATE currency_accounts", "INSERT INTO currency_ledger",
      "INSERT INTO command_executions", "INSERT INTO command_audit", "INSERT INTO outbox_messages"]) {
      assert.ok(scripted.sql.some((statement) => statement.includes(fragment)), fragment);
    }
  });

  it("records a stable reply without currency mutation when only protected items remain", async () => {
    const scripted = scriptedDatabase([[{ active_count: 0n }], [owner], [], []]);
    const result = await new InventoryBulkSellService(scripted.database).handle({
      externalUserId: "kakao-1", channelId: "room-1", message: "/전체판매", eventId: "event-empty"
    });
    assert.equal(result.status, "nothing_to_sell");
    assert.equal(result.data, "판매할 수 있는 아이템이 없습니다.");
    assert.equal(scripted.sql.some((statement) => statement.includes("currency_accounts")), false);
  });

  it("returns the stored result without a second mutation", async () => {
    const replay = { status: "sold", playerId: "21", soldQuantity: "2", pointDelta: "200000", pointBalance: "200000", outboxId: "9", data: "stored", auditId: "8" } as const;
    const scripted = scriptedDatabase([[{ active_count: 0n }], [owner], [{ result_json: JSON.stringify(replay) }]]);
    assert.deepEqual(await new InventoryBulkSellService(scripted.database).handle({
      externalUserId: "kakao-1", channelId: "room-1", message: "/전체판매", eventId: "event-replay"
    }), replay);
    assert.equal(scripted.sql.some((statement) => statement.startsWith("UPDATE ") || statement.startsWith("INSERT ")), false);
  });
});
