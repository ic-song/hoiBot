import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import {
  createPetExploreEventControlFingerprint,
  PetExploreEventControlProvider,
  type PetExploreEventControlInput,
  type PetExploreEventControlResult,
} from "../src/pet/pet-explore-event-control-provider.js";
import { petExploreEventControlFixture } from "./fixtures/pet-explore-event-control-provider.js";

function scripted(queryResults: unknown[], participantRelocations = 0n) {
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
      return {
        affectedRows: /pet_explore_event_control_relocations|UPDATE pet_explore_participations/.test(statement) ? participantRelocations : 1n,
        insertId,
      };
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

describe("pet explore event control provider", () => {
  it("freezes two semantic events on the migration160 singleton without legacy slot identities", () => {
    assert.equal(petExploreEventControlFixture.authoritativeState, "pet_explore_runtime_config");
    assert.deepEqual(petExploreEventControlFixture.events.map((event) => event.eventCode), ["diamond_mine", "guild_raid"]);
    assert.deepEqual(petExploreEventControlFixture.events.map((event) => event.participantDestination), ["diamond_mine_event", "guild_raid_event"]);
    assert.equal(petExploreEventControlFixture.relocationDestination, "regular_mine");
    assert.deepEqual(petExploreEventControlFixture.canonicalBase, ["pet_explore_rounds", "pet_explore_participations"]);
    const migration = readFileSync(new URL("../migrations/402_pet_explore_event_control_provider.sql", import.meta.url), "utf8");
    assert.match(migration, /ALTER TABLE pet_explore_runtime_config/);
    assert.match(migration, /CREATE TABLE pet_explore_rounds/);
    assert.match(migration, /CREATE TABLE pet_explore_participations/);
    assert.doesNotMatch(migration, /destination_code\s+IN\s*\([^)]*['"](?:0|10)['"]/);
  });

  it("turns an event off with CAS and relocates only matching active participants", async () => {
    const scriptedDb = scripted([
      [{ result_json: null }],
      [{ event_mine_active: 1, guild_raid_active: 1, version: 7n }],
    ], 2n);
    const result = await new PetExploreEventControlProvider(scriptedDb.database).setActive(petExploreEventControlFixture.baseInput);
    assert.deepEqual(
      [result.status, result.previousActive, result.active, result.previousVersion, result.version, result.relocatedParticipantCount],
      ["changed", true, false, "7", "8", "2"],
    );
    assert.ok(scriptedDb.sql.some((statement) => statement.includes("event_mine_active=?") && statement.includes("version=?")));
    assert.ok(scriptedDb.sql.some((statement) => statement.includes("UPDATE pet_explore_participations") && statement.includes("destination_code='regular_mine'") && statement.includes("state_code='active'")));
    assert.ok(scriptedDb.sql.some((statement) => statement.includes("pet_explore_event_control_relocations")));
    assert.equal(scriptedDb.sql.some((statement) => /inventory|settlement|reward|Math\.random/i.test(statement)), false);
  });

  it("turns an event on without participant, settlement, reward, or RNG mutation", async () => {
    const scriptedDb = scripted([
      [{ result_json: null }],
      [{ event_mine_active: 0, guild_raid_active: 0, version: 8n }],
    ]);
    const result = await new PetExploreEventControlProvider(scriptedDb.database).setActive({
      ...petExploreEventControlFixture.baseInput,
      active: true,
      expectedVersion: "8",
      idempotencyKey: "synthetic-event-on",
    });
    assert.deepEqual([result.status, result.version, result.relocatedParticipantCount], ["changed", "9", "0"]);
    assert.equal(scriptedDb.sql.some((statement) => statement.includes("UPDATE pet_explore_participations")), false);
  });

  it("fails closed on stale versions", async () => {
    const scriptedDb = scripted([
      [{ result_json: null }],
      [{ event_mine_active: 1, guild_raid_active: 0, version: 8n }],
    ]);
    await assert.rejects(
      () => new PetExploreEventControlProvider(scriptedDb.database).setActive(petExploreEventControlFixture.baseInput),
      (error: unknown) => (error as { code?: string; statusCode?: number }).code === "PET_EXPLORE_EVENT_VERSION_CONFLICT"
        && (error as { statusCode?: number }).statusCode === 409,
    );
  });

  it("replays the exact envelope and rejects a different namespaced payload", async () => {
    const base = petExploreEventControlFixture.baseInput;
    const storedResult: PetExploreEventControlResult = {
      status: "changed",
      eventCode: "diamond_mine",
      previousActive: true,
      active: false,
      previousVersion: "7",
      version: "8",
      relocatedParticipantCount: "2",
      operationId: "101",
      auditId: "104",
      outboxId: "105",
      replayed: false,
    };
    const envelope = { fingerprint: createPetExploreEventControlFingerprint(base), result: storedResult };
    const replayDb = scripted([[{ result_json: JSON.stringify(envelope) }]]);
    const replay = await new PetExploreEventControlProvider(replayDb.database).setActive(base);
    assert.deepEqual(replay, { ...storedResult, replayed: true });
    assert.equal(replayDb.sql.length, 2);

    const mismatchDb = scripted([[{ result_json: JSON.stringify(envelope) }]]);
    const mismatch: PetExploreEventControlInput = { ...base, active: true };
    await assert.rejects(
      () => new PetExploreEventControlProvider(mismatchDb.database).setActive(mismatch),
      (error: unknown) => (error as { code?: string }).code === "PET_EXPLORE_EVENT_IDEMPOTENCY_PAYLOAD_MISMATCH",
    );
  });
});
