import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { MariaCanonicalPetEquipmentRepository } from "../src/pet/maria-canonical-pet-equipment-repository.js";

const fixture = JSON.parse(readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/canonical-pet-equipment-v1.json", import.meta.url), "utf8")) as { dependency: string; ownerMatchRequired: boolean; playerId: string; ownedPetId: string; ownedEquipmentId: string; replayKey: string };

function database(replays: Array<Record<string, unknown>> = [], duplicateOnce = false): { client: DatabaseClient; writes: string[] } {
  const writes: string[] = [];
  let duplicate = duplicateOnce;
  let replayReads = 0;
  const query = async <T>(sql: string): Promise<T> => {
    if (sql.includes("canonical_pet_equipment_operation_replays")) { replayReads += 1; return duplicateOnce && replayReads === 1 ? [] as T : replays as T; }
    if (sql.includes("canonical_equipment_definitions")) return [{ equipment_slot: "pendant" }] as T;
    return [] as T;
  };
  const transaction: DatabaseTransaction = { query, execute: async (sql: string): Promise<DatabaseWriteResult> => { writes.push(sql); if (duplicate && sql.includes("canonical_pet_equipment_operation_replays")) { duplicate = false; const error = Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" }); throw error; } return { affectedRows: 1n, insertId: 0n }; } };
  return { writes, client: { ping: async () => undefined, verifyRollback: async () => true, query, execute: transaction.execute, withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(transaction), close: async () => undefined } };
}

test("assigns with one transaction, shared CUID2 audit provider, and owner-bound rows", async () => {
  const mock = database();
  const repository = new MariaCanonicalPetEquipmentRepository(mock.client);
  assert.equal(fixture.dependency, "444_canonical_item_inventory.sql -> canonical_players(player_id)");
  assert.equal(fixture.ownerMatchRequired, true);
  const result = await repository.assign({ actor: "migration", playerId: fixture.playerId, ownedPetId: fixture.ownedPetId, ownedEquipmentId: fixture.ownedEquipmentId, equipmentSlot: "pendant", requestKey: fixture.replayKey });
  assert.equal(result.replayed, false);
  assert.equal(result.petEquipmentOperationId.length, 8);
  assert.equal(result.ownedPetEquipmentId.length, 8);
  assert.ok(mock.writes.some((sql) => sql.includes("canonical_owned_pet_equipment") && sql.includes("player_id")));
  assert.ok(mock.writes.some((sql) => sql.includes("canonical_pet_equipment_operation_replays")));
});

test("rejects same request key with a different payload and incompatible definition slot", async () => {
  const replay = { pet_equipment_operation_id: "operat01", owned_pet_equipment_id: "assgn001", owned_pet_id: "ownedp01", owned_equipment_id: "ownede01", equipment_slot: "pendant" };
  const repository = new MariaCanonicalPetEquipmentRepository(database([replay]).client);
  await assert.rejects(repository.assign({ actor: "migration", playerId: "player01", ownedPetId: "ownedp02", ownedEquipmentId: "ownede01", equipmentSlot: "pendant", requestKey: "event-1" }), /REQUEST_PAYLOAD_CONFLICT/);
  const noSlotDatabase = database();
  noSlotDatabase.client.withTransaction = async (work) => work({ query: async <T>(sql: string): Promise<T> => sql.includes("canonical_equipment_definitions") ? [{ equipment_slot: "ring" }] as T : [] as T, execute: async (): Promise<DatabaseWriteResult> => ({ affectedRows: 1n, insertId: 0n }) });
  await assert.rejects(new MariaCanonicalPetEquipmentRepository(noSlotDatabase.client).assign({ actor: "migration", playerId: "player01", ownedPetId: "ownedp01", ownedEquipmentId: "ownede01", equipmentSlot: "pendant", requestKey: "event-2" }), /SLOT_MISMATCH/);
});

test("re-reads committed replay after a same-key duplicate race", async () => {
  const concurrent = { pet_equipment_operation_id: "operat01", owned_pet_equipment_id: "assgn001", owned_pet_id: "ownedp01", owned_equipment_id: "ownede01", equipment_slot: "pendant" };
  const result = await new MariaCanonicalPetEquipmentRepository(database([concurrent], true).client).assign({ actor: "migration", playerId: "player01", ownedPetId: "ownedp01", ownedEquipmentId: "ownede01", equipmentSlot: "pendant", requestKey: "event-1" });
  assert.deepEqual(result, { petEquipmentOperationId: "operat01", ownedPetEquipmentId: "assgn001", replayed: true });
});
