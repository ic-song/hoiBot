import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { RandomBoxCraftService, isRandomBoxCraftCommand } from "../src/crafting/random-box-craft-service.js";
import { ApplicationError } from "../src/shared/application-error.js";

// 랜덤박스 조합 SQL 순서와 mutation 유무를 기록하는 테스트 DB를 만듭니다.
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
    ping: async () => undefined,
    verifyRollback: async () => true,
    query: async () => { throw new Error("Unexpected non-transactional query."); },
    execute: async () => { throw new Error("Unexpected non-transactional execute."); },
    withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(transaction),
    close: async () => undefined
  };
  return { database, sql };
}

const owner = { identity_id: 11n, player_id: 21n, current_display_name: "합성회원 남", tier_code: "seedling" };
const items = [
  { item_id: 61n, code: "legacy-heart", quantity: 40n, version: 2n },
  { item_id: 62n, code: "legacy-random-box", quantity: 0n, version: 3n }
];

describe("random box craft policy", () => {
  it("accepts omission or one numeric quantity only", () => {
    for (const message of ["/랜덤조합", "/랜덤조합 0", "/랜덤조합 2"]) assert.equal(isRandomBoxCraftCommand(message), true);
    for (const message of ["/랜덤조합 ", "/랜덤조합 -1", "/랜덤조합 2 안내", "/랜덤조합2"]) assert.equal(isRandomBoxCraftCommand(message), false);
  });
});

describe("random box craft integration", () => {
  it("wires the exact command guard and service into the Iris dispatch", () => {
    const appSource = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
    assert.match(appSource, /import \{ isRandomBoxCraftCommand, RandomBoxCraftService \}/);
    assert.match(appSource, /isRandomBoxCraftCommand\(normalizedEvent\.message\)/);
    assert.match(appSource, /new RandomBoxCraftService\(database!\)\.handle/);
  });
});

describe("random box craft service", () => {
  it("spends twenty hearts per box and persists both ledgers atomically", async () => {
    const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [], items]);
    const result = await new RandomBoxCraftService(scripted.database).handle({
      externalUserId: "kakao-11", channelId: "room-1", message: "/랜덤조합 2", eventId: "event-random-box"
    });
    assert.deepEqual(
      { status: result.status, count: result.craftQuantity, heart: result.heartQuantity, box: result.boxQuantity },
      { status: "crafted", count: "2", heart: "0", box: "2" }
    );
    assert.equal(result.data, "[🌱합성회원 남] 아조씨 사랑해요..💝\n랜덤박스💝 2개를 획득하셨습니다.");
    for (const fragment of ["UPDATE inventory_stacks", "INSERT INTO inventory_ledger", "INSERT INTO command_executions",
      "INSERT INTO command_audit", "INSERT INTO outbox_messages", "UPDATE operations SET status = 'completed'"]) {
      assert.ok(scripted.sql.some((statement) => statement.includes(fragment)), fragment);
    }
  });

  it("preserves the legacy zero quantity result when a positive heart stack exists", async () => {
    const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [], items]);
    const result = await new RandomBoxCraftService(scripted.database).handle({
      externalUserId: "kakao-11", channelId: "room-1", message: "/랜덤조합 0", eventId: "event-zero"
    });
    assert.deepEqual(
      { count: result.craftQuantity, heart: result.heartQuantity, box: result.boxQuantity },
      { count: "0", heart: "40", box: "0" }
    );
  });

  it("reports the multiplied heart shortage without mutation", async () => {
    const shortItems = [{ ...items[0], quantity: 39n }, items[1]];
    const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [], shortItems]);
    await assert.rejects(
      () => new RandomBoxCraftService(scripted.database).handle({
        externalUserId: "kakao-11", channelId: "room-1", message: "/랜덤조합 2", eventId: "event-short"
      }),
      (error: unknown) => error instanceof ApplicationError && error.code === "HEART_ITEM_REQUIRED"
        && error.message === "하트💝 40개가 필요해요!"
    );
    assert.equal(scripted.sql.some((statement) => statement.includes("UPDATE inventory_stacks")), false);
  });

  it("keeps the legacy truthy bag check for zero quantity", async () => {
    const zeroHeartItems = [{ ...items[0], quantity: 0n }, items[1]];
    const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [], zeroHeartItems]);
    await assert.rejects(
      () => new RandomBoxCraftService(scripted.database).handle({
        externalUserId: "kakao-11", channelId: "room-1", message: "/랜덤조합 0", eventId: "event-zero-heart"
      }),
      (error: unknown) => error instanceof ApplicationError && error.code === "HEART_ITEM_REQUIRED"
        && error.message === "하트💝 0개가 필요해요!"
    );
  });

  it("keeps the legacy silent block during an active castle siege", async () => {
    const scripted = createScriptedDatabase([[{ active_count: 1n }]]);
    const result = await new RandomBoxCraftService(scripted.database).handle({
      externalUserId: "kakao-11", channelId: "room-1", message: "/랜덤조합", eventId: "event-siege"
    });
    assert.deepEqual(result, { status: "blocked_by_castle_siege" });
    assert.equal(scripted.sql.some((statement) => statement.startsWith("UPDATE ") || statement.startsWith("INSERT ")), false);
  });
});
