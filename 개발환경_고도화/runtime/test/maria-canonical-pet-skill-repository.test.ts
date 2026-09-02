import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { MariaCanonicalPetSkillRepository } from "../src/pet/maria-canonical-pet-skill-repository.js";

const audit = { INSERT_USER: "seed", INSERT_TIME: "2026-09-03 01:00:00", UPDATE_USER: "seed", UPDATE_TIME: "2026-09-03 01:00:00" };

function databaseFor(query: (sql: string) => unknown, writes: string[]): DatabaseClient {
  const transaction: DatabaseTransaction = {
    query: async <T>(sql: string): Promise<T> => query(sql) as T,
    execute: async (sql: string): Promise<DatabaseWriteResult> => { writes.push(sql); return { affectedRows: 1n, insertId: 0n }; },
  };
  return { ...transaction, ping: async () => undefined, verifyRollback: async () => true, withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(transaction), close: async () => undefined };
}

describe("MariaCanonicalPetSkillRepository", () => {
  it("grants a stack quantity and binds a payload fingerprint to replay", async () => {
    const writes: string[] = [];
    const db = databaseFor((sql) => {
      if (sql.includes("canonical_pet_skill_operation_replays")) return [];
      if (sql.includes("canonical_pet_skill_definitions")) return [{ pet_skill_id: "skill001" }];
      if (sql.includes("object_identity_crosswalks")) return [{ object_identity_crosswalk_id: "cross001", object_identity_id: "oper0001", ...audit }];
      if (sql.includes("canonical_owned_pet_skill_stacks")) return [{ owned_pet_skill_id: "owned001", quantity: 2n }];
      return [];
    }, writes);
    const result = await new MariaCanonicalPetSkillRepository(db).grant({ actor: "tester", playerId: "player01", petSkillId: "skill001", quantity: 3n, requestKey: "grant-1" });
    assert.equal(result.resultingQuantity, 5n);
    assert.equal(result.replayed, false);
    assert.ok(writes.some((sql) => sql.startsWith("UPDATE canonical_owned_pet_skill_stacks")));
    assert.ok(writes.some((sql) => sql.startsWith("INSERT INTO canonical_pet_skill_operation_replays")));
  });

  it("returns an exact replay and rejects reuse with another payload", async () => {
    const payload = createHash("sha256").update(JSON.stringify([["kind", "grant"], ["petSkillId", "skill001"], ["quantity", "3"]]), "utf8").digest("hex");
    const baseRow = { pet_skill_operation_id: "oper0001", operation_kind: "grant", payload_fingerprint: payload, resulting_quantity: 5n, owned_pet_skill_equipment_id: null };
    const replayDb = databaseFor((sql) => sql.includes("canonical_pet_skill_operation_replays") ? [baseRow] : [], []);
    const repository = new MariaCanonicalPetSkillRepository(replayDb);
    assert.equal((await repository.grant({ actor: "tester", playerId: "player01", petSkillId: "skill001", quantity: 3n, requestKey: "grant-1" })).replayed, true);
    await assert.rejects(() => repository.grant({ actor: "tester", playerId: "player01", petSkillId: "skill001", quantity: 4n, requestKey: "grant-1" }), /REQUEST_PAYLOAD_CONFLICT/);
  });

  it("equips one owned quantity to the same player's pet in one transaction", async () => {
    const writes: string[] = [];
    let crosswalk = 0;
    const db = databaseFor((sql) => {
      if (sql.includes("canonical_pet_skill_operation_replays")) return [];
      if (sql.includes("canonical_owned_pet_instances")) return [{ owned_pet_id: "ownedpet" }];
      if (sql.includes("canonical_owned_pet_skill_stacks")) return [{ owned_pet_skill_id: "owned001", quantity: 1n }];
      if (sql.includes("object_identity_crosswalks")) return [{ object_identity_crosswalk_id: `cross00${++crosswalk}`, object_identity_id: crosswalk === 1 ? "oper0001" : "equip001", ...audit }];
      return [];
    }, writes);
    const result = await new MariaCanonicalPetSkillRepository(db).equip({ actor: "tester", playerId: "player01", ownedPetId: "ownedpet", petSkillId: "skill001", slotNumber: 1, requestKey: "equip-1" });
    assert.equal(result.resultingQuantity, 0n);
    assert.equal(result.ownedPetSkillEquipmentId, "equip001");
    assert.ok(writes.some((sql) => sql.startsWith("INSERT INTO canonical_owned_pet_skill_equipments")));
  });

  it("validates identifiers, quantities, slots and handlers before mutation", async () => {
    const repository = new MariaCanonicalPetSkillRepository(databaseFor(() => [], []));
    await assert.rejects(() => repository.grant({ actor: "tester", playerId: "bad", petSkillId: "skill001", quantity: 1n, requestKey: "x" }), /IDENTIFIER_INVALID/);
    await assert.rejects(() => repository.grant({ actor: "tester", playerId: "player01", petSkillId: "skill001", quantity: 0n, requestKey: "x" }), /QUANTITY_INVALID/);
    await assert.rejects(() => repository.grant({ actor: "tester", playerId: "player01", petSkillId: "skill001", quantity: 18_446_744_073_709_551_616n, requestKey: "x" }), /QUANTITY_INVALID/);
    await assert.rejects(() => repository.equip({ actor: "tester", playerId: "player01", ownedPetId: "ownedpet", petSkillId: "skill001", slotNumber: 31, requestKey: "x" }), /SLOT_INVALID/);
    await assert.rejects(() => repository.registerDefinition({ actor: "tester", sourceSystem: "LEGACY_JSON", sourceNamespace: "PET_SKILL_LIST", sourceIdentifier: "skill_001", petSkillName: "청룡언월도", handlerKey: "javascript", options: {} }), /HANDLER_NOT_ALLOWED/);
  });

  it("binds definition source replay to the normalized catalog payload", async () => {
    const db = databaseFor((sql) => sql.includes("canonical_pet_skill_definition_imports") ? [{ pet_skill_id: "skill001", payload_fingerprint: "0".repeat(64) }] : [], []);
    await assert.rejects(() => new MariaCanonicalPetSkillRepository(db).registerDefinition({ actor: "tester", sourceSystem: "LEGACY_JSON", sourceNamespace: "PET_SKILL_LIST", sourceIdentifier: "skill_001", petSkillName: "청룡언월도", handlerKey: "passive_modifier", options: { raidCharm: 1000000 } }), /DEFINITION_PAYLOAD_CONFLICT/);
  });
});
