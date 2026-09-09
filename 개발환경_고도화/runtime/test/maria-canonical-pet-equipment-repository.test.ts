import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult, RootTransactionDatabaseClient } from "../src/database.js";
import { MariaCanonicalPetEquipmentRepository, type CanonicalPetEquipmentAssignInput } from "../src/pet/maria-canonical-pet-equipment-repository.js";

const fixture = JSON.parse(readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/canonical-pet-equipment-v1.json", import.meta.url), "utf8")) as {
  dependency: string;
  ownerMatchRequired: boolean;
  playerId: string;
  ownedPetId: string;
  ownedEquipmentId: string;
  replayKey: string;
};

const completedReplay = {
  pet_equipment_operation_id: "operat01",
  owned_pet_equipment_id: "assgn001",
  owned_pet_id: fixture.ownedPetId,
  owned_equipment_id: fixture.ownedEquipmentId,
  equipment_slot: "pendant",
  operation_status: "completed",
};

function input(overrides: Partial<CanonicalPetEquipmentAssignInput> = {}): CanonicalPetEquipmentAssignInput {
  return {
    actor: "migration",
    playerId: fixture.playerId,
    ownedPetId: fixture.ownedPetId,
    ownedEquipmentId: fixture.ownedEquipmentId,
    equipmentSlot: "pendant",
    requestKey: fixture.replayKey,
    ...overrides,
  };
}

function mariaError(code: string, errno: number, constraint?: string): Error {
  const message = constraint === undefined ? code : `Duplicate entry 'fixture' for key '${constraint}'`;
  return Object.assign(new Error(message), { code, errno, sqlMessage: message });
}

interface DatabaseOptions {
  readonly replays?: Array<Record<string, unknown>>;
  readonly player?: boolean;
  readonly pet?: boolean;
  readonly equipment?: boolean;
  readonly equipmentSlot?: string;
  readonly transactionErrors?: readonly unknown[];
  readonly duplicateConstraint?: string;
  readonly revealReplayAfterFailure?: boolean;
}

function database(options: DatabaseOptions = {}): {
  client: DatabaseClient & RootTransactionDatabaseClient;
  writes: Array<{ sql: string; values: readonly unknown[] }>;
  queries: string[];
  attempts: () => number;
} {
  const writes: Array<{ sql: string; values: readonly unknown[] }> = [];
  const queries: string[] = [];
  const transactionErrors = [...(options.transactionErrors ?? [])];
  let duplicateConstraint = options.duplicateConstraint;
  let replayVisible = options.revealReplayAfterFailure !== true;
  let attempts = 0;

  const query = async <T>(sql: string): Promise<T> => {
    queries.push(sql);
    if (sql.includes("canonical_pet_equipment_operation_replays")) return (replayVisible ? (options.replays ?? []) : []) as T;
    if (sql.includes("FROM canonical_players")) return (options.player === false ? [] : [{ player_id: fixture.playerId }]) as T;
    if (sql.includes("canonical_owned_pet_instances")) return (options.pet === false ? [] : [{ owned_pet_id: fixture.ownedPetId }]) as T;
    if (sql.includes("canonical_equipment_definitions")) return (options.equipment === false ? [] : [{ equipment_slot: options.equipmentSlot ?? "pendant" }]) as T;
    if (sql.includes("object_identity_crosswalks")) return [] as T;
    return [] as T;
  };
  const execute = async (sql: string, values: readonly unknown[] = []): Promise<DatabaseWriteResult> => {
    writes.push({ sql, values });
    const duplicateAtReplay = duplicateConstraint === "uq_canonical_pet_equipment_operation_request";
    const duplicateAtAssignment = duplicateConstraint !== undefined && !duplicateAtReplay;
    if ((duplicateAtReplay && sql.includes("canonical_pet_equipment_operation_replays")) || (duplicateAtAssignment && sql.includes("canonical_owned_pet_equipment("))) {
      const constraint = duplicateConstraint!;
      duplicateConstraint = undefined;
      replayVisible = true;
      throw mariaError("ER_DUP_ENTRY", 1062, constraint);
    }
    return { affectedRows: 1n, insertId: 0n };
  };
  const transaction: DatabaseTransaction = { query, execute };
  const root = async <T>(work: (value: DatabaseTransaction) => Promise<T>): Promise<T> => {
    attempts += 1;
    const failure = transactionErrors.shift();
    if (failure !== undefined) throw failure;
    return work(transaction);
  };
  return {
    writes,
    queries,
    attempts: () => attempts,
    client: {
      ping: async () => undefined,
      verifyRollback: async () => true,
      query,
      execute,
      withTransaction: root,
      withRootTransaction: root,
      close: async () => undefined,
    },
  };
}

