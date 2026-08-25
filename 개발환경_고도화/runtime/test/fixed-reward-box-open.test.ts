import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { FixedRewardBoxOpenService, isFixedRewardBoxOpenCommand, normalizeFixedRewardBoxOpenDispatchMessage } from "../src/inventory/fixed-reward-box-open-service.js";

// 고정 보상 박스 SQL 순서와 원자 mutation을 기록하는 테스트 DB를 만듭니다.
function scriptedDatabase(queryResults: unknown[]) {
  const remaining = [...queryResults];
  const sql: string[] = [];
  let insertId = 1000n;
  const transaction: DatabaseTransaction = {
    query: async <T>(statement: string): Promise<T> => { sql.push(statement); return remaining.shift() as T; },
    execute: async (statement: string): Promise<DatabaseWriteResult> => { sql.push(statement); insertId += 1n; return { affectedRows: 1n, insertId }; }
  };
  const database: DatabaseClient = {
    ping: async () => undefined, verifyRollback: async () => true,
    query: async () => { throw new Error("Unexpected non-transactional query."); },
    execute: async () => { throw new Error("Unexpected non-transactional execute."); },
    withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(transaction), close: async () => undefined
  };
  return { database, sql };
}

const owner = { identity_id: 11n, player_id: 21n };
const shopRule = { command_code: "INVENTORY_SHOP_OPEN_DUNGEON_BOX_OPEN", source_item_id: 31n,
  source_display_name: "샵오픈던전박스🏡(/샵오픈박스오픈)", reward_item_id: 32n,
  reward_display_name: "펫스윗홈인테리어샵🖼️(/샵오픈)", reward_quantity: 70n };

describe("fixed reward box command policy", () => {
  it("accepts only exact no-arg and positive integer forms", () => {
    for (const command of ["/양계장박스오픈", "/양계장박스오픈 3", "/샵오픈박스오픈", "/샵오픈박스오픈 99"]) {
      assert.equal(isFixedRewardBoxOpenCommand(command), true);
      assert.equal(normalizeFixedRewardBoxOpenDispatchMessage(command).includes(" "), false);
    }
    for (const command of [undefined, "/양계장박스오픈 0", "/샵오픈박스오픈 ", "/샵오픈박스오픈 1 안내", "/샵오픈박스오픈2"]) {
      assert.equal(isFixedRewardBoxOpenCommand(command), false);
    }
  });
});

describe("fixed reward box service", () => {
  it("clamps to owned boxes and writes source/reward ledgers atomically", async () => {
    const scripted = scriptedDatabase([[owner], [], [shopRule], [
      { item_id: 31n, quantity: 2n, version: 1n }, { item_id: 32n, quantity: 5n, version: 4n }
    ]]);
    const result = await new FixedRewardBoxOpenService(scripted.database).handle({
      externalUserId: "kakao-1", channelId: "room-1", message: "/샵오픈박스오픈 9", eventId: "fixed-open-1"
    });
    assert.deepEqual({ status: result.status, opened: result.openedQuantity, source: result.sourceQuantity,
      reward: result.rewardQuantity, balance: result.rewardBalance },
    { status: "opened", opened: "2", source: "0", reward: "140", balance: "145" });
    for (const fragment of ["UPDATE inventory_stacks", "INSERT INTO inventory_ledger", "INSERT INTO command_executions", "INSERT INTO command_audit", "INSERT INTO outbox_messages"]) {
      assert.ok(scripted.sql.some((statement) => statement.includes(fragment)), fragment);
    }
  });

  it("returns a durable no-box response without inventory mutation", async () => {
    const scripted = scriptedDatabase([[owner], [], [shopRule], [
      { item_id: 31n, quantity: 0n, version: 1n }, { item_id: 32n, quantity: 5n, version: 4n }
    ]]);
    const result = await new FixedRewardBoxOpenService(scripted.database).handle({
      externalUserId: "kakao-1", channelId: "room-1", message: "/샵오픈박스오픈", eventId: "fixed-open-empty"
    });
    assert.equal(result.status, "no_box");
    assert.equal(scripted.sql.some((statement) => statement.startsWith("UPDATE inventory_stacks")), false);
  });

  it("returns the stored result without a second mutation", async () => {
    const replay = { status: "opened", openedQuantity: "1", sourceQuantity: "2", rewardQuantity: "10", rewardBalance: "10", data: "stored" } as const;
    const scripted = scriptedDatabase([[owner], [{ result_json: JSON.stringify(replay) }]]);
    assert.deepEqual(await new FixedRewardBoxOpenService(scripted.database).handle({
      externalUserId: "kakao-1", channelId: "room-1", message: "/양계장박스오픈", eventId: "fixed-open-replay"
    }), replay);
    assert.equal(scripted.sql.some((statement) => statement.startsWith("UPDATE ") || statement.startsWith("INSERT ")), false);
  });
});
