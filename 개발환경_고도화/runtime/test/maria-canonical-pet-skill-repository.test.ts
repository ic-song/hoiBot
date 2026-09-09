import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult, RootTransactionDatabaseClient } from "../src/database.js";
import { MariaCanonicalPetSkillRepository } from "../src/pet/maria-canonical-pet-skill-repository.js";

const audit = { INSERT_USER: "seed", INSERT_TIME: "2026-09-03 01:00:00", UPDATE_USER: "seed", UPDATE_TIME: "2026-09-03 01:00:00" };
const UINT64_MAX_FOR_TEST = 18_446_744_073_709_551_615n;

function databaseFor(query: (sql: string) => unknown, writes: string[]): RootTransactionDatabaseClient {
  const transaction: DatabaseTransaction = {
    query: async <T>(sql: string): Promise<T> => query(sql) as T,
    execute: async (sql: string): Promise<DatabaseWriteResult> => { writes.push(sql); return { affectedRows: 1n, insertId: 0n }; },
  };
  const root = async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(transaction);
  return { ...transaction, ping: async () => undefined, verifyRollback: async () => true, withTransaction: root, withRootTransaction: root, close: async () => undefined };
}

function lockError(errno: 1205 | 1213): Error & { code: string; errno: number } {
  return Object.assign(new Error("transaction lock"), { code: errno === 1213 ? "ER_LOCK_DEADLOCK" : "ER_LOCK_WAIT_TIMEOUT", errno });
}

function operationFingerprint(value: Record<string, string | number>): string {
  return createHash("sha256").update(JSON.stringify(Object.keys(value).sort().map((key) => [key, value[key]])), "utf8").digest("hex");
}

function grantReplayRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    pet_skill_operation_id: "oper0001", player_id: "player01", request_key: "grant-1", operation_kind: "grant",
    payload_fingerprint: operationFingerprint({ kind: "grant", petSkillId: "skill001", quantity: "3" }), pet_skill_id: "skill001",
    owned_pet_id: null, owned_pet_skill_equipment_id: null, resulting_quantity: 5n, operation_status: "completed", ...overrides,
  };
}

function mariaError(code: string | undefined, errno: number | undefined, constraint?: string): Error {
  const message = constraint === undefined ? "fixture" : `Duplicate entry 'fixture' for key '${constraint}'`;
  return Object.assign(new Error(message), { ...(code === undefined ? {} : { code }), ...(errno === undefined ? {} : { errno }), sqlMessage: message });
}

