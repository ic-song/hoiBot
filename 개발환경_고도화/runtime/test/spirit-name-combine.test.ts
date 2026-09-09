import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { ApplicationError } from "../src/shared/application-error.js";
import { isSpiritNameCombineCommand, SpiritNameCombineService } from "../src/pet/spirit-name-combine-service.js";

// 정령 이름변경권 조합 SQL 순서를 기록하는 테스트 DB를 만듭니다.
function createScriptedDatabase(queryResults: unknown[]) {
  const remaining = [...queryResults], sql: string[] = [];
  let insertId = 400n;
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

const owner = { identity_id: 11n, player_id: 21n, current_display_name: "합성회원", rank_emoji: "⭐" };
const chicken = { item_id: 31n, code: "ITEM-RWD-SEASONED-CHICKEN", quantity: 120n, stack_version: 2n };
const newTicket = { item_id: 32n, code: "legacy-spirit-name-change-ticket", quantity: 0n, stack_version: null };

describe("spirit name combine policy", () => {
  it("accepts only the exact legacy command", () => {
    assert.equal(isSpiritNameCombineCommand("/정령이름조합"), true);
    for (const value of ["/정령이름조합 ", "/정령이름조합 1", "/정령이름조합방법"]) {
      assert.equal(isSpiritNameCombineCommand(value), false);
    }
  });
});

describe("spirit name combine service", () => {
  it("spends 100 chickens and creates a missing ticket stack atomically", async () => {
    const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [], [chicken, newTicket]]);
    const result = await new SpiritNameCombineService(scripted.database).handle({
      externalUserId: "kakao-11", channelId: "room-1", message: "/정령이름조합", eventId: "event-spirit-combine"
    });
    assert.equal(result.status, "crafted");
    assert.deepEqual({ chicken: result.chickenQuantity, ticket: result.ticketQuantity }, { chicken: "20", ticket: "1" });
    assert.equal(result.data, "[⭐합성회원] 님\n정령 이름변경권📝 조합이 완료되었습니다");
    for (const fragment of ["UPDATE inventory_stacks", "INSERT INTO inventory_stacks", "INSERT INTO inventory_ledger",
      "INSERT INTO command_executions", "INSERT INTO command_audit", "INSERT INTO outbox_messages"]) {
      assert.ok(scripted.sql.some((statement) => statement.includes(fragment)), fragment);
    }
  });

  it("rejects fewer than 100 chickens before mutation", async () => {
    const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [], [{ ...chicken, quantity: 99n }, newTicket]]);
    await assert.rejects(() => new SpiritNameCombineService(scripted.database).handle({
      externalUserId: "kakao-11", channelId: "room-1", message: "/정령이름조합", eventId: "event-short"
    }), (error: unknown) => error instanceof ApplicationError && error.code === "SEASONED_CHICKEN_REQUIRED");
    assert.equal(scripted.sql.some((statement) => statement.includes("UPDATE inventory_stacks")), false);
  });

  it("keeps the legacy silent block during an active castle siege", async () => {
    const scripted = createScriptedDatabase([[{ active_count: 1n }]]);
    const result = await new SpiritNameCombineService(scripted.database).handle({
      externalUserId: "kakao-11", channelId: "room-1", message: "/정령이름조합", eventId: "event-siege"
    });
    assert.deepEqual(result, { status: "blocked_by_castle_siege" });
    assert.equal(scripted.sql.length, 1);
  });
});
