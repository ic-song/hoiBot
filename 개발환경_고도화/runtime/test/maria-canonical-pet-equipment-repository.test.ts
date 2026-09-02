import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { MariaCanonicalPetEquipmentRepository } from "../src/pet/maria-canonical-pet-equipment-repository.js";

const fixture = JSON.parse(readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/canonical-pet-equipment-v1.json", import.meta.url), "utf8")) as { dependency: string; ownerMatchRequired: boolean; playerId: string; ownedPetId: string; ownedEquipmentId: string; replayKey: string };

function database(): { client: DatabaseClient; writes: string[] } {
  const writes: string[] = [];
  const transaction: DatabaseTransaction = { query: async <T>(): Promise<T> => [] as T, execute: async (sql: string): Promise<DatabaseWriteResult> => { writes.push(sql); return { affectedRows: 1n, insertId: 0n }; } };
  return { writes, client: { ping: async () => undefined, verifyRollback: async () => true, query: transaction.query, execute: transaction.execute, withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(transaction), close: async () => undefined } };
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
