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

function executeLevelReplayRaceDatabase(replay: { owned_furniture_id: string; result_status: string; operation_kind: string; payload_fingerprint: string }) {
  let transactionCount = 0;
  let operationReplayInserts = 0;
  const duplicate = Object.assign(new Error("Duplicate entry 'legacy.import/source-1' for key 'uq_object_furniture_operation_replay'"), { code: "ER_DUP_ENTRY" });
  const transaction: DatabaseTransaction = {
    query: async <T>(sql: string): Promise<T> => {
      if (sql.includes("object_furniture_operation_replays")) return (transactionCount === 1 ? [] : [replay]) as T;
      if (sql.includes("object_owned_furniture_instances") && sql.includes("JOIN object_furniture_definitions")) return [{ owned_furniture_id: "o1234567", player_id: "p1234567", furniture_id: "f1234567", enhancement_level: 0n, base_charm: 10n, charm_per_enhancement: 5n }] as T;
      if (sql.includes("object_furniture_definitions")) return [{ furniture_id: "f1234567", display_name: "다이아상자💎(/다이아상자오픈)", purchase_price: 500n, base_charm: 10n, charm_per_enhancement: 5n, active: 1 }] as T;
      if (sql.includes("canonical_players")) return [{ player_id: "p1234567" }] as T;
      if (sql.includes("SELECT owned_furniture_id,ownership_status")) return [{ owned_furniture_id: "o1234567", ownership_status: "bag" }] as T;
      if (sql.includes("object_home_furniture_placements")) return [] as T;
      if (sql.includes("object_owned_furniture_instances")) return [{ owned_furniture_id: "o1234567", player_id: "p1234567", furniture_id: "f1234567", enhancement_level: 0n, base_charm: 10n, charm_per_enhancement: 5n }] as T;
      return [] as T;
    },
    execute: async (sql: string): Promise<DatabaseWriteResult> => {
      if (sql.includes("INSERT INTO object_furniture_operation_replays")) {
        operationReplayInserts += 1;
        if (transactionCount === 1) throw duplicate;
      }
      return { affectedRows: 1n, insertId: 0n };
    }
  };
  const database: DatabaseClient = {
    ping: async () => undefined, verifyRollback: async () => true, query: transaction.query, execute: transaction.execute,
    withTransaction: async <T>(work: (tx: DatabaseTransaction) => Promise<T>) => { transactionCount += 1; return work(transaction); }, close: async () => undefined
  };
  return { database, stats: () => ({ transactionCount, operationReplayInserts }) };
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

  it("re-reads a committed grant replay after the replay INSERT has an execute-level business UNIQUE conflict", async () => {
    const replay = { owned_furniture_id: "o1234567", result_status: "granted", operation_kind: "grant_owned_furniture", payload_fingerprint: fingerprint("grant_owned_furniture", ["p1234567", "f1234567", "0"]) };
    const fixture = executeLevelReplayRaceDatabase(replay);
    const repository = new MariaCanonicalFurnitureHomeRepository(fixture.database, () => "a1234567", audit);
    assert.equal((await repository.grantOwnedFurniture({ actor: "migration", playerId: "p1234567", furnitureId: "f1234567", idempotencyScope: "legacy.import", idempotencyKey: "source-1" })).replayed, true);
    assert.deepEqual(fixture.stats(), { transactionCount: 2, operationReplayInserts: 1 });
  });

  it("re-reads a committed placement replay after the replay INSERT has an execute-level business UNIQUE conflict", async () => {
    const replay = { owned_furniture_id: "o1234567", result_status: "placed", operation_kind: "place_owned_furniture", payload_fingerprint: fingerprint("place_owned_furniture", ["p1234567", "o1234567", "0"]) };
    const fixture = executeLevelReplayRaceDatabase(replay);
    const repository = new MariaCanonicalFurnitureHomeRepository(fixture.database, () => "a1234567", audit);
    assert.equal((await repository.placeOwnedFurniture({ actor: "migration", playerId: "p1234567", ownedFurnitureId: "o1234567", placementOrder: 0n, idempotencyScope: "legacy.import", idempotencyKey: "source-1" })).replayed, true);
    assert.deepEqual(fixture.stats(), { transactionCount: 2, operationReplayInserts: 1 });
  });

  it("re-reads a committed transition replay after the replay INSERT has an execute-level business UNIQUE conflict", async () => {
    const replay = { owned_furniture_id: "o1234567", result_status: "transitioned", operation_kind: "transition_bag_to_listed", payload_fingerprint: fingerprint("transition_bag_to_listed", ["p1234567", "o1234567", "100"]) };
    const fixture = executeLevelReplayRaceDatabase(replay);
    const repository = new MariaCanonicalFurnitureHomeRepository(fixture.database, () => "a1234567", audit);
    assert.equal((await repository.transitionOwnedFurniture({ actor: "migration", playerId: "p1234567", ownedFurnitureId: "o1234567", fromStatus: "bag", toStatus: "listed", listingPrice: 100n, idempotencyScope: "legacy.import", idempotencyKey: "source-1" })).replayed, true);
    assert.deepEqual(fixture.stats(), { transactionCount: 2, operationReplayInserts: 1 });
  });

  it("rejects a transition replay when the same key changes the listing price", async () => {
    const replay = [{ owned_furniture_id: "o1234567", result_status: "transitioned", operation_kind: "transition_bag_to_listed", payload_fingerprint: fingerprint("transition_bag_to_listed", ["p1234567", "o1234567", "100"]) }];
    const repository = new MariaCanonicalFurnitureHomeRepository(scriptedDatabase([replay]), () => "a1234567", audit);
    await assert.rejects(repository.transitionOwnedFurniture({ actor: "migration", playerId: "p1234567", ownedFurnitureId: "o1234567", fromStatus: "bag", toStatus: "listed", listingPrice: 101n, idempotencyScope: "legacy.import", idempotencyKey: "source-1" }), /IDEMPOTENCY_CONFLICT/);
  });

  it("rolls back listed-to-sold when its active market listing is absent", async () => {
    let rolledBack = false;
    let writes = 0;
    const transaction: DatabaseTransaction = {
      query: async <T>(): Promise<T> => [] as T,
      execute: async (): Promise<DatabaseWriteResult> => ({ affectedRows: BigInt(++writes === 1 ? 1 : 0), insertId: 0n })
    };
    const database: DatabaseClient = {
      ping: async () => undefined, verifyRollback: async () => true, query: transaction.query, execute: transaction.execute, close: async () => undefined,
      withTransaction: async <T>(work: (tx: DatabaseTransaction) => Promise<T>) => { try { return await work(transaction); } catch (error) { rolledBack = true; throw error; } }
    };
    const repository = new MariaCanonicalFurnitureHomeRepository(database, () => "a1234567", audit);
    await assert.rejects(repository.transitionOwnedFurniture({ actor: "migration", playerId: "p1234567", ownedFurnitureId: "o1234567", fromStatus: "listed", toStatus: "sold", idempotencyScope: "legacy.import", idempotencyKey: "sold-1" }), /MARKET_STATE_INVALID/);
    assert.equal(rolledBack, true);
  });

  it("preserves cancelled and sold listing history when furniture is re-listed", async () => {
    const statusByOwned = new Map<string, string>([["o1234567", "bag"], ["q1234567", "bag"]]);
    const listingStatuses: string[] = [];
    const activeListings = new Set<string>();
    const transaction: DatabaseTransaction = {
      query: async <T>(): Promise<T> => [] as T,
      execute: async (sql: string, values: readonly unknown[] = []): Promise<DatabaseWriteResult> => {
        if (sql.startsWith("UPDATE object_owned_furniture_instances")) {
          const ownedFurnitureId = String(values[3]);
          if (values[5] !== statusByOwned.get(ownedFurnitureId)) return { affectedRows: 0n, insertId: 0n };
          statusByOwned.set(ownedFurnitureId, String(values[0]));
        } else if (sql.startsWith("INSERT INTO object_furniture_market_listings")) listingStatuses.push("active");
        else if (sql.startsWith("INSERT INTO object_furniture_active_market_listings")) activeListings.add(String(values[1]));
        else if (sql.startsWith("UPDATE object_furniture_market_listings")) {
          const active = listingStatuses.lastIndexOf("active");
          if (active < 0) return { affectedRows: 0n, insertId: 0n };
          listingStatuses[active] = String(values[0]);
        } else if (sql.startsWith("DELETE FROM object_furniture_active_market_listings")) activeListings.delete(String(values[0]));
        return { affectedRows: 1n, insertId: 0n };
      }
    };
    const database: DatabaseClient = { ping: async () => undefined, verifyRollback: async () => true, query: transaction.query, execute: transaction.execute, withTransaction: async <T>(work: (tx: DatabaseTransaction) => Promise<T>) => work(transaction), close: async () => undefined };
    const repository = new MariaCanonicalFurnitureHomeRepository(database, () => "a1234567", audit);
    const transition = (ownedFurnitureId: string, fromStatus: "bag" | "listed", toStatus: "bag" | "listed" | "sold", key: string, listingPrice?: bigint) => repository.transitionOwnedFurniture({ actor: "migration", playerId: "p1234567", ownedFurnitureId, fromStatus, toStatus, listingPrice, idempotencyScope: "market", idempotencyKey: key });
    assert.equal((await transition("o1234567", "bag", "listed", "list-1", 100n)).replayed, false);
    assert.equal((await transition("o1234567", "listed", "sold", "sold-1")).replayed, false);
    assert.equal((await transition("q1234567", "bag", "listed", "list-2", 200n)).replayed, false);
    assert.equal((await transition("q1234567", "listed", "bag", "cancel-1")).replayed, false);
    assert.equal((await transition("q1234567", "bag", "listed", "list-3", 300n)).replayed, false);
    assert.deepEqual(listingStatuses, ["sold", "cancelled", "active"]);
    assert.deepEqual([...activeListings], ["q1234567"]);
  });

  it("rejects unsupported ownership transitions before opening a transaction", async () => {
    let transactions = 0;
    const database = scriptedDatabase([]);
    const guarded: DatabaseClient = { ...database, withTransaction: async <T>(work: (tx: DatabaseTransaction) => Promise<T>) => { transactions += 1; return database.withTransaction(work); } };
    const repository = new MariaCanonicalFurnitureHomeRepository(guarded, () => "a1234567", audit);
    await assert.rejects(repository.transitionOwnedFurniture({ actor: "migration", playerId: "p1234567", ownedFurnitureId: "o1234567", fromStatus: "bag", toStatus: "sold", idempotencyScope: "market", idempotencyKey: "invalid-1" }), /TRANSITION_INVALID/);
    assert.equal(transactions, 0);
  });

  it("keeps a concurrent re-list active-listing UNIQUE conflict meaningful and rolls back", async () => {
    let rolledBack = false;
    const duplicate = Object.assign(new Error("Duplicate entry 'o1234567' for key 'uq_object_furniture_active_market_owned'"), { code: "ER_DUP_ENTRY" });
    const transaction: DatabaseTransaction = {
      query: async <T>(): Promise<T> => [] as T,
      execute: async (sql: string): Promise<DatabaseWriteResult> => {
        if (sql.startsWith("INSERT INTO object_furniture_active_market_listings")) throw duplicate;
        return { affectedRows: 1n, insertId: 0n };
      }
    };
    const database: DatabaseClient = { ping: async () => undefined, verifyRollback: async () => true, query: transaction.query, execute: transaction.execute, close: async () => undefined, withTransaction: async <T>(work: (tx: DatabaseTransaction) => Promise<T>) => { try { return await work(transaction); } catch (error) { rolledBack = true; throw error; } } };
    const repository = new MariaCanonicalFurnitureHomeRepository(database, () => "a1234567", audit);
    await assert.rejects(repository.transitionOwnedFurniture({ actor: "migration", playerId: "p1234567", ownedFurnitureId: "o1234567", fromStatus: "bag", toStatus: "listed", listingPrice: 100n, idempotencyScope: "market", idempotencyKey: "relist-1" }), /Duplicate entry/);
    assert.equal(rolledBack, true);
  });


  it("records lifecycle status and its placement detail atomically with replay", async () => {
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
