import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult, RootTransactionDatabaseClient } from "../src/database.js";
import { calculateCanonicalMiniPetCharm, CANONICAL_MINI_PET_REQUEST_KEY_MAX_LENGTH, MariaCanonicalMiniPetRepository } from "../src/mini-pet/canonical-mini-pet-repository.js";

const fixture = JSON.parse(readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/canonical-mini-pet-v1.json", import.meta.url), "utf8")) as {
  dependency: string;
  definition: { mini_pet_id: string; base_battle_charm: string; base_castle_charm: string; base_raid_charm: string };
  enhancementRules: Array<{ targetEnhancementLevel: number; battleCharmGain: string; castleCharmGain: string; raidCharmGain: string }>;
  ownedInstances: Array<{ owned_mini_pet_id: string; mini_pet_id: string }>;
  expectedLevel2Charm: string;
  transactionScenarios: Array<{ errorCode: string; errno: number; firstTransaction: string; secondTransaction: string }>;
};

function fingerprint(miniPetId: string, bound: boolean): string {
  return createHash("sha256").update(JSON.stringify({ operationKind: "acquire", miniPetId, bound })).digest("hex");
}

function database(replays: Array<Record<string, unknown>> = [], duplicateReplayOnce = false): { client: RootTransactionDatabaseClient; writes: Array<{ sql: string; values: readonly unknown[] }>; events: string[] } {
  const writes: Array<{ sql: string; values: readonly unknown[] }> = [];
  const events: string[] = [];
  let replayReads = 0;
  let duplicate = duplicateReplayOnce;
  const query = async <T>(sql: string, values: readonly unknown[] = []): Promise<T> => {
    events.push(`${sql} :: ${JSON.stringify(values)}`);
    if (sql.includes("canonical_mini_pet_operation_replays")) {
      replayReads += 1;
      return (duplicateReplayOnce && replayReads === 1 ? [] : replays) as T;
    }
    if (sql.includes("canonical_players")) return [{ player_id: "player01" }] as T;
    if (sql.includes("canonical_mini_pet_definitions")) return [{ mini_pet_id: fixture.definition.mini_pet_id }] as T;
    if (sql.includes("canonical_owned_mini_pet_instances")) return fixture.ownedInstances as T;
    return [] as T;
  };
  const execute = async (sql: string, values: readonly unknown[] = []): Promise<DatabaseWriteResult> => {
    events.push(`${sql} :: ${JSON.stringify(values)}`);
    writes.push({ sql, values });
    if (duplicate && sql.includes("canonical_mini_pet_operation_replays")) {
      duplicate = false;
      throw Object.assign(new Error("Duplicate entry for key 'uq_canonical_mini_pet_operation_request'"), { code: "ER_DUP_ENTRY", errno: 1062, sqlMessage: "Duplicate entry for key 'uq_canonical_mini_pet_operation_request'" });
    }
    return { affectedRows: 1n, insertId: 0n };
  };
  const transaction: DatabaseTransaction = { query, execute };
  const withRootTransaction = async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(transaction);
  return { writes, events, client: { ping: async () => undefined, verifyRollback: async () => true, query, execute, withTransaction: withRootTransaction, withRootTransaction, close: async () => undefined } };
}

test("calculates non-linear enhanced charms from definition rules without an owned-row snapshot", () => {
  const result = calculateCanonicalMiniPetCharm(
    { battleCharm: BigInt(fixture.definition.base_battle_charm), castleCharm: BigInt(fixture.definition.base_castle_charm), raidCharm: BigInt(fixture.definition.base_raid_charm) },
    2,
    fixture.enhancementRules.map((rule) => ({ targetEnhancementLevel: rule.targetEnhancementLevel, battleCharmGain: BigInt(rule.battleCharmGain), castleCharmGain: BigInt(rule.castleCharmGain), raidCharmGain: BigInt(rule.raidCharmGain) })),
  );
  assert.equal(result.battleCharm.toString(), fixture.expectedLevel2Charm);
  assert.equal(result.castleCharm.toString(), fixture.expectedLevel2Charm);
  assert.equal(result.raidCharm.toString(), fixture.expectedLevel2Charm);
});

