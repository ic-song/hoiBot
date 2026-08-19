import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { PetFoodBoxCraftService, isPetFoodBoxCraftCommand } from "../src/crafting/pet-food-box-craft-service.js";
import { ApplicationError } from "../src/shared/application-error.js";

// 펫먹이상자 조합 SQL 순서와 mutation 유무를 기록하는 테스트 DB를 만듭니다.
function createScriptedDatabase(queryResults: unknown[]) {
  const remaining = [...queryResults];
  const sql: string[] = [];
  let insertId = 700n;
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
  { item_id: 51n, code: "legacy-junk-item", quantity: 600n, version: 2n },
  { item_id: 52n, code: "legacy-pet-food-box", quantity: 0n, version: 3n }
];

describe("pet food box craft policy", () => {
  it("accepts omission or one numeric quantity only", () => {
    for (const message of ["/펫먹이조합", "/펫먹이조합 0", "/펫먹이조합 2"]) assert.equal(isPetFoodBoxCraftCommand(message), true);
    for (const message of ["/펫먹이조합 ", "/펫먹이조합 -1", "/펫먹이조합 2 안내", "/펫먹이조합2"]) assert.equal(isPetFoodBoxCraftCommand(message), false);
  });
});

describe("pet food box craft service", () => {
  it("keeps the legacy silent block during an active castle siege", async () => {
    const scripted = createScriptedDatabase([[{ active_count: 1n }]]);
    const result = await new PetFoodBoxCraftService(scripted.database).handle({
      externalUserId: "kakao-11", channelId: "room-1", message: "/펫먹이조합", eventId: "event-siege"
    });
    assert.deepEqual(result, { status: "blocked_by_castle_siege" });
    assert.equal(scripted.sql.some((statement) => statement.startsWith("UPDATE ") || statement.startsWith("INSERT ")), false);
  });

  it("spends junk and point and grants boxes with both ledgers atomically", async () => {
    const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [], items, [{ balance: "50000000.000", version: 4n }]]);
    const result = await new PetFoodBoxCraftService(scripted.database).handle({
      externalUserId: "kakao-11", channelId: "room-1", message: "/펫먹이조합 2", eventId: "event-pet-food"
    });
    assert.deepEqual(
      { count: result.craftQuantity, junk: result.junkQuantity, point: result.pointBalance, box: result.boxQuantity },
      { count: "2", junk: "0", point: "0", box: "2" }
    );
    assert.equal(result.data, "[🌱합성회원 남] 님\n펫먹이상자📦(/상자오픈) 2개 조합이 완료되었습니다!\n(/상자오픈)");
    for (const fragment of ["UPDATE inventory_stacks", "UPDATE currency_accounts", "INSERT INTO inventory_ledger",
      "INSERT INTO currency_ledger", "INSERT INTO command_executions", "INSERT INTO command_audit", "INSERT INTO outbox_messages"]) {
      assert.ok(scripted.sql.some((statement) => statement.includes(fragment)), fragment);
    }
  });

  it("normalizes legacy zero quantity to one craft", async () => {
    const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [], items, [{ balance: "50000000.000", version: 4n }]]);
    const result = await new PetFoodBoxCraftService(scripted.database).handle({
      externalUserId: "kakao-11", channelId: "room-1", message: "/펫먹이조합 0", eventId: "event-zero"
    });
    assert.equal(result.craftQuantity, "1");
    assert.equal(result.junkQuantity, "300");
  });

  it("reports junk shortage before querying point", async () => {
    const shortItems = [{ ...items[0], quantity: 599n }, items[1]];
    const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [], shortItems]);
    await assert.rejects(
      () => new PetFoodBoxCraftService(scripted.database).handle({ externalUserId: "kakao-11", channelId: "room-1", message: "/펫먹이조합 2", eventId: "event-junk-short" }),
      (error: unknown) => error instanceof ApplicationError && error.code === "JUNK_ITEM_REQUIRED"
    );
    assert.equal(scripted.sql.some((statement) => statement.includes("currency_accounts")), false);
  });

  it("formats point shortage and does not mutate", async () => {
    const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [], items, [{ balance: "49999999.000", version: 4n }]]);
    await assert.rejects(
      () => new PetFoodBoxCraftService(scripted.database).handle({ externalUserId: "kakao-11", channelId: "room-1", message: "/펫먹이조합 2", eventId: "event-point-short" }),
      (error: unknown) => error instanceof ApplicationError && error.code === "POINT_REQUIRED" && error.message === "🅟50,000,000가 필요해요!"
    );
    assert.equal(scripted.sql.some((statement) => statement.includes("UPDATE inventory_stacks")), false);
  });
});
