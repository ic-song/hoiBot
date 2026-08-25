import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { AdvancedTierTicketCraftService, isAdvancedTierTicketCraftCommand, parseAdvancedTierTicketCraftQuantity } from "../src/crafting/advanced-tier-ticket-craft-service.js";
import { ApplicationError } from "../src/shared/application-error.js";

// 조합 Service의 SQL 순서와 mutation 유무를 기록하는 테스트 DB를 만듭니다.
function scriptedDatabase(queryResults: unknown[]) {
  const remaining = [...queryResults]; const sql: string[] = []; let insertId = 800n;
  const transaction: DatabaseTransaction = {
    query: async <T>(statement: string): Promise<T> => { sql.push(statement); if (remaining.length === 0) throw new Error(`Unexpected query: ${statement}`); return remaining.shift() as T; },
    execute: async (statement: string): Promise<DatabaseWriteResult> => { sql.push(statement); insertId += 1n; return { affectedRows: 1n, insertId }; }
  };
  const database: DatabaseClient = { ping: async () => undefined, verifyRollback: async () => true, query: async () => { throw new Error("Unexpected query"); }, execute: async () => { throw new Error("Unexpected execute"); }, withTransaction: async <T>(work: (tx: DatabaseTransaction) => Promise<T>) => work(transaction), close: async () => undefined };
  return { database, sql };
}

const owner = { identity_id: 11n, player_id: 21n, current_display_name: "합성회원 남", tier_code: "seedling" };
const definitions = [
  { item_id: 41n, code: "tier_promotion_ticket" }, { item_id: 42n, code: "legendary_stone" },
  { item_id: 43n, code: "pet_enhance_stone" }, { item_id: 44n, code: "advanced_tier_promotion_ticket" }
];
const stacks = [
  { item_id: 41n, quantity: 3_050n, version: 1n }, { item_id: 42n, quantity: 4n, version: 1n },
  { item_id: 43n, quantity: 300n, version: 1n }
];

describe("advanced tier ticket craft policy", () => {
  it("accepts exact or complete numeric forms only", () => {
    for (const value of ["/고급티켓조합", "/고급티켓조합 0", "/고급티켓조합 2"]) assert.equal(isAdvancedTierTicketCraftCommand(value), true);
    for (const value of ["/고급티켓조합 ", "/고급티켓조합 -1", "/고급티켓조합 2 안내", "/고급티켓조합2"]) assert.equal(isAdvancedTierTicketCraftCommand(value), false);
  });
  it("keeps default and zero as one and caps the request", () => {
    assert.equal(parseAdvancedTierTicketCraftQuantity("/고급티켓조합"), 1n);
    assert.equal(parseAdvancedTierTicketCraftQuantity("/고급티켓조합 0"), 1n);
    assert.throws(() => parseAdvancedTierTicketCraftQuantity("/고급티켓조합 1001"), (error: unknown) => error instanceof ApplicationError && error.code === "ADVANCED_TIER_TICKET_CRAFT_LIMIT");
  });
});

describe("advanced tier ticket craft service", () => {
  it("consumes three materials, preserves reserve and grants tickets atomically", async () => {
    const scripted = scriptedDatabase([[{ active_count: 0n }], [owner], [], definitions, stacks]);
    const result = await new AdvancedTierTicketCraftService(scripted.database).handle({ externalUserId: "kakao-11", channelId: "room-1", message: "/고급티켓조합 2", eventId: "event-normal" });
    assert.deepEqual({ count: result.craftQuantity, tier: result.tierTicketQuantity, stone: result.legendaryStoneQuantity, pet: result.petEnhanceStoneQuantity, advanced: result.advancedTicketQuantity }, { count: "2", tier: "2550", stone: "0", pet: "0", advanced: "2" });
    for (const fragment of ["DELETE FROM inventory_stacks", "INSERT INTO inventory_ledger", "INSERT INTO command_executions", "INSERT INTO command_audit", "INSERT INTO outbox_messages"]) assert.ok(scripted.sql.some((statement) => statement.includes(fragment)), fragment);
  });
  it("requires the 2550 reserve in addition to the material cost", async () => {
    const short = [{ ...stacks[0], quantity: 2_799n }, stacks[1], stacks[2]];
    const scripted = scriptedDatabase([[{ active_count: 0n }], [owner], [], definitions, short]);
    await assert.rejects(() => new AdvancedTierTicketCraftService(scripted.database).handle({ externalUserId: "kakao-11", channelId: "room-1", message: "/고급티켓조합", eventId: "event-short" }), (error: unknown) => error instanceof ApplicationError && error.code === "TIER_TICKET_RESERVE_REQUIRED");
    assert.equal(scripted.sql.some((statement) => statement.startsWith("UPDATE ") || statement.startsWith("DELETE ") || statement.startsWith("INSERT ")), false);
  });
  it("keeps the castle siege block mutation-free", async () => {
    const scripted = scriptedDatabase([[{ active_count: 1n }]]);
    assert.deepEqual(await new AdvancedTierTicketCraftService(scripted.database).handle({ externalUserId: "kakao-11", channelId: "room-1", message: "/고급티켓조합", eventId: "event-siege" }), { status: "blocked_by_castle_siege" });
    assert.equal(scripted.sql.length, 1);
  });
});