test("creates a distinct owned instance for each acquisition of the same definition", async () => {
  assert.equal(fixture.dependency, "444_canonical_item_inventory.sql -> canonical_players(player_id)");
  assert.equal(new Set(fixture.ownedInstances.map((row) => row.mini_pet_id)).size, 1);
  assert.equal(new Set(fixture.ownedInstances.map((row) => row.owned_mini_pet_id)).size, 2);
  const mock = database();
  const repository = new MariaCanonicalMiniPetRepository(mock.client);
  const first = await repository.acquire({ actor: "migration", playerId: "player01", miniPetId: "minipet1", requestKey: "event-1", bound: false });
  const second = await repository.acquire({ actor: "migration", playerId: "player01", miniPetId: "minipet1", requestKey: "event-2", bound: false });
  assert.notEqual(first.ownedMiniPetId, second.ownedMiniPetId);
  const ownedWrites = mock.writes.filter((entry) => entry.sql.includes("INSERT INTO canonical_owned_mini_pet_instances"));
  assert.equal(ownedWrites.length, 2);
  assert.ok(ownedWrites.every((entry) => entry.values[2] === "minipet1"));
});

test("locks and writes acquire state in the frozen order with two target and four supporting DML statements", async () => {
  const mock = database();
  await new MariaCanonicalMiniPetRepository(mock.client).acquire({ actor: "migration", playerId: "player01", miniPetId: "minipet1", requestKey: "ordered-1", bound: false });
  const index = (fragment: string, after = -1): number => mock.events.findIndex((entry, position) => position > after && entry.includes(fragment));
  const replay = index("FROM canonical_mini_pet_operation_replays");
  const player = index("FROM canonical_players", replay);
  const definition = index("FROM canonical_mini_pet_definitions", player);
  const operationCrosswalk = index("FROM object_identity_crosswalks", definition);
  const ownedCrosswalk = index("FROM object_identity_crosswalks", operationCrosswalk);
  const ownedInsert = index("INSERT INTO canonical_owned_mini_pet_instances", ownedCrosswalk);
  const replayInsert = index("INSERT INTO canonical_mini_pet_operation_replays", ownedInsert);
  assert.ok(replay >= 0 && replay < player && player < definition && definition < operationCrosswalk && operationCrosswalk < ownedCrosswalk && ownedCrosswalk < ownedInsert && ownedInsert < replayInsert);
  assert.match(mock.events[operationCrosswalk]!, /miniPetOperation/);
  assert.match(mock.events[ownedCrosswalk]!, /ownedMiniPet/);
  assert.equal(mock.writes.filter((entry) => entry.sql.includes("canonical_owned_mini_pet_instances") || entry.sql.includes("canonical_mini_pet_operation_replays")).length, 2);
  assert.equal(mock.writes.filter((entry) => entry.sql.includes("INSERT INTO object_identities") || entry.sql.includes("INSERT INTO object_identity_crosswalks")).length, 4);
});

test("replays an identical request and rejects a changed payload", async () => {
  const replay = { mini_pet_operation_id: "operat01", owned_mini_pet_id: "ownedmp1", operation_kind: "acquire", payload_fingerprint: fingerprint("minipet1", false), operation_status: "completed" };
  const repository = new MariaCanonicalMiniPetRepository(database([replay]).client);
  assert.deepEqual(await repository.acquire({ actor: "migration", playerId: "player01", miniPetId: "minipet1", requestKey: "event-1", bound: false }), { miniPetOperationId: "operat01", ownedMiniPetId: "ownedmp1", replayed: true });
  await assert.rejects(repository.acquire({ actor: "migration", playerId: "player01", miniPetId: "minipet1", requestKey: "event-1", bound: true }), /REQUEST_PAYLOAD_CONFLICT/);
});

test("terminal replay performs zero DML and skips current player, definition, and ownership validation", async () => {
  const replay = { mini_pet_operation_id: "operat01", owned_mini_pet_id: "ownedmp1", operation_kind: "acquire", payload_fingerprint: fingerprint("minipet1", false), operation_status: "completed" };
  const mock = database([replay]);
  const result = await new MariaCanonicalMiniPetRepository(mock.client).acquire({ actor: "migration", playerId: "player01", miniPetId: "minipet1", requestKey: "event-1", bound: false });
  assert.equal(result.replayed, true);
  assert.equal(mock.writes.length, 0);
  assert.equal(mock.events.some((entry) => entry.includes("FROM canonical_players") || entry.includes("FROM canonical_mini_pet_definitions") || entry.includes("FROM canonical_owned_mini_pet_instances")), false);
});

