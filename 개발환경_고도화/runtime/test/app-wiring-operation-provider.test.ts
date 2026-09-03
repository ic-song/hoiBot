import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { MariaAppWiringOperationProvider } from "../src/dispatch/app-wiring-operation-provider.js";
import { createEnvironmentContext, verifyStartupDatabaseIdentity } from "../src/runtime/environment-context.js";

type Stored = Record<string, unknown>;

class MemoryDatabase implements DatabaseClient {
  row: Stored | undefined;
  readonly domainWrites: string[] = [];

  async ping(): Promise<void> {}
  async verifyRollback(): Promise<boolean> { return true; }
  async close(): Promise<void> {}
  async withTransaction<T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> {
    const snapshot = this.row === undefined ? undefined : { ...this.row };
    try { return await work(this); } catch (error) { this.row = snapshot; throw error; }
  }

  async query<T>(sql: string, values: readonly unknown[] = []): Promise<T> {
    if (sql === "SELECT DATABASE() AS database_identity") return [{ database_identity: "hoi_bot" }] as T;
    if (sql.includes("FROM canonical_app_wiring_operations")) {
      const matched = this.row?.request_identity_fingerprint === values[0] ? [this.row] : [];
      return matched as T;
    }
    return [] as T;
  }

  async execute(sql: string, values: readonly unknown[] = []): Promise<DatabaseWriteResult> {
    if (sql.startsWith("INSERT INTO canonical_app_wiring_operations")) {
      if (this.row !== undefined) throw Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" });
      this.row = {
        app_wiring_operation_id: values[0], request_identity_fingerprint: values[1], request_namespace: values[2],
        entrypoint_kind: values[3], external_request_id: values[4], request_key: values[5], payload_fingerprint: values[6],
        environment_code: values[7], database_identity: values[8], route: values[9], reason_code: values[10],
        command_code: values[11], handler_key: values[12], claim_state: "CLAIMED", result_json: null, error_code: null
      };
      return { affectedRows: 1n, insertId: 0n };
    }
    if (sql.includes("SET claim_state='MUTATION_STARTED'")) {
      if (this.row?.claim_state !== "CLAIMED") return { affectedRows: 0n, insertId: 0n };
      this.row.claim_state = "MUTATION_STARTED";
      return { affectedRows: 1n, insertId: 0n };
    }
    if (sql.startsWith("UPDATE canonical_app_wiring_operations SET claim_state=?")) {
      if (this.row === undefined || !["CLAIMED", "MUTATION_STARTED"].includes(String(this.row.claim_state))) return { affectedRows: 0n, insertId: 0n };
      this.row.claim_state = values[0]; this.row.result_json = values[1]; this.row.error_code = values[2];
      return { affectedRows: 1n, insertId: 0n };
    }
    this.domainWrites.push(sql);
    return { affectedRows: 1n, insertId: 0n };
  }
}

const now = () => new Date("2026-09-04T00:00:00.000Z");
const provider = async (database: MemoryDatabase) => new MariaAppWiringOperationProvider(
  database,
  await verifyStartupDatabaseIdentity(database, createEnvironmentContext({ environmentCode: "dev", databaseIdentity: "hoi_bot" })),
  () => "a1234567", 1, now
);