test("assigns in replay-player-pet-equipment lock order and preserves a safe legacy operation locator", async () => {
  const mock = database();
  const result = await new MariaCanonicalPetEquipmentRepository(mock.client).assign(input());
  assert.equal(fixture.dependency, "444_canonical_item_inventory.sql -> canonical_players(player_id)");
  assert.equal(fixture.ownerMatchRequired, true);
  assert.equal(result.replayed, false);
  assert.match(result.petEquipmentOperationId, /^[a-z][a-z0-9]{7}$/);
  assert.match(result.ownedPetEquipmentId, /^[a-z][a-z0-9]{7}$/);
  assert.deepEqual(mock.queries.slice(0, 4).map((sql) => sql.includes("operation_replays") ? "replay" : sql.includes("canonical_players") ? "player" : sql.includes("owned_pet_instances") ? "pet" : sql.includes("equipment_definitions") ? "equipment" : "other"), ["replay", "player", "pet", "equipment"]);
  assert.match(mock.queries[2]!, /ownership_status='owned'.*FOR UPDATE/);
  assert.match(mock.queries[3]!, /owned\.ownership_status='owned'.*active_flag=TRUE.*FOR UPDATE/);
  const operationCrosswalk = mock.writes.find((row) => row.sql.includes("object_identity_crosswalks") && row.values[3] === "petEquipmentOperation");
  assert.equal(operationCrosswalk?.values[4], `${fixture.playerId}:${fixture.replayKey}`);
  assert.ok(mock.writes.some((row) => row.sql.includes("canonical_owned_pet_equipment(") && row.sql.includes("player_id")));
  assert.ok(mock.writes.some((row) => row.sql.includes("canonical_pet_equipment_operation_replays")));
});

test("accepts storage boundaries and rejects invalid actor, slot, request key, and CUID2 before DML", async () => {
  await new MariaCanonicalPetEquipmentRepository(database({ equipmentSlot: "slot-with.dots_1" }).client).assign(input({ requestKey: "r".repeat(191), actor: "a".repeat(100), equipmentSlot: "slot-with.dots_1" }));
  for (const invalid of [
    input({ requestKey: "r".repeat(192) }), input({ requestKey: " " }), input({ actor: "a".repeat(101) }), input({ actor: " " }),
    input({ equipmentSlot: "s".repeat(51) }), input({ equipmentSlot: "bad slot" }), input({ playerId: "1layer01" }), input({ ownedPetId: "Ownedp01" }),
  ]) {
    const mock = database();
    await assert.rejects(new MariaCanonicalPetEquipmentRepository(mock.client).assign(invalid), /CANONICAL_PET_EQUIPMENT_(?:REQUEST_KEY|ACTOR|SLOT|IDENTIFIER)_INVALID/);
    assert.equal(mock.attempts(), 0);
    assert.equal(mock.writes.length, 0);
  }
});

test("preserves a 182-character request locator and hashes a 183-character request locator", async () => {
  for (const requestLength of [182, 183]) {
    const requestKey = "r".repeat(requestLength);
    const mock = database();
    await new MariaCanonicalPetEquipmentRepository(mock.client).assign(input({ requestKey }));
    const operationCrosswalk = mock.writes.find((row) => row.sql.includes("object_identity_crosswalks") && row.values[3] === "petEquipmentOperation");
    const expected = requestLength === 182
      ? `${fixture.playerId}:${requestKey}`
      : createHash("sha256").update(fixture.playerId).update("\0").update(requestKey).digest("hex");
    assert.equal(operationCrosswalk?.values[4], expected);
  }
});