test("rejects non-completed or malformed terminal replay identifiers", async () => {
  const common = { operation_kind: "acquire", payload_fingerprint: fingerprint("minipet1", false) };
  for (const replay of [
    { ...common, mini_pet_operation_id: "operat01", owned_mini_pet_id: "ownedmp1", operation_status: "pending" },
    { ...common, mini_pet_operation_id: "bad", owned_mini_pet_id: "ownedmp1", operation_status: "completed" },
    { ...common, mini_pet_operation_id: "operat01", owned_mini_pet_id: null, operation_status: "completed" },
    { ...common, mini_pet_operation_id: "operat01", owned_mini_pet_id: "bad", operation_status: "completed" },
  ]) {
    await assert.rejects(new MariaCanonicalMiniPetRepository(database([replay]).client).acquire({ actor: "migration", playerId: "player01", miniPetId: "minipet1", requestKey: "event-1", bound: false }), /REPLAY_INCOMPLETE/);
  }
});

test("re-reads the committed replay after a same-key duplicate race", async () => {
  const replay = { mini_pet_operation_id: "operat01", owned_mini_pet_id: "ownedmp1", operation_kind: "acquire", payload_fingerprint: fingerprint("minipet1", false), operation_status: "completed" };
  const result = await new MariaCanonicalMiniPetRepository(database([replay], true).client).acquire({ actor: "migration", playerId: "player01", miniPetId: "minipet1", requestKey: "event-1", bound: false });
  assert.deepEqual(result, { miniPetOperationId: "operat01", ownedMiniPetId: "ownedmp1", replayed: true });
});

test("retries deadlock and lock-timeout transactions so the second transaction can read the committed replay", async () => {
  for (const scenario of fixture.transactionScenarios) {
    assert.equal(scenario.firstTransaction, "rollback");
    assert.equal(scenario.secondTransaction, "committed_replay");
    let attempts = 0;
    const replay = { mini_pet_operation_id: "operat01", owned_mini_pet_id: "ownedmp1", operation_kind: "acquire", payload_fingerprint: fingerprint("minipet1", false), operation_status: "completed" };
    const transaction: DatabaseTransaction = {
      query: async <T>(sql: string): Promise<T> => sql.includes("canonical_mini_pet_operation_replays") ? [replay] as T : [] as T,
      execute: async (): Promise<DatabaseWriteResult> => ({ affectedRows: 1n, insertId: 0n }),
    };
    const client: RootTransactionDatabaseClient = {
      ping: async () => undefined, verifyRollback: async () => true, query: async <T>(): Promise<T> => [] as T,
      execute: transaction.execute,
      withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>): Promise<T> => {
        attempts += 1;
        if (attempts === 1) throw Object.assign(new Error(scenario.errorCode), { code: scenario.errorCode, errno: scenario.errno });
        return work(transaction);
      },
      withRootTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>): Promise<T> => {
        attempts += 1;
        if (attempts === 1) throw Object.assign(new Error(scenario.errorCode), { code: scenario.errorCode, errno: scenario.errno });
        return work(transaction);
      },
      close: async () => undefined,
    };
    const result = await new MariaCanonicalMiniPetRepository(client).acquire({ actor: "migration", playerId: "player01", miniPetId: "minipet1", requestKey: "event-1", bound: false });
    assert.deepEqual(result, { miniPetOperationId: "operat01", ownedMiniPetId: "ownedmp1", replayed: true });
    assert.equal(attempts, 2);
  }
});

test("stops transaction-conflict retries after the fixed attempt limit", async () => {
  let attempts = 0;
  const client: RootTransactionDatabaseClient = {
    ping: async () => undefined, verifyRollback: async () => true, query: async <T>(): Promise<T> => [] as T,
    execute: async (): Promise<DatabaseWriteResult> => ({ affectedRows: 0n, insertId: 0n }),
    withTransaction: async <T>(): Promise<T> => {
      attempts += 1;
      throw Object.assign(new Error("deadlock"), { code: "ER_LOCK_DEADLOCK", errno: 1213 });
    },
    withRootTransaction: async <T>(): Promise<T> => {
      attempts += 1;
      throw Object.assign(new Error("deadlock"), { code: "ER_LOCK_DEADLOCK", errno: 1213 });
    },
    close: async () => undefined,
  };
  await assert.rejects(new MariaCanonicalMiniPetRepository(client).acquire({ actor: "migration", playerId: "player01", miniPetId: "minipet1", requestKey: "event-1", bound: false }), /CANONICAL_MINI_PET_TRANSACTION_RETRY_EXHAUSTED/);
  assert.equal(attempts, 3);
});