describe("MariaAppWiringOperationProvider", () => {
  it("derives the exact request identity and payload fingerprints before persisting a claim", async () => {
    const database = new MemoryDatabase();
    const execution = await (await provider(database)).acquire({ entrypointKind: "IRIS", externalRequestId: "evt-1", normalizedPayload: { message: "안녕" }, actor: "iris" }, () => ({ route: "MODERN", reasonCode: "ROLLOUT_ENABLED", commandCode: "HELLO" }));
    assert.equal(execution.replayed, false);
    assert.equal(execution.claim.requestKey, "IRIS:evt-1");
    assert.equal(execution.claim.requestIdentityFingerprint, createHash("sha256").update(JSON.stringify(["hoibot:dev:hoi_bot", "IRIS", "evt-1"]), "utf8").digest("hex"));
    assert.equal(execution.claim.payloadFingerprint, createHash("sha256").update(JSON.stringify({ message: "안녕" }), "utf8").digest("hex"));
    assert.equal(database.row?.claim_state, "CLAIMED");
  });

  it("replays a terminal persisted route without resolving the current rollout again", async () => {
    const database = new MemoryDatabase();
    const first = await (await provider(database)).acquire({ entrypointKind: "WEB", externalRequestId: "req-1", normalizedPayload: [1, 2], actor: "web" }, () => ({ route: "LEGACY_FALLBACK", reasonCode: "ROLLOUT_DISABLED", handlerKey: "legacy.web" }));
    await first.complete({ status: "LEGACY" });
    let resolved = false;
    const replay = await (await provider(database)).acquire({ entrypointKind: "WEB", externalRequestId: "req-1", normalizedPayload: [1, 2], actor: "web" }, () => { resolved = true; return { route: "MODERN", reasonCode: "ROLLOUT_ENABLED", handlerKey: "modern.web" }; });
    assert.equal(replay.replayed, true);
    assert.equal(replay.claim.route, "LEGACY_FALLBACK");
    assert.equal(resolved, false);
  });

  it("fails closed when the same request identity carries different payload", async () => {
    const database = new MemoryDatabase();
    await (await provider(database)).acquire({ entrypointKind: "ADMIN", externalRequestId: "req-2", normalizedPayload: { value: 1 }, actor: "admin" }, () => ({ route: "MODERN", reasonCode: "ADMIN_ROUTE", handlerKey: "admin.change" }));
    await assert.rejects(async () => (await provider(database)).acquire({ entrypointKind: "ADMIN", externalRequestId: "req-2", normalizedPayload: { value: 2 }, actor: "admin" }, () => ({ route: "MODERN", reasonCode: "ADMIN_ROUTE", handlerKey: "admin.change" })), /APP_WIRING_PAYLOAD_DRIFT/);
  });

  it("fails closed while the persisted claim is still in progress", async () => {
    const database = new MemoryDatabase();
    await (await provider(database)).acquire({ entrypointKind: "WEB", externalRequestId: "req-busy", normalizedPayload: {}, actor: "web" }, () => ({ route: "MODERN", reasonCode: "ROUTE", handlerKey: "web.read" }));
    await assert.rejects(async () => (await provider(database)).acquire({ entrypointKind: "WEB", externalRequestId: "req-busy", normalizedPayload: {}, actor: "web" }, () => ({ route: "MODERN", reasonCode: "ROUTE", handlerKey: "web.read" })), /APP_WIRING_REQUEST_IN_PROGRESS/);
  });

  it("moves to MUTATION_STARTED before the first mutation-capable DB access and completes once", async () => {
    const database = new MemoryDatabase();
    const execution = await (await provider(database)).acquire({ entrypointKind: "AUTOMATIC", externalRequestId: "job:2026-09-04T04", normalizedPayload: {}, actor: "scheduler" }, () => ({ route: "MODERN", reasonCode: "SCHEDULED", handlerKey: "cleanup" }));
    await execution.database.query("SELECT 1");
    assert.equal(execution.claim.claimState, "MUTATION_STARTED");
    await execution.database.execute("UPDATE domain_table SET value=1");
    assert.equal(execution.claim.claimState, "MUTATION_STARTED");
    assert.deepEqual(database.domainWrites, ["UPDATE domain_table SET value=1"]);
    await execution.complete({ status: "OK" });
    assert.equal(execution.claim.claimState, "COMPLETED");
    assert.deepEqual(execution.claim.result, { status: "OK" });
  });

  it("blocks every SHADOW domain write while allowing a read-only completion", async () => {
    const database = new MemoryDatabase();
    const execution = await (await provider(database)).acquire({ entrypointKind: "WEB", externalRequestId: "req-shadow", normalizedPayload: {}, actor: "web" }, () => ({ route: "SHADOW", reasonCode: "SHADOW_SAMPLE", handlerKey: "profile.read" }));
    await assert.rejects(() => execution.database.query("SELECT 1"), /APP_WIRING_SHADOW_WRITE_FORBIDDEN/);
    await assert.rejects(() => execution.database.withTransaction((transaction) => transaction.execute("DELETE FROM domain_table")), /APP_WIRING_SHADOW_WRITE_FORBIDDEN/);
    assert.deepEqual(database.domainWrites, []);
    await execution.complete({ status: "OBSERVED" });
    assert.equal(execution.claim.claimState, "COMPLETED");
  });

  it("exposes only immutable claim snapshots and keeps the private route authoritative", async () => {
    const database = new MemoryDatabase();
    const execution = await (await provider(database)).acquire({ entrypointKind: "WEB", externalRequestId: "req-immutable", normalizedPayload: {}, actor: "web" }, () => ({ route: "SHADOW", reasonCode: "SHADOW_SAMPLE", handlerKey: "profile.read" }));
    const exposed = execution.claim;
    assert.equal(Object.isFrozen(exposed), true);
    assert.throws(() => { (exposed as { route: string }).route = "MODERN"; }, TypeError);
    assert.throws(() => { (exposed as { claimState: string }).claimState = "COMPLETED"; }, TypeError);
    await assert.rejects(() => execution.database.execute("UPDATE domain_table SET value=1"), /APP_WIRING_SHADOW_WRITE_FORBIDDEN/);
  });

  it("treats every query as mutation-capable and stores only an allowlisted receipt DTO", async () => {
    const database = new MemoryDatabase();
    const execution = await (await provider(database)).acquire({ entrypointKind: "WEB", externalRequestId: "req-safe", normalizedPayload: {}, actor: "web" }, () => ({ route: "MODERN", reasonCode: "ROUTE", handlerKey: "web.safe" }));
    await execution.database.query("SELECT 1");
    assert.equal(execution.claim.claimState, "MUTATION_STARTED");
    await assert.rejects(() => execution.complete({ status: "OK", accessToken: "secret" } as never), /APP_WIRING_RESULT_KEY_FORBIDDEN/);
    await assert.rejects(() => execution.complete({ status: "ok" }), /APP_WIRING_RESULT_STATUS_INVALID/);
    await assert.rejects(() => execution.complete({ status: "OK", referenceId: { toString: () => "receipt-1", accessToken: "secret" } } as never), /APP_WIRING_RESULT_REFERENCE_INVALID/);
    await assert.rejects(() => execution.complete({ status: "OK", resultFingerprint: { toString: () => "a".repeat(64), payload: "x".repeat(9_000) } } as never), /APP_WIRING_RESULT_FINGERPRINT_INVALID/);
    let statusReads = 0;
    const alternating = Object.defineProperty({}, "status", { enumerable: true, get: () => ++statusReads === 1 ? "OK" : { accessToken: "secret", payload: "x".repeat(9_000) } });
    await execution.complete(alternating as never);
    assert.equal(statusReads, 1);
    assert.deepEqual(execution.claim.result, { status: "OK" });
  });

  it("restores the local CLAIMED state when a claim-bound transaction rolls back", async () => {
    const database = new MemoryDatabase();
    const execution = await (await provider(database)).acquire({ entrypointKind: "IRIS", externalRequestId: "evt-rollback", normalizedPayload: {}, actor: "iris" }, () => ({ route: "MODERN", reasonCode: "EVENT", handlerKey: "event.ingest" }));
    await assert.rejects(() => execution.database.withTransaction(async (transaction) => {
      await transaction.execute("INSERT INTO domain_table VALUES (1)");
      throw new Error("ROLLBACK");
    }), /ROLLBACK/);
    assert.equal(execution.claim.claimState, "CLAIMED");
    assert.equal(database.row?.claim_state, "CLAIMED");
    await execution.database.withTransaction((transaction) => transaction.execute("INSERT INTO domain_table VALUES (2)"));
    assert.equal(execution.claim.claimState, "MUTATION_STARTED");
  });
});
