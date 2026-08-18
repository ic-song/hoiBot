import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { SpiritCombineService, isSpiritCombineCommand } from "../src/crafting/spirit-combine-service.js";
import { ApplicationError } from "../src/shared/application-error.js";

// 정령조합 SQL 순서와 mutation 유무를 기록하는 테스트 DB를 만듭니다.
function createScriptedDatabase(queryResults: unknown[]) {
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
      sql.push(statement);
      insertId += 1n;
      return { affectedRows: 1n, insertId };
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

const owner = { identity_id: 11n, player_id: 21n, current_display_name: "테스트알파", tier_code: "seedling" };
const fragments = { item_id: 61n, code: "bag_9b3e69dbd2e91260", quantity: 20n, version: 2n };
const stones = { item_id: 62n, code: "bag_55b34cbde0088b29", quantity: 5n, version: 3n };

describe("spirit combine policy", () => {
  it("accepts omission or one numeric quantity only", () => {
    for (const message of ["/정령조합", "/정령조합 0", "/정령조합 2"]) assert.equal(isSpiritCombineCommand(message), true);
    for (const message of ["/정령조합 ", "/정령조합 -1", "/정령조합 2 안내", "/정령조합2"]) assert.equal(isSpiritCombineCommand(message), false);
  });
});

describe("spirit combine service", () => {
  it("keeps the legacy silent block during an active castle siege", async () => {
    const scripted = createScriptedDatabase([[{ active_count: 1n }]]);
    const result = await new SpiritCombineService(scripted.database).handle({ externalUserId: "kakao-11", channelId: "room-1", message: "/정령조합", eventId: "event-siege" });
    assert.deepEqual(result, { status: "blocked_by_castle_siege" });
    assert.equal(scripted.sql.some((statement) => statement.startsWith("UPDATE ") || statement.startsWith("INSERT ")), false);
  });

  it("converts fragments to stones atomically with exact legacy reply", async () => {
    const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [], [stones, fragments]]);
    const result = await new SpiritCombineService(scripted.database).handle({ externalUserId: "kakao-11", channelId: "room-1", message: "/정령조합 2", eventId: "event-spirit" });
    assert.deepEqual({ count: result.craftQuantity, fragments: result.fragmentQuantity, stones: result.stoneQuantity }, { count: "2", fragments: "0", stones: "7" });
    assert.equal(result.data, "2개를 조합합니다\n[🌱테스트알파] 님\n정령 강화석🥀 조합 2개 완성");
    for (const fragment of ["UPDATE inventory_stacks", "INSERT INTO inventory_ledger", "INSERT INTO command_executions", "INSERT INTO command_audit", "INSERT INTO outbox_messages"]) {
      assert.ok(scripted.sql.some((statement) => statement.includes(fragment)), fragment);
    }
  });

  it("preserves the legacy zero-quantity success when fragments are held", async () => {
    const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [], [stones, fragments]]);
    const result = await new SpiritCombineService(scripted.database).handle({ externalUserId: "kakao-11", channelId: "room-1", message: "/정령조합 0", eventId: "event-zero" });
    assert.equal(result.craftQuantity, "0");
    assert.equal(result.fragmentQuantity, "20");
    assert.equal(result.stoneQuantity, "5");
  });

  it("creates the output stack when the item definition exists without a player stack", async () => {
    const noStoneStack = { ...stones, quantity: null, version: null };
    const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [], [noStoneStack, fragments]]);
    const result = await new SpiritCombineService(scripted.database).handle({ externalUserId: "kakao-11", channelId: "room-1", message: "/정령조합", eventId: "event-new-stack" });
    assert.equal(result.stoneQuantity, "1");
    assert.ok(scripted.sql.some((statement) => statement.startsWith("INSERT INTO inventory_stacks")));
  });

  it("reports exact fragment shortage without mutation", async () => {
    const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [], [stones, { ...fragments, quantity: 19n }]]);
    await assert.rejects(
      () => new SpiritCombineService(scripted.database).handle({ externalUserId: "kakao-11", channelId: "room-1", message: "/정령조합 2", eventId: "event-short" }),
      (error: unknown) => error instanceof ApplicationError && error.code === "SPIRIT_FRAGMENT_REQUIRED" && error.message === "정령조각🥀 20개가 필요해요!"
    );
    assert.equal(scripted.sql.some((statement) => statement.startsWith("UPDATE ") || statement.startsWith("INSERT ")), false);
  });
});
