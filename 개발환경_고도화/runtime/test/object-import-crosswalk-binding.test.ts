import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { MariaObjectIdentityAuditProvider, type ObjectImportBindingInput } from "../src/identity/object-identity-audit-provider.js";

const fingerprintA = "a".repeat(64);
const fingerprintB = "b".repeat(64);
const sourceLocator = "c".repeat(64);
const input: ObjectImportBindingInput = {
  actor: "object-domain-import",
  objectType: "OWNED_MINI_PET",
  sourceSystem: "LEGACY_JSON",
  sourceNamespace: "member_pet.miniPetBag",
  sourceLocatorSha256: sourceLocator,
  payloadFingerprint: fingerprintA
};

function unusedDatabase(): DatabaseClient {
  const fail = async (): Promise<never> => { throw new Error("OUTER_DATABASE_MUST_NOT_BE_USED"); };
  return { ping: fail, verifyRollback: fail, query: fail, execute: fail, withTransaction: fail, close: fail };
}

function writeResult(): DatabaseWriteResult {
  return { affectedRows: 1n, insertId: 0n };
}

describe("object import crosswalk binding", () => {
  it("adds a nullable lowercase SHA-256 column through a forward-only contract update", () => {
    const migration = readFileSync(new URL("../migrations/454_object_import_crosswalk_payload_fingerprint.sql", import.meta.url), "utf8");
    const rollback = readFileSync(new URL("../migrations/rollback/454_object_import_crosswalk_payload_fingerprint.rollback.sql", import.meta.url), "utf8");
    const contract = JSON.parse(readFileSync(new URL("../../migration-control/contracts/object-data-model-standard.v1.json", import.meta.url), "utf8")) as { registeredMigrations: string[]; tables: Array<{ table: string; columns: Array<{ name: string; type: string; charset?: string; collation?: string }> }> };
    assert.match(migration, /payload_fingerprint CHAR\(64\) CHARACTER SET ascii COLLATE ascii_bin NULL/);
    assert.match(migration, /payload_fingerprint IS NULL OR payload_fingerprint REGEXP '\^\[0-9a-f\]\{64\}\$'/);
    assert.match(rollback, /DROP COLUMN payload_fingerprint/);
    assert.ok(contract.registeredMigrations.includes("454_object_import_crosswalk_payload_fingerprint.sql"));
    const column = contract.tables.find((table) => table.table === "object_identity_crosswalks")?.columns.find((entry) => entry.name === "payload_fingerprint");
    assert.deepEqual(column, { name: "payload_fingerprint", type: "CHAR(64)", charset: "ascii", collation: "ascii_bin" });
  });

  it("creates identity and locator binding in the caller transaction with a separate payload fingerprint", async () => {
    const writes: Array<{ sql: string; values: readonly unknown[] }> = [];
    const transaction: DatabaseTransaction = {
      query: async <T>(): Promise<T> => [] as T,
      execute: async (sql, values = []) => { writes.push({ sql, values }); return writeResult(); }
    };
    const candidates = ["a1234567", "b1234567"];
    const provider = new MariaObjectIdentityAuditProvider(unusedDatabase(), () => candidates.shift()!, 2, () => new Date("2026-06-22T14:30:00Z"));

    const result = await provider.registerImportBinding(transaction, input);

    assert.deepEqual({ id: result.objectIdentityId, crosswalk: result.objectIdentityCrosswalkId, replayed: result.replayed }, { id: "a1234567", crosswalk: "b1234567", replayed: false });
    assert.equal(writes.length, 2);
    assert.match(writes[1]!.sql, /payload_fingerprint/);
    assert.equal(writes[1]!.values[4], sourceLocator);
    assert.equal(writes[1]!.values[5], fingerprintA);
  });

  it("returns a same locator, type and payload as a read-only replay", async () => {
    let writes = 0;
    const transaction: DatabaseTransaction = {
      query: async <T>(): Promise<T> => [{ object_identity_crosswalk_id: "b1234567", object_identity_id: "a1234567", object_type: input.objectType, payload_fingerprint: fingerprintA, INSERT_USER: "first-import", INSERT_TIME: "2026-06-22 23:00:00", UPDATE_USER: "first-import", UPDATE_TIME: "2026-06-22 23:00:00" }] as T,
      execute: async () => { writes += 1; return writeResult(); }
    };
    const result = await new MariaObjectIdentityAuditProvider(unusedDatabase()).registerImportBinding(transaction, input);
    assert.equal(result.replayed, true);
    assert.equal(result.audit.INSERT_USER, "first-import");
    assert.equal(writes, 0);
  });

  it("retries only a crosswalk primary-key collision", async () => {
    const duplicate = Object.assign(new Error("Duplicate entry 'b1234567' for key 'PRIMARY'"), { code: "ER_DUP_ENTRY" });
    const crosswalkCandidates: string[] = [];
    let crosswalkAttempts = 0;
    const transaction: DatabaseTransaction = {
      query: async <T>(): Promise<T> => [] as T,
      execute: async (sql, values = []) => {
        if (sql.includes("object_identity_crosswalks")) {
          crosswalkCandidates.push(String(values[0]));
          if (++crosswalkAttempts === 1) throw duplicate;
        }
        return writeResult();
      }
    };
    const candidates = ["a1234567", "b1234567", "c1234567"];
    const result = await new MariaObjectIdentityAuditProvider(unusedDatabase(), () => candidates.shift()!, 3).registerImportBinding(transaction, input);
    assert.deepEqual(crosswalkCandidates, ["b1234567", "c1234567"]);
    assert.equal(result.objectIdentityCrosswalkId, "c1234567");
  });

  it("fails closed without writes on payload drift, type mismatch or an unverifiable legacy row", async () => {
    for (const row of [
      { object_type: input.objectType, payload_fingerprint: fingerprintB, error: /PAYLOAD_DRIFT/ },
      { object_type: "OWNED_FURNITURE", payload_fingerprint: fingerprintA, error: /TYPE_MISMATCH/ },
      { object_type: input.objectType, payload_fingerprint: null, error: /PAYLOAD_UNVERIFIED/ }
    ]) {
      let writes = 0;
      const transaction: DatabaseTransaction = {
        query: async <T>(): Promise<T> => [{ object_identity_crosswalk_id: "b1234567", object_identity_id: "a1234567", object_type: row.object_type, payload_fingerprint: row.payload_fingerprint, INSERT_USER: "legacy", INSERT_TIME: "2026-06-22 23:00:00", UPDATE_USER: "legacy", UPDATE_TIME: "2026-06-22 23:00:00" }] as T,
        execute: async () => { writes += 1; return writeResult(); }
      };
      await assert.rejects(new MariaObjectIdentityAuditProvider(unusedDatabase()).registerImportBinding(transaction, input), row.error);
      assert.equal(writes, 0);
    }
  });

  it("requires a lowercase SHA-256 payload independently of the locator", async () => {
    let reads = 0;
    const transaction: DatabaseTransaction = {
      query: async <T>(): Promise<T> => { reads += 1; return [] as T; },
      execute: async () => writeResult()
    };
    await assert.rejects(new MariaObjectIdentityAuditProvider(unusedDatabase()).registerImportBinding(transaction, { ...input, payloadFingerprint: "A".repeat(64) }), /PAYLOAD_FINGERPRINT_INVALID/);
    await assert.rejects(new MariaObjectIdentityAuditProvider(unusedDatabase()).registerImportBinding(transaction, { ...input, sourceLocatorSha256: "C".repeat(64) }), /SOURCE_LOCATOR_INVALID/);
    assert.equal(reads, 0);
  });

  it("lets the caller roll back the whole transaction when the first binding attempt fails", async () => {
    const committed: string[] = [];
    let rollbacks = 0;
    const runCallerTransaction = async <T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> => {
      const staged: string[] = [];
      const transaction: DatabaseTransaction = {
        query: async <R>(): Promise<R> => [] as R,
        execute: async (sql) => {
          if (sql.includes("object_identity_crosswalks")) throw new Error("SIMULATED_CROSSWALK_FAILURE");
          staged.push(sql);
          return writeResult();
        }
      };
      try {
        const result = await work(transaction);
        committed.push(...staged);
        return result;
      } catch (error) {
        rollbacks += 1;
        throw error;
      }
    };
    const candidates = ["a1234567", "b1234567"];
    const provider = new MariaObjectIdentityAuditProvider(unusedDatabase(), () => candidates.shift()!);

    await assert.rejects(runCallerTransaction((transaction) => provider.registerImportBinding(transaction, input)), /SIMULATED_CROSSWALK_FAILURE/);
    assert.equal(rollbacks, 1);
    assert.deepEqual(committed, []);
  });
});