describe("MariaCanonicalPetSkillRepository", () => {
  it("grants a stack quantity and binds a payload fingerprint to replay", async () => {
    const writes: string[] = [];
    const db = databaseFor((sql) => {
      if (sql.includes("canonical_pet_skill_operation_replays")) return [];
      if (sql.includes("canonical_players")) return [{ player_id: "player01" }];
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
    const baseRow = { pet_skill_operation_id: "oper0001", player_id: "player01", request_key: "grant-1", operation_kind: "grant", payload_fingerprint: payload, pet_skill_id: "skill001", owned_pet_id: null, resulting_quantity: 5n, owned_pet_skill_equipment_id: null, operation_status: "completed" };
    const replayDb = databaseFor((sql) => sql.includes("canonical_pet_skill_operation_replays") ? [baseRow] : [], []);
    const repository = new MariaCanonicalPetSkillRepository(replayDb);
    assert.equal((await repository.grant({ actor: "tester", playerId: "player01", petSkillId: "skill001", quantity: 3n, requestKey: "grant-1" })).replayed, true);
    await assert.rejects(() => repository.grant({ actor: "tester", playerId: "player01", petSkillId: "skill001", quantity: 4n, requestKey: "grant-1" }), /REQUEST_PAYLOAD_CONFLICT/);
  });

  it("fails closed for incomplete or cross-owner grant replay rows without DML", async () => {
    const corruptions: Array<Record<string, unknown>> = [
      { operation_status: "pending" }, { pet_skill_operation_id: "bad" }, { player_id: "player02" },
      { request_key: "other" }, { pet_skill_id: "skill002" }, { resulting_quantity: 0n },
      { resulting_quantity: UINT64_MAX_FOR_TEST + 1n }, { resulting_quantity: 1 },
      { owned_pet_id: "ownedpet" }, { owned_pet_skill_equipment_id: "equip001" },
    ];
    for (const corruption of corruptions) {
      const writes: string[] = [];
      const db = databaseFor((sql) => sql.includes("canonical_pet_skill_operation_replays") ? [grantReplayRow(corruption)] : [], writes);
      await assert.rejects(
        new MariaCanonicalPetSkillRepository(db).grant({ actor: "tester", playerId: "player01", petSkillId: "skill001", quantity: 3n, requestKey: "grant-1" }),
        /CANONICAL_PET_SKILL_(?:REPLAY_INCOMPLETE|REQUEST_PAYLOAD_CONFLICT)/,
      );
      assert.equal(writes.length, 0);
    }
  });

  it("validates grant storage boundaries before opening a transaction", async () => {
    const invalid = [
      { actor: "", quantity: 1n }, { actor: "a".repeat(101), quantity: 1n }, { actor: "tester", quantity: 0n },
      { actor: "tester", quantity: UINT64_MAX_FOR_TEST + 1n }, { actor: "tester", quantity: 1 as unknown as bigint }, { actor: "tester", quantity: "1" as unknown as bigint },
    ];
    for (const value of invalid) {
      const writes: string[] = [];
      const db = databaseFor(() => [], writes);
      await assert.rejects(new MariaCanonicalPetSkillRepository(db).grant({ actor: value.actor, playerId: "player01", petSkillId: "skill001", quantity: value.quantity, requestKey: "grant-1" }), /CANONICAL_PET_SKILL_(?:ACTOR|QUANTITY)_INVALID/);
      assert.equal(writes.length, 0);
    }
  });

  it("accepts request keys across the historical 182/183 boundary", async () => {
    for (const length of [182, 183]) {
      const requestKey = "k".repeat(length);
      const db = databaseFor((sql) => sql.includes("canonical_pet_skill_operation_replays") ? [grantReplayRow({ request_key: requestKey })] : [], []);
      const result = await new MariaCanonicalPetSkillRepository(db).grant({ actor: "tester", playerId: "player01", petSkillId: "skill001", quantity: 3n, requestKey });
      assert.equal(result.replayed, true);
    }
  });

  it("uses replay-player-definition-stack locks and two domain writes for an absent stack", async () => {
    const writes: string[] = [];
    const reads: string[] = [];
    let crosswalk = 0;
    const transaction: DatabaseTransaction = {
      query: async <T>(sql: string): Promise<T> => {
        reads.push(sql);
        if (sql.includes("canonical_pet_skill_operation_replays")) return [] as T;
        if (sql.includes("canonical_players")) return [{ player_id: "player01" }] as T;
        if (sql.includes("canonical_pet_skill_definitions")) return [{ pet_skill_id: "skill001", active_flag: 1, handler_key: "presentation_only", options_json: {} }] as T;
        if (sql.includes("canonical_owned_pet_skill_stacks")) return [] as T;
        if (sql.includes("object_identity_crosswalks")) return [{ object_identity_crosswalk_id: `cross00${++crosswalk}`, object_identity_id: crosswalk === 1 ? "oper0001" : "stack001", ...audit }] as T;
        return [] as T;
      },
      execute: async (sql: string): Promise<DatabaseWriteResult> => { writes.push(sql); return { affectedRows: 1n, insertId: 0n }; },
    };
    const root = async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(transaction);
    const db: RootTransactionDatabaseClient = { ...transaction, ping: async () => undefined, verifyRollback: async () => true, withTransaction: root, withRootTransaction: root, close: async () => undefined };
    const result = await new MariaCanonicalPetSkillRepository(db).grant({ actor: "tester", playerId: "player01", petSkillId: "skill001", quantity: 3n, requestKey: "grant-1" });
    assert.deepEqual(reads.filter((sql) => sql.includes("canonical_")).map((sql) => /FROM\s+(\w+)/i.exec(sql)?.[1]), [
      "canonical_pet_skill_operation_replays", "canonical_players", "canonical_pet_skill_definitions", "canonical_owned_pet_skill_stacks",
    ]);
    assert.equal(result.resultingQuantity, 3n);
    assert.deepEqual(writes.filter((sql) => /canonical_(?:owned_pet_skill_stacks|pet_skill_operation_replays)/.test(sql)).map((sql) => sql.split("(")[0]), [
      "INSERT INTO canonical_owned_pet_skill_stacks", "INSERT INTO canonical_pet_skill_operation_replays",
    ]);
  });

  it("requires exactly one owner-bound stack update", async () => {
    const writes: string[] = [];
    const base = databaseFor((sql) => {
      if (sql.includes("canonical_pet_skill_operation_replays")) return [];
      if (sql.includes("canonical_players")) return [{ player_id: "player01" }];
      if (sql.includes("canonical_pet_skill_definitions")) return [{ pet_skill_id: "skill001", active_flag: 1, handler_key: "presentation_only", options_json: {} }];
      if (sql.includes("canonical_owned_pet_skill_stacks")) return [{ owned_pet_skill_id: "stack001", quantity: 2n }];
      if (sql.includes("object_identity_crosswalks")) return [{ object_identity_crosswalk_id: "cross001", object_identity_id: "oper0001", ...audit }];
      return [];
    }, writes);
    const transaction: DatabaseTransaction = { ...base, execute: async (sql: string): Promise<DatabaseWriteResult> => {
      writes.push(sql);
      return { affectedRows: sql.startsWith("UPDATE canonical_owned_pet_skill_stacks") ? 0n : 1n, insertId: 0n };
    } };
    const db: RootTransactionDatabaseClient = { ...base, withRootTransaction: async (work) => work(transaction) };
    await assert.rejects(
      new MariaCanonicalPetSkillRepository(db).grant({ actor: "tester", playerId: "player01", petSkillId: "skill001", quantity: 3n, requestKey: "grant-1" }),
      /CANONICAL_PET_SKILL_STACK_UPDATE_FAILED/,
    );
    assert.match(writes[0] ?? "", /WHERE owned_pet_skill_id=\? AND player_id=\? AND pet_skill_id=\?/);
    assert.equal(writes.some((sql) => sql.startsWith("INSERT INTO canonical_pet_skill_operation_replays")), false);
  });

  it("reconciles only the exact grant replay unique constraint", async () => {
    for (const error of [
      mariaError("ER_DUP_ENTRY", 1062, "PRIMARY"),
      mariaError("ER_DUP_ENTRY", 1062, "uq_other"),
      mariaError("ER_DUP_ENTRY", undefined, "uq_canonical_pet_skill_operation_request"),
      mariaError(undefined, 1062, "uq_canonical_pet_skill_operation_request"),
    ]) {
      let reads = 0;
      const base = databaseFor(() => { reads += 1; return []; }, []);
      const db: RootTransactionDatabaseClient = { ...base, withRootTransaction: async () => { throw error; } };
      await assert.rejects(
        new MariaCanonicalPetSkillRepository(db).grant({ actor: "tester", playerId: "player01", petSkillId: "skill001", quantity: 3n, requestKey: "grant-1" }),
        (caught) => caught === error,
      );
      assert.equal(reads, 0);
    }

    const exact = mariaError("ER_DUP_ENTRY", 1062, "uq_canonical_pet_skill_operation_request");
    const base = databaseFor(() => [], []);
    const db: RootTransactionDatabaseClient = {
      ...base,
      withRootTransaction: async () => { throw exact; },
      query: async <T>(): Promise<T> => [grantReplayRow()] as T,
    };
    assert.equal((await new MariaCanonicalPetSkillRepository(db).grant({ actor: "tester", playerId: "player01", petSkillId: "skill001", quantity: 3n, requestKey: "grant-1" })).replayed, true);
  });

  it("retries a different-key absent-stack conflict as a fresh mutation without false replay", async () => {
    let attempts = 0;
    let outsideReads = 0;
    const writes: string[] = [];
    const rootDb = databaseFor(() => { outsideReads += 1; return []; }, writes);
    const db: RootTransactionDatabaseClient = {
      ...rootDb,
      withRootTransaction: async <T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> => {
        attempts += 1;
        if (attempts === 1) throw lockError(1213);
        return work({
          query: async <R>(sql: string): Promise<R> => {
            if (sql.includes("canonical_pet_skill_operation_replays")) return [] as R;
            if (sql.includes("canonical_players")) return [{ player_id: "player01" }] as R;
            if (sql.includes("canonical_pet_skill_definitions")) return [{ pet_skill_id: "skill001", active_flag: 1, handler_key: "presentation_only", options_json: {} }] as R;
            if (sql.includes("canonical_owned_pet_skill_stacks")) return [{ owned_pet_skill_id: "stack001", quantity: 2n }] as R;
            if (sql.includes("object_identity_crosswalks")) return [{ object_identity_crosswalk_id: "cross001", object_identity_id: "oper0001", ...audit }] as R;
            return [] as R;
          },
          execute: async (sql: string): Promise<DatabaseWriteResult> => { writes.push(sql); return { affectedRows: 1n, insertId: 0n }; },
        });
      },
    };
    const result = await new MariaCanonicalPetSkillRepository(db).grant({ actor: "tester", playerId: "player01", petSkillId: "skill001", quantity: 3n, requestKey: "different-key" });
    assert.deepEqual({ attempts, outsideReads, quantity: result.resultingQuantity, replayed: result.replayed }, { attempts: 2, outsideReads: 0, quantity: 5n, replayed: false });
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
    for (const slotNumber of [30,31,40]) {
      const accepted=databaseFor(()=>[],[]);
      await assert.rejects(() => new MariaCanonicalPetSkillRepository(accepted).equip({ actor: "tester", playerId: "player01", ownedPetId: "ownedpet", petSkillId: "skill001", slotNumber, requestKey: `accepted-${slotNumber}` }), /OWNED_PET_NOT_FOUND/);
    }
    for (const slotNumber of [0,41]) await assert.rejects(() => repository.equip({ actor: "tester", playerId: "player01", ownedPetId: "ownedpet", petSkillId: "skill001", slotNumber, requestKey: `rejected-${slotNumber}` }), /SLOT_INVALID/);
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
    const grantRow = { pet_skill_operation_id: "oper0001", player_id: "player01", request_key: "grant-lock", operation_kind: "grant", payload_fingerprint: grantPayload, pet_skill_id: "skill001", owned_pet_id: null, resulting_quantity: 4n, owned_pet_skill_equipment_id: null, operation_status: "completed" };
    const grantDb: RootTransactionDatabaseClient = { ...databaseFor(() => [], []), withRootTransaction: async () => { throw lockError(1205); }, query: async <T>(): Promise<T> => [grantRow] as T };
    assert.equal((await new MariaCanonicalPetSkillRepository(grantDb).grant({ actor: "tester", playerId: "player01", petSkillId: "skill001", quantity: 2n, requestKey: "grant-lock" })).replayed, true);

    const equipPayload = operationFingerprint({ kind: "equip", ownedPetId: "ownedpet", petSkillId: "skill001", slotNumber: 1 });
    const equipDb: DatabaseClient = { ...databaseFor(() => [], []), withTransaction: async () => { throw lockError(1213); }, query: async <T>(): Promise<T> => [{ pet_skill_operation_id: "oper0002", operation_kind: "equip", payload_fingerprint: equipPayload, resulting_quantity: 0n, owned_pet_skill_equipment_id: "equip001" }] as T };
    assert.equal((await new MariaCanonicalPetSkillRepository(equipDb).equip({ actor: "tester", playerId: "player01", ownedPetId: "ownedpet", petSkillId: "skill001", slotNumber: 1, requestKey: "equip-lock" })).replayed, true);
    await assert.rejects(() => new MariaCanonicalPetSkillRepository(grantDb).grant({ actor: "tester", playerId: "player01", petSkillId: "skill001", quantity: 3n, requestKey: "grant-lock" }), /REQUEST_PAYLOAD_CONFLICT/);
  });

  it("limits lock retries and exposes exhaustion when no committed replay exists", async () => {
    for (const operation of ["definition", "grant", "equip"] as const) {
      let attempts = 0;
      const base = databaseFor(() => [], []);
      const fail = async <T>(): Promise<T> => { attempts += 1; throw lockError(operation === "grant" ? 1205 : 1213); };
      const db: RootTransactionDatabaseClient = { ...base, withTransaction: fail, withRootTransaction: operation === "grant" ? fail : base.withRootTransaction, query: async <T>(): Promise<T> => [] as T };
      const repository = new MariaCanonicalPetSkillRepository(db);
      const call = operation === "definition"
        ? repository.registerDefinition({ actor: "tester", sourceSystem: "LEGACY_JSON", sourceNamespace: "PET_SKILL_LIST", sourceIdentifier: "skill_050", petSkillName: "롤렉스", handlerKey: "command_unlock", options: { commandIdentifier: "pet_skill_boast" } })
        : operation === "grant"
          ? repository.grant({ actor: "tester", playerId: "player01", petSkillId: "skill001", quantity: 1n, requestKey: "lock" })
          : repository.equip({ actor: "tester", playerId: "player01", ownedPetId: "ownedpet", petSkillId: "skill001", slotNumber: 1, requestKey: "lock" });
      await assert.rejects(() => call, operation === "grant" ? /GRANT_TRANSACTION_RETRY_EXHAUSTED/ : /transaction lock/);
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
