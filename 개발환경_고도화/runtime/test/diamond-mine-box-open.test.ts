import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { DiamondMineBoxOpenService, isDiamondMineBoxOpenCommand, normalizeDiamondMineBoxOpenDispatchMessage } from "../src/inventory/diamond-mine-box-open-service.js";

// 광산 박스 변환 SQL과 mutation 유무를 기록하는 테스트 DB를 만듭니다.
function scriptedDatabase(queryResults: unknown[]) {
  const remaining = [...queryResults];
  const sql: string[] = [];
  let insertId = 950n;
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
const items = [{ id: 53n, code: "ITEM-RWD-053" }, { id: 70n, code: "ITEM-DIAMOND-MINE-BOX" }];
const stacks = [{ item_id: 53n, quantity: "2", version: "3" }, { item_id: 70n, quantity: "5", version: "1" }];

describe("diamond mine box command policy", () => {
  it("accepts only no-arg and positive integer forms", () => {
    for (const message of ["/다이아박스오픈", "/다이아박스오픈 1", "/다이아박스오픈   999999999999999999999"]) {
      assert.equal(isDiamondMineBoxOpenCommand(message), true);
      assert.equal(normalizeDiamondMineBoxOpenDispatchMessage(message), "/다이아박스오픈");
    }
    for (const message of [undefined, "/다이아박스오픈 ", "/다이아박스오픈 0", "/다이아박스오픈 1 안내", "/다이아박스오픈2"]) {
      assert.equal(isDiamondMineBoxOpenCommand(message), false);
    }
  });
});

describe("diamond mine box open service", () => {
  it("converts min(requested, owned) into reward boxes with two inventory ledgers", async () => {
    const scripted = scriptedDatabase([[owner], [], items, stacks]);
    const result = await new DiamondMineBoxOpenService(scripted.database).handle({
      externalUserId: "kakao-1", channelId: "room-1", message: "/다이아박스오픈 9", eventId: "event-open"
    });
    assert.deepEqual(
      { status: result.status, opened: result.openedQuantity, source: result.sourceQuantity, reward: result.rewardQuantity },
      { status: "opened", opened: "5", source: "0", reward: "7" }
    );
    assert.equal(scripted.sql.filter((statement) => statement.startsWith("UPDATE inventory_stacks")).length, 2);
    for (const fragment of ["INSERT INTO inventory_ledger", "INSERT INTO command_executions", "INSERT INTO command_audit", "INSERT INTO outbox_messages"]) {
      assert.ok(scripted.sql.some((statement) => statement.includes(fragment)), fragment);
    }
  });

  it("records a durable no-box reply without changing stacks", async () => {
    const scripted = scriptedDatabase([[owner], [], items, [{ ...stacks[0]! }, { ...stacks[1]!, quantity: "0" }]]);
    const result = await new DiamondMineBoxOpenService(scripted.database).handle({
      externalUserId: "kakao-1", channelId: "room-1", message: "/다이아박스오픈", eventId: "event-empty"
    });
    assert.equal(result.status, "no_box");
    assert.equal(scripted.sql.some((statement) => statement.startsWith("UPDATE inventory_stacks")), false);
  });

  it("returns the stored result without a second mutation", async () => {
    const replay = { status: "opened", playerId: "21", openedQuantity: "2", sourceQuantity: "3", rewardQuantity: "4", outboxId: "8", auditId: "7", data: "stored" } as const;
    const scripted = scriptedDatabase([[owner], [{ result_json: JSON.stringify(replay) }]]);
    assert.deepEqual(await new DiamondMineBoxOpenService(scripted.database).handle({
      externalUserId: "kakao-1", channelId: "room-1", message: "/다이아박스오픈 2", eventId: "event-replay"
    }), replay);
    assert.equal(scripted.sql.some((statement) => statement.startsWith("UPDATE ") || statement.startsWith("INSERT ")), false);
  });
});
