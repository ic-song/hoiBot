import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { ItemProvider, type ItemDefinition, type ItemMutationContext, type ItemTypeHandler } from "../src/package/item-provider.js";
import { createPetExploreSettlementFingerprint, PetExploreSettlementProvider, petExploreSettlementSample, type PetExploreSettlementResult } from "../src/pet/pet-explore-settlement-provider.js";
import { petExploreSettlementBranches, premiumConflictFixture, settlementInput, settlementPlan } from "./fixtures/pet-explore-settlement-provider.js";

class RecordingHandler implements ItemTypeHandler {
  readonly calls: string[] = [];
  constructor(private readonly missing = new Set<string>()) {}
  async checkAdd(definition: ItemDefinition): Promise<void> { this.calls.push(`checkAdd:${definition.id}`); }
  async checkRemove(definition: ItemDefinition): Promise<void> { this.calls.push(`checkRemove:${definition.id}`); if (this.missing.has(definition.id)) throw new Error("ITEM_BALANCE_INSUFFICIENT"); }
  async add(definition: ItemDefinition, quantity: bigint): Promise<void> { this.calls.push(`add:${definition.id}:${quantity}`); }
  async remove(definition: ItemDefinition, quantity: bigint): Promise<void> { this.calls.push(`remove:${definition.id}:${quantity}`); }
}
function items(handler: RecordingHandler): ItemProvider {
  const provider = new ItemProvider({ findById: async (id) => ({ id, type: "STACK", name: id, stackable: true, metadata: {}, enabled: true }) });
  provider.register("STACK", handler); return provider;
}
function scripted(queryResults: unknown[]) {
  const pending = [...queryResults], sql: string[] = []; let insertId = 100n;
  const transaction: DatabaseTransaction = { query: async <T>(statement: string): Promise<T> => { sql.push(statement); return pending.shift() as T; }, execute: async (statement: string): Promise<DatabaseWriteResult> => { sql.push(statement); insertId += 1n; return { affectedRows: 1n, insertId }; } };
  const database: DatabaseClient = { ping: async () => undefined, verifyRollback: async () => true, query: async () => { throw new Error("unexpected root query"); }, execute: async () => { throw new Error("unexpected root execute"); }, withTransaction: async <T>(work: (tx: DatabaseTransaction) => Promise<T>) => work(transaction), close: async () => undefined };
  return { database, sql };
}
const baseQueries = (participations: unknown[]) => [[{ result_json: null }], [{ config_id: 1 }], [{ id: 21n, state_code: "open", version: 3n }], participations, [{ status_code: "RED" }]];