test("performs a bounded committed replay re-read after branded retry exhaustion", async () => {
  let attempts = 0;
  let replayReads = 0;
  const replay = { mini_pet_operation_id: "operat01", owned_mini_pet_id: "ownedmp1", operation_kind: "acquire", payload_fingerprint: fingerprint("minipet1", false), operation_status: "completed" };
  const client: RootTransactionDatabaseClient = {
    ping: async () => undefined,
    verifyRollback: async () => true,
    query: async <T>(): Promise<T> => (++replayReads === 3 ? [replay] : []) as T,
    execute: async (): Promise<DatabaseWriteResult> => ({ affectedRows: 0n, insertId: 0n }),
    withTransaction: async <T>(): Promise<T> => { throw new Error("UNUSED"); },
    withRootTransaction: async <T>(): Promise<T> => {
      attempts += 1;
      throw Object.assign(new Error("deadlock"), { code: "ER_LOCK_DEADLOCK", errno: 1213 });
    },
    close: async () => undefined,
  };
  assert.deepEqual(await new MariaCanonicalMiniPetRepository(client).acquire({ actor: "migration", playerId: "player01", miniPetId: "minipet1", requestKey: "event-1", bound: false }), { miniPetOperationId: "operat01", ownedMiniPetId: "ownedmp1", replayed: true });
  assert.equal(attempts, 3);
  assert.equal(replayReads, 3);
});

test("accepts a 182-character request key and rejects 183 before database work", async () => {
  assert.equal(CANONICAL_MINI_PET_REQUEST_KEY_MAX_LENGTH, 182);
  const accepted = database();
  await new MariaCanonicalMiniPetRepository(accepted.client).acquire({ actor: "migration", playerId: "player01", miniPetId: "minipet1", requestKey: "a".repeat(182), bound: false });
  assert.ok(accepted.writes.some((entry) => entry.sql.includes("canonical_owned_mini_pet_instances")));
  const rejected = database();
  await assert.rejects(new MariaCanonicalMiniPetRepository(rejected.client).acquire({ actor: "migration", playerId: "player01", miniPetId: "minipet1", requestKey: "a".repeat(183), bound: false }), /ACQUIRE_INPUT_INVALID/);
  assert.equal(rejected.writes.length, 0);
});

test("requires an exact runtime boolean for bound before database work", async () => {
  const mock = database();
  await assert.rejects(new MariaCanonicalMiniPetRepository(mock.client).acquire({ actor: "migration", playerId: "player01", miniPetId: "minipet1", requestKey: "event-1", bound: 1 as unknown as boolean }), /ACQUIRE_INPUT_INVALID/);
  assert.equal(mock.events.length, 0);
  assert.equal(mock.writes.length, 0);
});

test("does not reconcile a loose duplicate without exact Maria code, errno, and constraint", async () => {
  let externalReads = 0;
  const error = Object.assign(new Error("Duplicate entry for key 'uq_canonical_mini_pet_operation_request'"), { code: "ER_DUP_ENTRY" });
  const client: RootTransactionDatabaseClient = {
    ping: async () => undefined,
    verifyRollback: async () => true,
    query: async <T>(): Promise<T> => { externalReads += 1; return [] as T; },
    execute: async (): Promise<DatabaseWriteResult> => ({ affectedRows: 0n, insertId: 0n }),
    withTransaction: async <T>(): Promise<T> => { throw error; },
    withRootTransaction: async <T>(): Promise<T> => { throw error; },
    close: async () => undefined,
  };
  await assert.rejects(new MariaCanonicalMiniPetRepository(client).acquire({ actor: "migration", playerId: "player01", miniPetId: "minipet1", requestKey: "event-1", bound: false }), (caught) => caught === error);
  assert.equal(externalReads, 0);
});

test("equips only an owned instance for the same player and updates audit fields", async () => {
  const mock = database();
  await new MariaCanonicalMiniPetRepository(mock.client, () => new Date("2026-09-02T16:45:00.000Z")).equip({ actor: "tester", playerId: "player01", ownedMiniPetId: "ownedmp2" });
  assert.ok(mock.writes.some((entry) => entry.sql.includes("equipped_flag=FALSE")));
  assert.ok(mock.writes.some((entry) => entry.sql.includes("equipped_flag=TRUE") && entry.values.includes("2026-09-03 01:45:00")));
});
