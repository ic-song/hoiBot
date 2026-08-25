import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { isBagSellCommand, parseBagSellCommand } from "../src/inventory/bag-sell.js";
import { BagSellService } from "../src/inventory/bag-sell-service.js";
import { MariaBagSellRepository } from "../src/inventory/maria-bag-sell-repository.js";

// Maria 판매 repository가 실행한 query와 write 순서를 기록합니다.
function scriptedDatabase(queryResults: unknown[]) {
  const queued = [...queryResults];
  const sql: string[] = [];
  let insertId = 10n;
  const transaction: DatabaseTransaction = {
    query: async <T>(statement: string): Promise<T> => {
      sql.push(statement);
      return (queued.shift() ?? []) as T;
    },
    execute: async (statement: string): Promise<DatabaseWriteResult> => {
      sql.push(statement);
      insertId += 1n;
      return { affectedRows: 1n, insertId };
    }
  };
  const database: DatabaseClient = {
    ping: async () => undefined,
    verifyRollback: async () => true,
    query: transaction.query,
    execute: transaction.execute,
    withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(transaction),
    close: async () => undefined
  };
  return { database, sql };
}

const target = {
  snapshot_id: 3n,
  item_id: 7n,
  item_code: "bag_sell_test",
  catalog_object_key: "item.bag_sell_test",
  stack_version: 4n,
  snapshot_quantity: 5n,
  display_name: "판매 테스트",
  metadata_json: "{}"
};

describe("bag sell command", () => {
  it("accepts only a complete item sequence and optional numeric quantity", () => {
    assert.equal(isBagSellCommand("/판매"), true);
    assert.deepEqual(parseBagSellCommand("/판매 2"), { displaySeq: 2, quantity: null });
    assert.deepEqual(parseBagSellCommand("/판매 2 0"), { displaySeq: 2, quantity: 0n });
    assert.deepEqual(parseBagSellCommand("/판매 2 3"), { displaySeq: 2, quantity: 3n });
    for (const message of ["/판매0", "/판매 0", "/판매 1 -1", "/판매 1 2 해줘", " /판매 1"]) {
      assert.equal(isBagSellCommand(message), false);
      assert.equal(parseBagSellCommand(message), null);
    }
  });

  it("returns usage without repository access for a bare command", async () => {
    let called = false;
    const result = await new BagSellService({
      sell: async () => {
        called = true;
        throw new Error("unexpected");
      }
    }).execute({
      providerCode: "kakao",
      externalUserId: "user",
      channelId: "room",
      eventId: "event",
      message: "/판매"
    });
    assert.equal(result.status, "invalid_command");
    assert.equal(called, false);
  });

  it("mutates only the stable snapshot item and writes both ledgers atomically", async () => {
    const scripted = scriptedDatabase([
      [{ player_id: 1n }],
      [],
      [target],
      [{ quantity: 5n, version: 4n }],
      [{ balance: "1000.000", version: 2n }]
    ]);
    const result = await new MariaBagSellRepository(scripted.database).sell({
      providerCode: "kakao",
      externalUserId: "user",
      channelId: "room",
      eventId: "sell-event",
      message: "/판매 2 3",
      displaySeq: 2,
      quantity: 3n
    });
    assert.equal(result.status, "sold");
    assert.equal(result.definitionId, "7");
    assert.equal(result.catalogObjectKey, "item.bag_sell_test");
    assert.equal(result.quantity, "3");
    assert.equal(result.pointDelta, "300000");
    assert.ok(scripted.sql.some((sql) => sql.includes("UPDATE inventory_stacks")));
    assert.ok(scripted.sql.some((sql) => sql.includes("INSERT INTO inventory_ledger")));
    assert.ok(scripted.sql.some((sql) => sql.includes("INSERT INTO currency_ledger")));
    assert.ok(scripted.sql.some((sql) => sql.includes("INSERT INTO command_audit")));
    assert.ok(scripted.sql.some((sql) => sql.includes("INSERT INTO outbox_messages")));
  });

  it("rejects a reordered or changed bag snapshot before creating an operation", async () => {
    const scripted = scriptedDatabase([
      [{ player_id: 1n }],
      [],
      [target],
      [{ quantity: 6n, version: 5n }]
    ]);
    const result = await new MariaBagSellRepository(scripted.database).sell({
      providerCode: "kakao",
      externalUserId: "user",
      channelId: "room",
      eventId: "stale-event",
      message: "/판매 2 1",
      displaySeq: 2,
      quantity: 1n
    });
    assert.equal(result.status, "stale_snapshot");
    assert.equal(scripted.sql.some((sql) => sql.includes("INSERT INTO operations")), false);
  });

  it("replays a completed event without a second inventory mutation", async () => {
    const prior = {
      status: "sold",
      data: "prior",
      definitionId: "7",
      quantity: "1",
      pointDelta: "100000"
    };
    const scripted = scriptedDatabase([[{ player_id: 1n }], [{ result_json: prior }]]);
    const result = await new MariaBagSellRepository(scripted.database).sell({
      providerCode: "kakao",
      externalUserId: "user",
      channelId: "room",
      eventId: "same-event",
      message: "/판매 1 1",
      displaySeq: 1,
      quantity: 1n
    });
    assert.equal(result.replayed, true);
    assert.equal(scripted.sql.some((sql) => sql.includes("UPDATE inventory_stacks")), false);
  });

  it("preserves the legacy zero-quantity success without inventory decrement", async () => {
    const scripted = scriptedDatabase([
      [{ player_id: 1n }],
      [],
      [target],
      [{ quantity: 5n, version: 4n }],
      [{ balance: "1000.000", version: 2n }]
    ]);
    const result = await new MariaBagSellRepository(scripted.database).sell({
      providerCode: "kakao",
      externalUserId: "user",
      channelId: "room",
      eventId: "zero-event",
      message: "/판매 2 0",
      displaySeq: 2,
      quantity: 0n
    });
    assert.equal(result.status, "sold");
    assert.equal(result.pointDelta, "0");
    assert.equal(scripted.sql.some((sql) => sql.includes("INSERT INTO inventory_ledger")), false);
  });
});
