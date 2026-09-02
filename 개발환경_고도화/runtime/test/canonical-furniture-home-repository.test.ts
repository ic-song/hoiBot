import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { calculateCanonicalFurnitureCharm, MariaCanonicalFurnitureHomeRepository } from "../src/home/canonical-furniture-home-repository.js";

const audit = (actor: string, now: Date) => {
  const timestamp = now.toISOString().replace("T", " ").slice(0, 19);
  return { INSERT_USER: actor, INSERT_TIME: timestamp, UPDATE_USER: actor, UPDATE_TIME: timestamp };
};

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
        if (sql.includes("object_furniture_players")) return [{ player_id: "p1234567" }] as T;
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
      [{ owned_furniture_id: "o1234567", result_status: "granted" }],
      [{ owned_furniture_id: "o1234567", player_id: "p1234567", furniture_id: "f1234567", enhancement_level: 2n, ownership_status: "bag", base_charm: 10n, charm_per_enhancement: 5n }]
    ]);
    const repository = new MariaCanonicalFurnitureHomeRepository(database, () => "o7654321", audit);
    const result = await repository.grantOwnedFurniture({ actor: "migration", playerId: "p1234567", furnitureId: "f1234567", idempotencyScope: "legacy.import", idempotencyKey: "source-1" });
    assert.deepEqual(result, { furniture: { ownedFurnitureId: "o1234567", playerId: "p1234567", furnitureId: "f1234567", enhancementLevel: 2n, finalCharm: 20n, ownershipStatus: "bag" }, replayed: true });
  });
});
