import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { DiamondBoxOpenService, isDiamondBoxOpenCommand, normalizeDiamondBoxOpenDispatchMessage } from "../src/inventory/diamond-box-open-service.js";

// 다이아 상자 SQL 순서와 원자 mutation을 기록하는 테스트 DB를 만듭니다.
function scriptedDatabase(queryResults: unknown[]) {
  const remaining = [...queryResults];
  const sql: string[] = [];
  let insertId = 900n;
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
const box = { item_id: 53n, quantity: 5n, version: 2n };

describe("diamond box open command policy", () => {
  it("accepts only exact no-arg and positive integer forms", () => {
    for (const message of ["/다이아상자오픈", "/다이아상자오픈 1", "/다이아상자오픈 999999999999999999999999"]) {
      assert.equal(isDiamondBoxOpenCommand(message), true);
      assert.equal(normalizeDiamondBoxOpenDispatchMessage(message), "/다이아상자오픈");
    }
    for (const message of [undefined, "/다이아상자오픈 ", "/다이아상자오픈 0", "/다이아상자오픈 1 안내", "/다이아상자오픈2"]) {
      assert.equal(isDiamondBoxOpenCommand(message), false);
    }
  });
});

describe("diamond box open service", () => {
  it("opens min(requested, owned) and writes inventory plus diamond ledgers atomically", async () => {
    const scripted = scriptedDatabase([[owner], [], [box], [{ balance: "7.000", version: 3n }]]);
    const result = await new DiamondBoxOpenService(scripted.database).handle({
      externalUserId: "kakao-1", channelId: "room-1", message: "/다이아상자오픈 9", eventId: "event-open"
    });
    assert.deepEqual(
      { status: result.status, opened: result.openedQuantity, boxes: result.boxQuantity, diamonds: result.diamondBalance },
      { status: "opened", opened: "5", boxes: "0", diamonds: "12" }
    );
    for (const fragment of ["UPDATE inventory_stacks", "INSERT INTO inventory_ledger", "UPDATE currency_accounts",
      "INSERT INTO currency_ledger", "INSERT INTO command_executions", "INSERT INTO command_audit", "INSERT INTO outbox_messages"]) {
      assert.ok(scripted.sql.some((statement) => statement.includes(fragment)), fragment);
    }
  });

  it("records a durable no-box reply without changing inventory or currency", async () => {
    const scripted = scriptedDatabase([[owner], [], [{ ...box, quantity: 0n }]]);
    const result = await new DiamondBoxOpenService(scripted.database).handle({
      externalUserId: "kakao-1", channelId: "room-1", message: "/다이아상자오픈", eventId: "event-empty"
    });
    assert.equal(result.status, "no_box");
    assert.equal(scripted.sql.some((statement) => statement.includes("UPDATE inventory_stacks")), false);
    assert.equal(scripted.sql.some((statement) => statement.includes("currency_accounts")), false);
  });

  it("returns the stored result without a second mutation", async () => {
    const replay = { status: "opened", playerId: "21", openedQuantity: "2", boxQuantity: "3", diamondBalance: "9", outboxId: "8", auditId: "7", data: "stored" } as const;
    const scripted = scriptedDatabase([[owner], [{ result_json: JSON.stringify(replay) }]]);
    assert.deepEqual(await new DiamondBoxOpenService(scripted.database).handle({
      externalUserId: "kakao-1", channelId: "room-1", message: "/다이아상자오픈 2", eventId: "event-replay"
    }), replay);
    assert.equal(scripted.sql.some((statement) => statement.startsWith("UPDATE ") || statement.startsWith("INSERT ")), false);
  });
});
