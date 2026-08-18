import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { CombineAllService, readCombineAllVariant } from "../src/crafting/combine-all-service.js";
import { ApplicationError } from "../src/shared/application-error.js";

// 전체조합 SQL 순서와 mutation 유무를 기록하는 테스트 DB를 만듭니다.
function createScriptedDatabase(queryResults: unknown[]) {
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

const owner = { identity_id: 11n, player_id: 21n };
const fragments20 = { item_id: 61n, code: "bag_9b3e69dbd2e91260", quantity: 20n, version: 2n };
const fragments27 = { ...fragments20, quantity: 27n };
const stones = { item_id: 62n, code: "bag_55b34cbde0088b29", quantity: 5n, version: 3n };
const command = (message: string, eventId = "event-combine-all") => ({ externalUserId: "kakao-11", channelId: "room-1", message, eventId });

describe("combine-all command policy", () => {
  it("keeps both commands exact and separate", () => {
    assert.equal(readCombineAllVariant("/전체조합"), "primary");
    assert.equal(readCombineAllVariant("/전체조합2"), "secondary");
    for (const message of ["/전체조합 ", "/전체조합 1", "/전체조합2 ", "/전체조합2 안내", "/정리", "ㅇㅇㅇ"]) {
      assert.equal(readCombineAllVariant(message), null);
    }
  });
});

describe("combine-all legacy parity", () => {
  it("silently blocks /전체조합 during an active castle siege", async () => {
    const scripted = createScriptedDatabase([[{ active_count: 1n }]]);
    assert.deepEqual(await new CombineAllService(scripted.database).handle(command("/전체조합")), { status: "blocked_by_castle_siege", variant: "primary" });
    assert.equal(scripted.sql.some((sql) => /^(INSERT|UPDATE|DELETE)/.test(sql)), false);
  });

  it("silently ignores an unregistered /전체조합 sender", async () => {
    const scripted = createScriptedDatabase([[{ active_count: 0n }], []]);
    assert.deepEqual(await new CombineAllService(scripted.database).handle(command("/전체조합")), { status: "ignored_unregistered", variant: "primary" });
  });

  it("keeps /전체조합2 outside the local siege guard while honoring the shared silent member gate", async () => {
    const scripted = createScriptedDatabase([[]]);
    assert.deepEqual(await new CombineAllService(scripted.database).handle(command("/전체조합2")), { status: "ignored_unregistered", variant: "secondary" });
    assert.equal(scripted.sql.some((sql) => sql.includes("castle_battle_seasons")), false);
  });

  it("converts the maximum quantity and preserves the remainder", async () => {
    const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [], [stones, fragments27]]);
    const result = await new CombineAllService(scripted.database).handle(command("/전체조합"));
    assert.deepEqual(
      { status: result.status, variant: result.variant, count: result.craftQuantity, fragments: result.fragmentQuantity, stones: result.stoneQuantity, data: result.data },
      { status: "crafted", variant: "primary", count: "2", fragments: "7", stones: "7", data: "🛠️ 전체 조합 결과\n- 정령 강화석🥀 x 2" }
    );
    assert.ok(scripted.sql.some((sql) => sql.startsWith("UPDATE inventory_stacks")));
    for (const expected of ["inventory_ledger", "command_executions", "command_audit", "outbox_messages"]) {
      assert.ok(scripted.sql.some((sql) => sql.includes(expected)), expected);
    }
  });

  it("deletes the exhausted fragment stack like the legacy bag property", async () => {
    const scripted = createScriptedDatabase([[owner], [], [stones, fragments20]]);
    const result = await new CombineAllService(scripted.database).handle(command("/전체조합2", "event-secondary"));
    assert.equal(result.fragmentQuantity, "0");
    assert.ok(scripted.sql.some((sql) => sql.startsWith("DELETE FROM inventory_stacks")));
    assert.equal(scripted.sql.some((sql) => sql.includes("castle_battle_seasons")), false);
  });

  it("returns the exact no-material reply through the application error path", async () => {
    const short = { ...fragments20, quantity: 9n };
    const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [], [stones, short]]);
    await assert.rejects(
      () => new CombineAllService(scripted.database).handle(command("/전체조합")),
      (error: unknown) => error instanceof ApplicationError && error.code === "NO_COMBINABLE_SPIRIT_FRAGMENTS" && error.message === "❌ 조합 가능한 재료가 없습니다."
    );
    assert.equal(scripted.sql.some((sql) => /^(INSERT|UPDATE|DELETE)/.test(sql)), false);
  });
});
