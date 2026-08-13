import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { ApplicationError } from "../src/shared/application-error.js";
import { CastleBattleResetCraftService, isCastleBattleResetCraftCommand } from "../src/castle/castle-battle-reset-craft-service.js";

// 조합 Service의 SQL 순서와 mutation 유무를 기록하는 테스트 DB를 만듭니다.
function createScriptedDatabase(queryResults: unknown[]) {
  const remaining = [...queryResults];
  const sql: string[] = [];
  let insertId = 400n;
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
    ping: async () => undefined,
    verifyRollback: async () => true,
    query: async () => { throw new Error("Unexpected non-transactional query."); },
    execute: async () => { throw new Error("Unexpected non-transactional execute."); },
    withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(transaction),
    close: async () => undefined
  };
  return { database, sql };
}

const owner = { identity_id: 11n, player_id: 21n };
const items = [
  { item_id: 41n, code: "legacy-seasoned-chicken", quantity: 12n, version: 2n },
  { item_id: 42n, code: "legacy-castle-battle-reset-ticket", quantity: 0n, version: 3n }
];

describe("castle battle reset craft policy", () => {
  it("accepts omission or one numeric quantity only", () => {
    for (const message of ["/캐슬대전조합", "/캐슬대전조합 0", "/캐슬대전조합 2"]) {
      assert.equal(isCastleBattleResetCraftCommand(message), true);
    }
    for (const message of ["/캐슬대전조합 ", "/캐슬대전조합 -1", "/캐슬대전조합 2 안내", "/캐슬대전조합2"]) {
      assert.equal(isCastleBattleResetCraftCommand(message), false);
    }
  });
});

describe("castle battle reset craft service", () => {
  it("spends six chickens per ticket and persists both ledgers atomically", async () => {
    const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [], items]);
    const result = await new CastleBattleResetCraftService(scripted.database).handle({
      externalUserId: "kakao-11", channelId: "room-1", message: "/캐슬대전조합 2", eventId: "event-castle-craft"
    });
    assert.deepEqual(
      { status: result.status, count: result.craftQuantity, chicken: result.chickenQuantity, ticket: result.ticketQuantity },
      { status: "crafted", count: "2", chicken: "0", ticket: "2" }
    );
    assert.equal(result.data, "캐슬대전리셋권🐶 2개가 완성되었습니다!\n/캐슬대전 으로 대전에 참여하세요!");
    for (const fragment of ["UPDATE inventory_stacks", "INSERT INTO inventory_ledger", "INSERT INTO command_executions",
      "INSERT INTO command_audit", "INSERT INTO outbox_messages", "UPDATE operations SET status = 'completed'"]) {
      assert.ok(scripted.sql.some((statement) => statement.includes(fragment)), fragment);
    }
  });

  it("reports the multiplied chicken shortage without mutation", async () => {
    const shortItems = [{ ...items[0], quantity: 11n }, items[1]];
    const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [], shortItems]);
    await assert.rejects(
      () => new CastleBattleResetCraftService(scripted.database).handle({
        externalUserId: "kakao-11", channelId: "room-1", message: "/캐슬대전조합 2", eventId: "event-short"
      }),
      (error: unknown) => error instanceof ApplicationError && error.code === "SEASONED_CHICKEN_REQUIRED"
        && error.message === "양념치킨🐔 12마리가 필요해요!"
    );
    assert.equal(scripted.sql.some((statement) => statement.includes("UPDATE inventory_stacks")), false);
  });

  it("keeps the legacy silent block during an active siege", async () => {
    const scripted = createScriptedDatabase([[{ active_count: 1n }]]);
    const result = await new CastleBattleResetCraftService(scripted.database).handle({
      externalUserId: "kakao-11", channelId: "room-1", message: "/캐슬대전조합", eventId: "event-siege"
    });
    assert.deepEqual(result, { status: "blocked_by_castle_siege" });
    assert.equal(scripted.sql.some((statement) => statement.includes("inventory_stacks")), false);
  });
});