test("returns only a completed exact-payload replay without ownership reads or DML", async () => {
  const mock = database({ replays: [completedReplay], player: false, pet: false, equipment: false });
  assert.deepEqual(await new MariaCanonicalPetEquipmentRepository(mock.client).assign(input()), { petEquipmentOperationId: "operat01", ownedPetEquipmentId: "assgn001", replayed: true });
  assert.equal(mock.queries.length, 1);
  assert.equal(mock.writes.length, 0);
  await assert.rejects(new MariaCanonicalPetEquipmentRepository(database({ replays: [completedReplay] }).client).assign(input({ ownedPetId: "ownedp02" })), /REQUEST_PAYLOAD_CONFLICT/);
  await assert.rejects(new MariaCanonicalPetEquipmentRepository(database({ replays: [{ ...completedReplay, operation_status: "processing" }] }).client).assign(input()), /REPLAY_INCOMPLETE/);
  await assert.rejects(new MariaCanonicalPetEquipmentRepository(database({ replays: [{ ...completedReplay, owned_pet_equipment_id: null }] }).client).assign(input()), /REPLAY_INCOMPLETE/);
});

test("fails closed for missing or non-owned player, pet, equipment, inactive definition, and slot mismatch", async () => {
  await assert.rejects(new MariaCanonicalPetEquipmentRepository(database({ player: false }).client).assign(input()), /PLAYER_NOT_FOUND/);
  await assert.rejects(new MariaCanonicalPetEquipmentRepository(database({ pet: false }).client).assign(input()), /OWNED_PET_NOT_FOUND/);
  await assert.rejects(new MariaCanonicalPetEquipmentRepository(database({ equipment: false }).client).assign(input()), /OWNED_EQUIPMENT_NOT_FOUND/);
  await assert.rejects(new MariaCanonicalPetEquipmentRepository(database({ equipmentSlot: "ring" }).client).assign(input()), /SLOT_MISMATCH/);
});

test("retries only exact MariaDB 1213 and 1205 transaction failures", async () => {
  for (const failure of [mariaError("ER_LOCK_DEADLOCK", 1213), mariaError("ER_LOCK_WAIT_TIMEOUT", 1205)]) {
    const mock = database({ transactionErrors: [failure] });
    assert.equal((await new MariaCanonicalPetEquipmentRepository(mock.client).assign(input())).replayed, false);
    assert.equal(mock.attempts(), 2);
  }
  for (const failure of [Object.assign(new Error("deadlock"), { code: "ER_LOCK_DEADLOCK" }), Object.assign(new Error("timeout"), { errno: 1205 })]) {
    const mock = database({ transactionErrors: [failure] });
    await assert.rejects(new MariaCanonicalPetEquipmentRepository(mock.client).assign(input()), (error) => error === failure);
    assert.equal(mock.attempts(), 1);
  }
});

test("performs bounded final replay reconciliation after exact transient exhaustion", async () => {
  const mock = database({ replays: [completedReplay], transactionErrors: [mariaError("ER_LOCK_DEADLOCK", 1213), mariaError("ER_LOCK_WAIT_TIMEOUT", 1205), mariaError("ER_LOCK_DEADLOCK", 1213)] });
  assert.equal((await new MariaCanonicalPetEquipmentRepository(mock.client).assign(input())).replayed, true);
  assert.equal(mock.attempts(), 3);
});

test("reconciles only exact assignment/replay unique constraints and rejects broad duplicate guesses", async () => {
  for (const constraint of ["uq_canonical_owned_pet_equipment_instance", "uq_canonical_owned_pet_equipment_slot", "uq_canonical_pet_equipment_operation_request"]) {
    const mock = database({ replays: [completedReplay], duplicateConstraint: constraint, revealReplayAfterFailure: true });
    assert.equal((await new MariaCanonicalPetEquipmentRepository(mock.client).assign(input())).replayed, true);
  }
  const unrelated = mariaError("ER_DUP_ENTRY", 1062, "uq_unrelated_constraint");
  await assert.rejects(new MariaCanonicalPetEquipmentRepository(database({ transactionErrors: [unrelated] }).client).assign(input()), (error) => error === unrelated);
  const messageOnly = Object.assign(new Error("Duplicate entry for key 'uq_canonical_pet_equipment_operation_request'"), { code: "ER_DUP_ENTRY" });
  await assert.rejects(new MariaCanonicalPetEquipmentRepository(database({ transactionErrors: [messageOnly] }).client).assign(input()), (error) => error === messageOnly);
});
