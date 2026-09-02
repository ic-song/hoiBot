import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { calculateCanonicalFurnitureCharm, MariaCanonicalFurnitureHomeRepository } from "../src/home/canonical-furniture-home-repository.js";

const audit = (actor: string, now: Date) => {
  const timestamp = now.toISOString().replace("T", " ").slice(0, 19);
  return { INSERT_USER: actor, INSERT_TIME: timestamp, UPDATE_USER: actor, UPDATE_TIME: timestamp };
};
const fingerprint = (kind: string, values: string[]) => createHash("sha256").update(JSON.stringify([kind, ...values])).digest("hex");

function scriptedDatabase(queries: unknown[]): DatabaseClient {
  const transaction: DatabaseTransaction = {
    query: async <T>(): Promise<T> => (queries.shift() ?? []) as T,
    execute: async (): Promise<DatabaseWriteResult> => ({ affectedRows: 1n, insertId: 0n })
  };
  return { ping: async () => undefined, verifyRollback: async () => true, query: transaction.query, execute: transaction.execute, withTransaction: async <T>(work: (tx: DatabaseTransaction) => Promise<T>) => work(transaction), close: async () => undefined };
}

describe("canonical furniture home repository", () => {
  it("calculates current charm from definition and enhancement without an instance snapshot", () => {
    assert.equal(calculateCanonicalFurnitureCharm(120n, 15n, 3n), 165n);
    assert.throws(() => calculateCanonicalFurnitureCharm(120n, 15n, -1n), /ENHANCEMENT_INVALID/);
  });

  it("creates distinct owned instance rows for repeated ownership and writes replay data in one transaction", async () => {
    const statements: string[] = [];
    const transaction: DatabaseTransaction = {
      query: async <T>(sql: string): Promise<T> => {
        statements.push(sql);
        if (sql.includes("object_furniture_operation_replays")) return [] as T;
        if (sql.includes("object_furniture_definitions")) return [{ furniture_id: "f1234567", display_name: "다이아상자💎(/다이아상자오픈)", purchase_price: 500n, base_charm: 120n, charm_per_enhancement: 15n, active: 1 }] as T;
        if (sql.includes("canonical_players")) return [{ player_id: "p1234567" }] as T;
        return [] as T;
      },
      execute: async (sql: string): Promise<DatabaseWriteResult> => { statements.push(sql); return { affectedRows: 1n, insertId: 0n }; }
    };
    const database: DatabaseClient = { ping: async () => undefined, verifyRollback: async () => true, query: transaction.query, execute: transaction.execute, withTransaction: async <T>(work: (tx: DatabaseTransaction) => Promise<T>) => work(transaction), close: async () => undefined };
    const ids = ["o1234567", "r1234567"];
    const repository = new MariaCanonicalFurnitureHomeRepository(database, () => ids.shift()!, audit, () => new Date("2026-06-22T14:30:00.000Z"));
    const result = await repository.grantOwnedFurniture({ actor: "migration", playerId: "p1234567", furnitureId: "f1234567", enhancementLevel: 3n, idempotencyScope: "legacy.import", idempotencyKey: "source-1" });
    assert.deepEqual(result, { furniture: { ownedFurnitureId: "o1234567", playerId: "p1234567", furnitureId: "f1234567", enhancementLevel: 3n, finalCharm: 165n, ownershipStatus: "bag" }, replayed: false });
    assert.ok(statements.some((sql) => sql.includes("INSERT INTO object_owned_furniture_instances")));
    assert.ok(statements.some((sql) => sql.includes("INSERT INTO object_furniture_operation_replays")));
  });

  it("returns an existing operation as a replay rather than creating another owned instance", async () => {
    const database = scriptedDatabase([
      [{ owned_furniture_id: "o1234567", result_status: "granted", operation_kind: "grant_owned_furniture", payload_fingerprint: fingerprint("grant_owned_furniture", ["p1234567", "f1234567", "0"]) }],
      [{ owned_furniture_id: "o1234567", player_id: "p1234567", furniture_id: "f1234567", enhancement_level: 2n, base_charm: 10n, charm_per_enhancement: 5n }]
    ]);
    const repository = new MariaCanonicalFurnitureHomeRepository(database, () => "o7654321", audit);
    const result = await repository.grantOwnedFurniture({ actor: "migration", playerId: "p1234567", furnitureId: "f1234567", idempotencyScope: "legacy.import", idempotencyKey: "source-1" });
    assert.deepEqual(result, { furniture: { ownedFurnitureId: "o1234567", playerId: "p1234567", furnitureId: "f1234567", enhancementLevel: 2n, finalCharm: 20n, ownershipStatus: "bag" }, replayed: true });
  });

  it("rejects a reused idempotency key when the action or payload differs", async () => {
    const database = scriptedDatabase([[{ owned_furniture_id: "o1234567", result_status: "granted", operation_kind: "grant_owned_furniture", payload_fingerprint: "0".repeat(64) }]]);
    const repository = new MariaCanonicalFurnitureHomeRepository(database, () => "a1234567", audit);
    await assert.rejects(repository.grantOwnedFurniture({ actor: "migration", playerId: "p1234567", furnitureId: "f1234567", idempotencyScope: "legacy.import", idempotencyKey: "source-1" }), /IDEMPOTENCY_CONFLICT/);
  });

  it("retries a concurrent unique-key race and returns the committed replay", async () => {
    const duplicate = Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" });
    let attempts = 0, reads = 0;
    const transaction: DatabaseTransaction = { query: async <T>(): Promise<T> => (++reads === 1 ? [{ owned_furniture_id: "o1234567", result_status: "granted", operation_kind: "grant_owned_furniture", payload_fingerprint: fingerprint("grant_owned_furniture", ["p1234567", "f1234567", "0"]) }] : [{ owned_furniture_id: "o1234567", player_id: "p1234567", furniture_id: "f1234567", enhancement_level: 0n, base_charm: 10n, charm_per_enhancement: 5n }]) as T, execute: async (): Promise<DatabaseWriteResult> => ({ affectedRows: 1n, insertId: 0n }) };
    const database: DatabaseClient = { ping: async () => undefined, verifyRollback: async () => true, query: transaction.query, execute: transaction.execute, close: async () => undefined, withTransaction: async <T>(work: (tx: DatabaseTransaction) => Promise<T>) => { attempts += 1; if (attempts === 1) throw duplicate; return work(transaction); } };
    const repository = new MariaCanonicalFurnitureHomeRepository(database, () => "a1234567", audit);
    const result = await repository.grantOwnedFurniture({ actor: "migration", playerId: "p1234567", furnitureId: "f1234567", idempotencyScope: "legacy.import", idempotencyKey: "source-1" });
    assert.equal(result.replayed, true);
    assert.equal(attempts, 2);
  });


  it("uses placement existence as the only placed-state source and records it atomically with replay", async () => {
    const statements: string[] = [];
    const transaction: DatabaseTransaction = {
      query: async <T>(sql: string): Promise<T> => {
        statements.push(sql);
        if (sql.includes("object_furniture_operation_replays")) return [] as T;
        if (sql.includes("object_owned_furniture_instances")) return [{ owned_furniture_id: "o1234567", ownership_status: "bag" }] as T;
        if (sql.includes("object_home_furniture_placements")) return [] as T;
        return [] as T;
      },
      execute: async (sql: string): Promise<DatabaseWriteResult> => { statements.push(sql); return { affectedRows: 1n, insertId: 0n }; }
    };
    const database: DatabaseClient = { ping: async () => undefined, verifyRollback: async () => true, query: transaction.query, execute: transaction.execute, withTransaction: async <T>(work: (tx: DatabaseTransaction) => Promise<T>) => work(transaction), close: async () => undefined };
    const ids = ["a1234567", "b1234567", "c1234567"];
    const repository = new MariaCanonicalFurnitureHomeRepository(database, () => ids.shift()!, audit);
    assert.deepEqual(await repository.placeOwnedFurniture({ actor: "migration", playerId: "p1234567", ownedFurnitureId: "o1234567", placementOrder: 0n, idempotencyScope: "legacy.import", idempotencyKey: "place-1" }), { ownedFurnitureId: "o1234567", replayed: false });
    assert.ok(statements.some((sql) => sql.includes("INSERT INTO object_home_furniture_placements")));
    assert.ok(statements.some((sql) => sql.includes("INSERT INTO object_furniture_operation_replays")));
    assert.ok(statements.some((sql) => sql.includes("UPDATE object_owned_furniture_instances SET ownership_status='placed'")));
    assert.ok(statements.some((sql) => sql.includes("INSERT INTO object_furniture_ownership_history")));
  });
});
