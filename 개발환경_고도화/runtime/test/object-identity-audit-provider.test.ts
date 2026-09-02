import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isCuid } from "@paralleldrive/cuid2";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { createObjectAuditValues, createObjectIdentityCandidate, formatKstDateTime, MariaObjectIdentityAuditProvider } from "../src/identity/object-identity-audit-provider.js";

function scriptedDatabase(queries: unknown[], execute: (sql: string) => DatabaseWriteResult | Error): DatabaseClient {
  const transaction: DatabaseTransaction = {
    query: async <T>(): Promise<T> => (queries.shift() ?? []) as T,
    execute: async (sql: string): Promise<DatabaseWriteResult> => {
      const result = execute(sql);
      if (result instanceof Error) throw result;
      return result;
    }
  };
  return { ping: async () => undefined, verifyRollback: async () => true, query: transaction.query, execute: transaction.execute, withTransaction: async <T>(work: (tx: DatabaseTransaction) => Promise<T>) => work(transaction), close: async () => undefined };
}

describe("object identity and audit provider", () => {
  it("formats KST boundaries and creates identical insert/update audit values", () => {
    assert.equal(formatKstDateTime(new Date("2026-06-22T14:30:00.999Z")), "2026-06-22 23:30:00");
    assert.equal(formatKstDateTime(new Date("2026-12-31T15:00:00.000Z")), "2027-01-01 00:00:00");
    assert.deepEqual(createObjectAuditValues("migration", new Date("2026-06-22T14:30:00.999Z")), { INSERT_USER: "migration", INSERT_TIME: "2026-06-22 23:30:00", UPDATE_USER: "migration", UPDATE_TIME: "2026-06-22 23:30:00" });
  });

  it("uses the verified CUID2 implementation at exactly eight characters", () => {
    const values = new Set(Array.from({ length: 32 }, () => createObjectIdentityCandidate()));
    assert.equal(values.size, 32);
    for (const value of values) assert.equal(isCuid(value, { minLength: 8, maxLength: 8 }), true);
  });

  it("retries a confirmed PK collision and persists source text without parsing", async () => {
    let writes = 0;
    const duplicate = Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" });
    const database = scriptedDatabase([[]], () => (++writes === 1 ? duplicate : { affectedRows: 1n, insertId: 0n }));
    const candidates = ["a1234567", "b1234567", "c1234567"];
    const provider = new MariaObjectIdentityAuditProvider(database, () => candidates.shift()!, 3, () => new Date("2026-06-22T14:30:00.000Z"));
    const result = await provider.registerCrosswalk({ actor: "migration", objectType: "ITEM", sourceSystem: "LEGACY_JSON", sourceNamespace: "itemInfo", sourceIdentifier: "다이아상자💎(/다이아상자오픈)" });
    assert.equal(result.objectIdentityId, "b1234567");
    assert.equal(result.objectIdentityCrosswalkId, "c1234567");
    assert.equal(result.replayed, false);
  });

  it("fails closed when all collision retries are exhausted", async () => {
    const duplicate = Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" });
    const database = scriptedDatabase([[]], () => duplicate);
    const provider = new MariaObjectIdentityAuditProvider(database, () => "a1234567", 2);
    await assert.rejects(provider.registerCrosswalk({ actor: "migration", objectType: "ITEM", sourceSystem: "LEGACY_JSON", sourceNamespace: "itemInfo", sourceIdentifier: "상자" }), /COLLISION_RETRY_EXHAUSTED/);
  });

  it("returns an existing source mapping without creating another canonical identity", async () => {
    let writes = 0;
    const database = scriptedDatabase([[{ object_identity_crosswalk_id: "c1234567", object_identity_id: "a1234567" }]], () => { writes += 1; return { affectedRows: 1n, insertId: 0n }; });
    const provider = new MariaObjectIdentityAuditProvider(database, () => "b1234567");
    const result = await provider.registerCrosswalk({ actor: "migration", objectType: "ITEM", sourceSystem: "LEGACY_JSON", sourceNamespace: "itemInfo", sourceIdentifier: "상자" });
    assert.deepEqual({ objectIdentityId: result.objectIdentityId, objectIdentityCrosswalkId: result.objectIdentityCrosswalkId, replayed: result.replayed }, { objectIdentityId: "a1234567", objectIdentityCrosswalkId: "c1234567", replayed: true });
    assert.equal(writes, 0);
  });

  it("treats concurrent source-unique conflicts as an idempotent replay, not a PK retry", async () => {
    const sourceDuplicate = Object.assign(new Error("Duplicate entry for key 'uq_object_identity_crosswalk_source'"), { code: "ER_DUP_ENTRY" });
    let committedIdentities = 0;
    let committedCrosswalks = 0;
    let rolledBack = 0;
    let externalReads = 0;
    const transaction: DatabaseTransaction = {
      query: async <T>(): Promise<T> => [] as T,
      execute: async (sql: string): Promise<DatabaseWriteResult> => {
        if (sql.includes("object_identity_crosswalks")) throw sourceDuplicate;
        return { affectedRows: 1n, insertId: 0n };
      }
    };
    const database: DatabaseClient = {
      ping: async () => undefined, verifyRollback: async () => true, execute: transaction.execute, close: async () => undefined,
      query: async <T>(): Promise<T> => { externalReads += 1; return [{ object_identity_crosswalk_id: "c1234567", object_identity_id: "a1234567" }] as T; },
      withTransaction: async <T>(work: (tx: DatabaseTransaction) => Promise<T>): Promise<T> => {
        let stagedIdentities = 0;
        let stagedCrosswalks = 0;
        const staged: DatabaseTransaction = {
          query: transaction.query,
          execute: async (sql: string): Promise<DatabaseWriteResult> => {
            if (sql.includes("object_identity_crosswalks")) { stagedCrosswalks += 1; throw sourceDuplicate; }
            if (sql.includes("object_identities")) stagedIdentities += 1;
            return { affectedRows: 1n, insertId: 0n };
          }
        };
        try {
          const result = await work(staged);
          committedIdentities += stagedIdentities;
          committedCrosswalks += stagedCrosswalks;
          return result;
        } catch (error) {
          rolledBack += 1;
          throw error;
        }
      }
    };
    const candidates = ["a1234567", "b1234567"];
    const provider = new MariaObjectIdentityAuditProvider(database, () => candidates.shift()!, 2);
    const result = await provider.registerCrosswalk({ actor: "migration", objectType: "ITEM", sourceSystem: "LEGACY_JSON", sourceNamespace: "itemInfo", sourceIdentifier: "상자" });
    assert.deepEqual({ objectIdentityId: result.objectIdentityId, objectIdentityCrosswalkId: result.objectIdentityCrosswalkId, replayed: result.replayed }, { objectIdentityId: "a1234567", objectIdentityCrosswalkId: "c1234567", replayed: true });
    assert.deepEqual({ committedIdentities, committedCrosswalks, rolledBack, externalReads }, { committedIdentities: 0, committedCrosswalks: 0, rolledBack: 1, externalReads: 1 });
  });

  it("rejects blank, oversized, or unsafe source namespace inputs before database work", async () => {
    const database = scriptedDatabase([], () => ({ affectedRows: 1n, insertId: 0n }));
    const provider = new MariaObjectIdentityAuditProvider(database);
    await assert.rejects(provider.registerCrosswalk({ actor: "migration", objectType: "ITEM", sourceSystem: " ", sourceNamespace: "itemInfo", sourceIdentifier: "상자" }), /SOURCE_SYSTEM_INVALID/);
    await assert.rejects(provider.registerCrosswalk({ actor: "migration", objectType: "ITEM", sourceSystem: "LEGACY_JSON", sourceNamespace: "item info", sourceIdentifier: "상자" }), /SOURCE_NAMESPACE_INVALID/);
    await assert.rejects(provider.registerCrosswalk({ actor: "migration", objectType: "ITEM", sourceSystem: "LEGACY_JSON", sourceNamespace: "itemInfo", sourceIdentifier: " ".repeat(192) }), /SOURCE_IDENTIFIER_INVALID/);
    await assert.rejects(provider.registerCrosswalk({ actor: "migration", objectType: "item", sourceSystem: "LEGACY_JSON", sourceNamespace: "itemInfo", sourceIdentifier: "상자" }), /TYPE_INVALID/);
  });

  it("updates only UPDATE audit fields for an existing source mapping", async () => {
    const database = scriptedDatabase([], () => ({ affectedRows: 1n, insertId: 0n }));
    const provider = new MariaObjectIdentityAuditProvider(database, undefined, undefined, () => new Date("2026-06-22T14:30:00.000Z"));
    const audit = await provider.touchCrosswalk({ actor: "operator", sourceSystem: "LEGACY_JSON", sourceNamespace: "itemInfo", sourceIdentifier: "상자" });
    assert.deepEqual(audit, { INSERT_USER: "operator", INSERT_TIME: "2026-06-22 23:30:00", UPDATE_USER: "operator", UPDATE_TIME: "2026-06-22 23:30:00" });
    await assert.rejects(provider.touchCrosswalk({ actor: "operator", sourceSystem: " ", sourceNamespace: "itemInfo", sourceIdentifier: "상자" }), /SOURCE_SYSTEM_INVALID/);
  });
});
