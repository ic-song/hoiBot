import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { PetFoodBoxOpenService, isPetFoodBoxOpenCommand } from "../src/inventory/pet-food-box-open-service.js";
import { ApplicationError } from "../src/shared/application-error.js";

const owner = { identity_id: 11n, player_id: 21n, current_display_name: "합성회원 남", tier_code: "seedling" };
const stacks = [
  { item_id: 51n, code: "pet_food", quantity: 5n, version: 2n },
  { item_id: 52n, code: "pet_food_dungeon_box", quantity: 3n, version: 3n }
];

// 쿼리 순서·원자 write를 기록하는 비식별 시험 DB를 만듭니다.
function scriptedDatabase(queryResults: unknown[]) {
  const remaining = [...queryResults]; const sql: string[] = []; let insertId = 900n;
  const transaction: DatabaseTransaction = {
    query: async <T>(statement: string): Promise<T> => { sql.push(statement); if (!remaining.length) throw new Error(`Unexpected query: ${statement}`); return remaining.shift() as T; },
    execute: async (statement: string): Promise<DatabaseWriteResult> => { sql.push(statement); insertId++; return { affectedRows: 1n, insertId }; }
  };
  const database: DatabaseClient = { ping: async () => undefined, verifyRollback: async () => true, query: async () => { throw new Error("Unexpected query"); }, execute: async () => { throw new Error("Unexpected execute"); }, withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(transaction), close: async () => undefined };
  return { database, sql };
}

describe("pet food dungeon box guard", () => {
  it("keeps exact or full numeric legacy guards", () => {
    for (const value of ["/펫먹이박스오픈", "/펫먹이박스오픈 0", "/펫먹이박스오픈\t02"]) assert.equal(isPetFoodBoxOpenCommand(value), true);
    for (const value of ["/펫먹이박스오픈 ", "/펫먹이박스오픈 -1", "/펫먹이박스오픈 2 안내", "/펫먹이박스오픈2"]) assert.equal(isPetFoodBoxOpenCommand(value), false);
  });
});

describe("pet food dungeon box transaction", () => {
  it("caps requested quantity, keeps 40~50 inclusive RNG, and writes both ledgers", async () => {
    const scripted = scriptedDatabase([[{ active_count: 0n }], [owner], [], stacks]);
    const result = await new PetFoodBoxOpenService(scripted.database, () => 1).handle({ externalUserId: "synthetic", channelId: "room", message: "/펫먹이박스오픈 99", eventId: "event-normal" });
    assert.deepEqual({ requested: result.requestedOpenCount, effective: result.effectiveOpenCount, reward: result.rewardTotal }, { requested: "99", effective: "3", reward: "150" });
    assert.deepEqual(result.randomTrace, [1 - Number.EPSILON, 1 - Number.EPSILON, 1 - Number.EPSILON]);
    for (const fragment of ["DELETE FROM inventory_stacks", "UPDATE inventory_stacks", "INSERT INTO inventory_ledger", "INSERT INTO outbox_messages", "INSERT INTO command_executions", "INSERT INTO command_audit"]) assert.ok(scripted.sql.some((entry) => entry.includes(fragment)), fragment);
  });

  it("creates an idempotent empty-box result without inventory writes", async () => {
    const emptyStacks = [{ ...stacks[0] }, { ...stacks[1], quantity: null, version: null }];
    const scripted = scriptedDatabase([[{ active_count: 0n }], [owner], [], emptyStacks]);
    const result = await new PetFoodBoxOpenService(scripted.database).handle({ externalUserId: "synthetic", channelId: "room", message: "/펫먹이박스오픈", eventId: "event-empty" });
    assert.equal(result.effectiveOpenCount, "0");
    assert.match(result.data ?? "", /오픈할 상자가 없습니다/);
    assert.equal(scripted.sql.some((entry) => entry.startsWith("UPDATE inventory_stacks") || entry.startsWith("DELETE FROM inventory_stacks")), false);
  });

  it("keeps legacy zero error after confirming a positive box stack", async () => {
    const scripted = scriptedDatabase([[{ active_count: 0n }], [owner], [], stacks]);
    await assert.rejects(() => new PetFoodBoxOpenService(scripted.database).handle({ externalUserId: "synthetic", channelId: "room", message: "/펫먹이박스오픈 0", eventId: "event-zero" }),
      (error: unknown) => error instanceof ApplicationError && error.code === "INVALID_PET_FOOD_BOX_OPEN");
    assert.equal(scripted.sql.some((entry) => entry.startsWith("INSERT INTO operations")), false);
  });
});
