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

function lockError(errno: 1205 | 1213): Error & { code: string; errno: number } {
  return Object.assign(new Error("transaction lock"), { code: errno === 1213 ? "ER_LOCK_DEADLOCK" : "ER_LOCK_WAIT_TIMEOUT", errno });
}

function operationFingerprint(value: Record<string, string | number>): string {
  return createHash("sha256").update(JSON.stringify(Object.keys(value).sort().map((key) => [key, value[key]])), "utf8").digest("hex");
}

describe("MariaCanonicalPetSkillRepository", () => {
  it("grants a stack quantity and binds a payload fingerprint to replay", async () => {
    const writes: string[] = [];
    const db = databaseFor((sql) => {
      if (sql.includes("canonical_pet_skill_operation_replays")) return [];
      if (sql.includes("canonical_pet_skill_definitions")) return [{ pet_skill_id: "skill001", active_flag: 1, handler_key: "passive_modifier", options_json: { raidCharm: 1 } }];
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
    const payload = operationFingerprint({ kind: "grant", petSkillId: "skill001", quantity: "3" });
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
      if (sql.includes("canonical_pet_skill_definitions")) return [{ pet_skill_id: "skill001", active_flag: true, handler_key: "presentation_only", options_json: "{}" }];
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

  it("recovers committed definition, grant, and equip replays after 1205/1213", async () => {
    const definitionFingerprint = createHash("sha256").update(JSON.stringify(["롤렉스", null, "C", "command_unlock", { commandIdentifier: "pet_skill_boast" }, true]), "utf8").digest("hex");
    let definitionTransactions = 0;
    const definitionDb: DatabaseClient = {
      ...databaseFor(() => [], []),
      withTransaction: async () => { definitionTransactions += 1; throw lockError(1213); },
      query: async <T>(): Promise<T> => [{ pet_skill_id: "skill001", payload_fingerprint: definitionFingerprint }] as T,
    };
    const definition = await new MariaCanonicalPetSkillRepository(definitionDb).registerDefinition({ actor: "tester", sourceSystem: "LEGACY_JSON", sourceNamespace: "PET_SKILL_LIST", sourceIdentifier: "skill_050", petSkillName: "롤렉스", petSkillGrade: "C", handlerKey: "command_unlock", options: { commandIdentifier: "pet_skill_boast" } });
    assert.deepEqual({ ...definition, attempts: definitionTransactions }, { petSkillId: "skill001", replayed: true, attempts: 1 });

    const grantPayload = operationFingerprint({ kind: "grant", petSkillId: "skill001", quantity: "2" });
    const grantDb: DatabaseClient = { ...databaseFor(() => [], []), withTransaction: async () => { throw lockError(1205); }, query: async <T>(): Promise<T> => [{ pet_skill_operation_id: "oper0001", operation_kind: "grant", payload_fingerprint: grantPayload, resulting_quantity: 4n, owned_pet_skill_equipment_id: null }] as T };
    assert.equal((await new MariaCanonicalPetSkillRepository(grantDb).grant({ actor: "tester", playerId: "player01", petSkillId: "skill001", quantity: 2n, requestKey: "grant-lock" })).replayed, true);

    const equipPayload = operationFingerprint({ kind: "equip", ownedPetId: "ownedpet", petSkillId: "skill001", slotNumber: 1 });
    const equipDb: DatabaseClient = { ...databaseFor(() => [], []), withTransaction: async () => { throw lockError(1213); }, query: async <T>(): Promise<T> => [{ pet_skill_operation_id: "oper0002", operation_kind: "equip", payload_fingerprint: equipPayload, resulting_quantity: 0n, owned_pet_skill_equipment_id: "equip001" }] as T };
    assert.equal((await new MariaCanonicalPetSkillRepository(equipDb).equip({ actor: "tester", playerId: "player01", ownedPetId: "ownedpet", petSkillId: "skill001", slotNumber: 1, requestKey: "equip-lock" })).replayed, true);
    await assert.rejects(() => new MariaCanonicalPetSkillRepository(grantDb).grant({ actor: "tester", playerId: "player01", petSkillId: "skill001", quantity: 3n, requestKey: "grant-lock" }), /REQUEST_PAYLOAD_CONFLICT/);
  });

  it("limits lock retries and exposes exhaustion when no committed replay exists", async () => {
    for (const operation of ["definition", "grant", "equip"] as const) {
      let attempts = 0;
      const db: DatabaseClient = { ...databaseFor(() => [], []), withTransaction: async () => { attempts += 1; throw lockError(operation === "grant" ? 1205 : 1213); }, query: async <T>(): Promise<T> => [] as T };
      const repository = new MariaCanonicalPetSkillRepository(db);
      const call = operation === "definition"
        ? repository.registerDefinition({ actor: "tester", sourceSystem: "LEGACY_JSON", sourceNamespace: "PET_SKILL_LIST", sourceIdentifier: "skill_050", petSkillName: "롤렉스", handlerKey: "command_unlock", options: { commandIdentifier: "pet_skill_boast" } })
        : operation === "grant"
          ? repository.grant({ actor: "tester", playerId: "player01", petSkillId: "skill001", quantity: 1n, requestKey: "lock" })
          : repository.equip({ actor: "tester", playerId: "player01", ownedPetId: "ownedpet", petSkillId: "skill001", slotNumber: 1, requestKey: "lock" });
      await assert.rejects(() => call, /transaction lock/);
      assert.equal(attempts, 3, operation);
    }
  });

  it("rejects inactive or malformed definitions before stack or equipment mutation", async () => {
    for (const definition of [
      { pet_skill_id: "skill001", active_flag: 0, handler_key: "presentation_only", options_json: {} },
      { pet_skill_id: "skill001", active_flag: 1, handler_key: "command_unlock", options_json: { commandIdentifier: "/관리자삭제" } },
    ]) {
      const writes: string[] = [];
      const db = databaseFor((sql) => {
        if (sql.includes("canonical_pet_skill_operation_replays")) return [];
        if (sql.includes("canonical_owned_pet_instances")) return [{ owned_pet_id: "ownedpet" }];
        if (sql.includes("canonical_pet_skill_definitions")) return [definition];
        if (sql.includes("canonical_owned_pet_skill_stacks")) return [{ owned_pet_skill_id: "owned001", quantity: 1n }];
        return [];
      }, writes);
      await assert.rejects(() => new MariaCanonicalPetSkillRepository(db).equip({ actor: "tester", playerId: "player01", ownedPetId: "ownedpet", petSkillId: "skill001", slotNumber: 1, requestKey: "invalid-definition" }), /DEFINITION_(?:INACTIVE|OPTIONS_MALFORMED)/);
      assert.deepEqual(writes, []);
    }
  });
});