describe("pet explore settlement provider", () => {
  it("freezes source branches, atomic tables, and the premium RED gap", () => {
    assert.equal(petExploreSettlementBranches.length, 6); assert.equal(premiumConflictFixture.status, "RED");
    const migration = readFileSync(new URL("../migrations/404_pet_explore_settlement_provider.sql", import.meta.url), "utf8");
    for (const table of ["pet_explore_settlements", "pet_explore_settlement_results", "pet_explore_settlement_rng_evidence", "pet_explore_settlement_reward_results", "pet_explore_player_records"]) assert.match(migration, new RegExp(`CREATE TABLE ${table}`));
    assert.match(migration, /'premium_explore_bonus','RED','7_percent',NULL/);
  });

  it("settles through ItemProvider and records deterministic RNG, reward, record and round close", async () => {
    const handler = new RecordingHandler();
    const db = scripted(baseQueries([{ id: 31n, player_id: 41n, destination_code: "pet_enhancement_mine", version: 1n }]));
    const result = await new PetExploreSettlementProvider(db.database, items(handler)).settle(settlementInput([settlementPlan("31")]));
    assert.deepEqual([result.status, result.successCount, result.failureCount, result.roundVersion], ["settled", "1", "0", "4"]);
    assert.deepEqual(handler.calls, ["checkAdd:ITEM-PET-FOOD", "add:ITEM-PET-FOOD:2"]);
    assert.ok(db.sql.some((sql) => sql.includes("pet_explore_settlement_rng_evidence")));
    assert.ok(db.sql.some((sql) => sql.includes("pet_explore_player_records")));
    assert.ok(db.sql.some((sql) => sql.includes("state_code='closed'")));
  });

  it("consumes one dungeon ticket or uses deterministic regular-mine fallback when absent", async () => {
    const available = new RecordingHandler();
    const input = settlementInput([settlementPlan("31", { ticketPolicy: "consume_or_regular_fallback", ticketItemCode: "ITEM-PET-DUNGEON-TICKET", fallbackDestinations: ["pet_enhancement_mine", "intimacy_mine", "luck_mine"] })]);
    const db = scripted(baseQueries([{ id: 31n, player_id: 41n, destination_code: "jeondor_dungeon", version: 1n }]));
    const settled = await new PetExploreSettlementProvider(db.database, items(available)).settle(input);
    assert.equal(settled.participants[0]?.ticketConsumed, true);
    assert.equal(available.calls.filter((call) => call.startsWith("remove:ITEM-PET-DUNGEON-TICKET")).length, 1);

    const missing = new RecordingHandler(new Set(["ITEM-PET-DUNGEON-TICKET"]));
    const fallbackDb = scripted(baseQueries([{ id: 31n, player_id: 41n, destination_code: "jeondor_dungeon", version: 1n }]));
    const fallback = await new PetExploreSettlementProvider(fallbackDb.database, items(missing)).settle({ ...input, idempotencyKey: "lease2429-fallback" });
    assert.equal(fallback.participants[0]?.fallbackApplied, true);
    assert.ok(["pet_enhancement_mine", "intimacy_mine", "luck_mine"].includes(fallback.participants[0]!.effectiveDestinationCode));
    assert.equal(missing.calls.some((call) => call.startsWith("remove:ITEM-PET-DUNGEON-TICKET")), false);
  });

  it("marks a missing maze ticket ineligible without reward or record", async () => {
    const handler = new RecordingHandler(new Set(["ITEM-MAZE-TICKET"]));
    const db = scripted(baseQueries([{ id: 31n, player_id: 41n, destination_code: "belcar_maze", version: 1n }]));
    const result = await new PetExploreSettlementProvider(db.database, items(handler)).settle(settlementInput([settlementPlan("31", { ticketPolicy: "consume_or_fail", ticketItemCode: "ITEM-MAZE-TICKET" })]));
    assert.deepEqual([result.ineligibleCount, result.participants[0]?.resultCode, result.participants[0]?.rewards.length], ["1", "ineligible", 0]);
    assert.equal(db.sql.some((sql) => sql.includes("pet_explore_player_records")), false);
  });

  it("fails closed on unresolved premium instead of applying the source value", async () => {
    const db = scripted(baseQueries([{ id: 31n, player_id: 41n, destination_code: "pet_enhancement_mine", version: 1n }]));
    await assert.rejects(() => new PetExploreSettlementProvider(db.database, items(new RecordingHandler())).settle(settlementInput([settlementPlan("31", { premiumActive: true })])), (error: unknown) => (error as { code?: string; statusCode?: number }).code === "PET_EXPLORE_PREMIUM_POLICY_CONFLICT" && (error as { statusCode?: number }).statusCode === 409);
  });

  it("replays exact round payload and rejects a changed fingerprint with 409", async () => {
    const input = settlementInput([]);
    const stored: PetExploreSettlementResult = { status: "noop", roundId: "21", roundKey: input.roundKey, previousRoundVersion: "3", roundVersion: "4", participantCount: "0", successCount: "0", failureCount: "0", ineligibleCount: "0", participants: [], nextAutoResults: [], operationId: "101", auditId: "102", outboxId: "103", replayed: false };
    const saved = { fingerprint: createPetExploreSettlementFingerprint(input), result: stored };
    const replayDb = scripted([[{ result_json: JSON.stringify(saved) }]]);
    assert.deepEqual(await new PetExploreSettlementProvider(replayDb.database, items(new RecordingHandler())).settle(input), { ...stored, replayed: true });
    const mismatchDb = scripted([[{ result_json: JSON.stringify(saved) }]]);
    await assert.rejects(() => new PetExploreSettlementProvider(mismatchDb.database, items(new RecordingHandler())).settle({ ...input, policyHash: "b".repeat(64) }), (error: unknown) => (error as { code?: string }).code === "PET_EXPLORE_SETTLEMENT_IDEMPOTENCY_PAYLOAD_MISMATCH");
  });

  it("keeps RNG deterministic and namespaced by stage", () => {
    const seed = "policy|round|operation";
    assert.equal(petExploreSettlementSample(seed, "31", "success"), petExploreSettlementSample(seed, "31", "success"));
    assert.notEqual(petExploreSettlementSample(seed, "31", "success"), petExploreSettlementSample(seed, "31", "fallback"));
  });
});
