import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import {
  createPetExploreParticipationFingerprint,
  PetExploreParticipationProvider,
  resolvePetExploreDestinationCode,
  type PetExploreParticipationInput,
  type PetExploreParticipationResult,
} from "../src/pet/pet-explore-participation-provider.js";
import { petExploreParticipationFixture } from "./fixtures/pet-explore-participation-provider.js";

function scripted(queryResults: unknown[]) {
  const pending = [...queryResults];
  const sql: string[] = [];
  let insertId = 100n;
  const transaction: DatabaseTransaction = {
    query: async <T>(statement: string): Promise<T> => {
      sql.push(statement);
      return pending.shift() as T;
    },
    execute: async (statement: string): Promise<DatabaseWriteResult> => {
      sql.push(statement);
      insertId += 1n;
      return { affectedRows: 1n, insertId };
    },
  };
  const database: DatabaseClient = {
    ping: async () => undefined,
    verifyRollback: async () => true,
    query: async () => { throw new Error("unexpected root query"); },
    execute: async () => { throw new Error("unexpected root execute"); },
    withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(transaction),
    close: async () => undefined,
  };
  return { database, sql };
}

describe("pet explore participation provider", () => {
  it("freezes the manual and auto source contracts on semantic destinations", () => {
    assert.deepEqual(petExploreParticipationFixture.canonicalBase, ["pet_explore_rounds", "pet_explore_participations"]);
    assert.deepEqual(Object.keys(petExploreParticipationFixture.sourceSlots), ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    assert.equal(resolvePetExploreDestinationCode("0"), "diamond_mine_event");
    assert.equal(resolvePetExploreDestinationCode("10"), "guild_raid_event");
    assert.equal(resolvePetExploreDestinationCode("11"), null);
    const migration = readFileSync(new URL("../migrations/403_pet_explore_participation_provider.sql", import.meta.url), "utf8");
    assert.match(migration, /CREATE TABLE pet_explore_participation_changes/);
    assert.match(migration, /destination_code NOT REGEXP '\^\[0-9\]\+\$'/);
    assert.match(migration, /participation_mode IN \('manual','auto'\)/);
  });

  it("creates a manual reservation without inventory, reward, settlement, or RNG writes", async () => {
    const scriptedDb = scripted([
      [{ result_json: null }],
      [{ event_mine_active: 0, guild_raid_active: 0 }],
      [{ id: 21n, state_code: "open", version: 4n }],
      [],
    ]);
    const result = await new PetExploreParticipationProvider(scriptedDb.database).reserve(petExploreParticipationFixture.manualInput);
    assert.deepEqual([result.status, result.detailCode, result.destinationCode, result.version, result.replayed], ["created", "created", "pet_enhancement_mine", "1", false]);
    assert.ok(scriptedDb.sql.some((statement) => statement.includes("INSERT INTO pet_explore_participations")));
    assert.ok(scriptedDb.sql.some((statement) => statement.includes("pet_explore_participation_changes")));
    assert.equal(scriptedDb.sql.some((statement) => /UPDATE inventory_stacks|INSERT INTO inventory_ledger|settlement|reward|Math\.random/i.test(statement)), false);
    const configLock = scriptedDb.sql.findIndex((statement) => statement.includes("pet_explore_runtime_config"));
    const roundLock = scriptedDb.sql.findIndex((statement) => statement.includes("FROM pet_explore_rounds"));
    const participationLock = scriptedDb.sql.findIndex((statement) => statement.includes("FROM pet_explore_participations"));
    assert.ok(configLock < roundLock && roundLock < participationLock);
  });

  it("changes a manual reservation with participation CAS and reads a maze ticket without consuming it", async () => {
    const input: PetExploreParticipationInput = {
      ...petExploreParticipationFixture.manualInput,
      destinationCode: "belcar_maze",
      expectedParticipationVersion: "3",
      idempotencyKey: "lease2427-manual-change",
    };
    const scriptedDb = scripted([
      [{ result_json: null }],
      [{ event_mine_active: 0, guild_raid_active: 0 }],
      [{ id: 21n, state_code: "open", version: 4n }],
      [{ id: 31n, destination_code: "luck_mine", state_code: "active", version: 3n }],
      [{ quantity: 2n }],
    ]);
    const result = await new PetExploreParticipationProvider(scriptedDb.database).reserve(input);
    assert.deepEqual([result.status, result.detailCode, result.previousDestinationCode, result.destinationCode, result.previousVersion, result.version], ["changed", "manual_changed", "luck_mine", "belcar_maze", "3", "4"]);
    assert.equal(result.checkedTicketQuantity, "2");
    assert.ok(scriptedDb.sql.some((statement) => statement.includes("UPDATE pet_explore_participations") && statement.includes("version=?")));
    assert.equal(scriptedDb.sql.some((statement) => /UPDATE inventory_stacks|INSERT INTO inventory_ledger/.test(statement)), false);
  });

  it("preserves an existing auto participation as noop after a read-only auto ticket check", async () => {
    const scriptedDb = scripted([
      [{ result_json: null }],
      [{ event_mine_active: 0, guild_raid_active: 0 }],
      [{ id: 22n, state_code: "open", version: 1n }],
      [{ id: 32n, destination_code: "luck_mine", state_code: "active", version: 5n }],
      [{ quantity: 1n }],
    ]);
    const result = await new PetExploreParticipationProvider(scriptedDb.database).reserve(petExploreParticipationFixture.autoInput);
    assert.deepEqual([result.status, result.detailCode, result.destinationCode, result.version], ["noop", "auto_existing", "luck_mine", "5"]);
    assert.equal(scriptedDb.sql.some((statement) => statement.includes("UPDATE pet_explore_participations")), false);
    assert.ok(scriptedDb.sql.some((statement) => statement.includes("FROM item_definitions") && statement.includes("FOR UPDATE")));
  });

  it("records ticket-unavailable as an exact noop without creating participation", async () => {
    const scriptedDb = scripted([
      [{ result_json: null }],
      [{ event_mine_active: 0, guild_raid_active: 0 }],
      [{ id: 22n, state_code: "open", version: 1n }],
      [],
      [],
    ]);
    const result = await new PetExploreParticipationProvider(scriptedDb.database).reserve(petExploreParticipationFixture.autoInput);
    assert.deepEqual([result.status, result.detailCode, result.participationId, result.destinationCode, result.ticketAvailable], ["noop", "ticket_unavailable", null, null, false]);
    assert.equal(scriptedDb.sql.some((statement) => statement.includes("INSERT INTO pet_explore_participations")), false);
  });

  it("rejects stale versions, exact-key payload mismatch, and replays the stored envelope", async () => {
    const staleDb = scripted([
      [{ result_json: null }],
      [{ event_mine_active: 0, guild_raid_active: 0 }],
      [{ id: 21n, state_code: "open", version: 5n }],
    ]);
    await assert.rejects(
      () => new PetExploreParticipationProvider(staleDb.database).reserve(petExploreParticipationFixture.manualInput),
      (error: unknown) => (error as { code?: string; statusCode?: number }).code === "PET_EXPLORE_ROUND_VERSION_CONFLICT" && (error as { statusCode?: number }).statusCode === 409,
    );

    const base = petExploreParticipationFixture.manualInput;
    const storedResult: PetExploreParticipationResult = {
      status: "created", detailCode: "created", mode: "manual", roundId: "21", roundVersion: "4", participationId: "31", playerId: base.playerId,
      previousDestinationCode: null, destinationCode: base.destinationCode, previousVersion: null, version: "1", checkedTicketName: null,
      checkedTicketQuantity: "0", ticketAvailable: true, operationId: "101", auditId: "104", outboxId: "105", replayed: false,
    };
    const envelope = { fingerprint: createPetExploreParticipationFingerprint(base), result: storedResult };
    const replayDb = scripted([[{ result_json: JSON.stringify(envelope) }]]);
    assert.deepEqual(await new PetExploreParticipationProvider(replayDb.database).reserve(base), { ...storedResult, replayed: true });
    assert.equal(replayDb.sql.length, 2);

    const mismatchDb = scripted([[{ result_json: JSON.stringify(envelope) }]]);
    await assert.rejects(
      () => new PetExploreParticipationProvider(mismatchDb.database).reserve({ ...base, destinationCode: "intimacy_mine" }),
      (error: unknown) => (error as { code?: string; statusCode?: number }).code === "PET_EXPLORE_PARTICIPATION_IDEMPOTENCY_PAYLOAD_MISMATCH" && (error as { statusCode?: number }).statusCode === 409,
    );
  });
});
