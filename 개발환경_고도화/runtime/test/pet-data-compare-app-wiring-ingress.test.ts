import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import type {
  CapableDatabaseClient,
  ControlledDatabaseTransaction,
  DatabaseTransaction,
  DatabaseWriteResult,
  ReadOnlySnapshotTransaction,
} from "../src/database.js";
import type { CommandDispatchDecision } from "../src/dispatch/command-dispatcher.js";
import {
  MariaAppWiringOperationProvider,
  type AppWiringReadParticipant,
} from "../src/dispatch/app-wiring-operation-provider.js";
import type { NormalizedIrisEvent } from "../src/integration/iris-normalizer.js";
import { createEnvironmentContext, verifyStartupDatabaseIdentity } from "../src/runtime/environment-context.js";
import { PetDataCompareAppWiringIngress } from "../src/admin/pet-data-compare-app-wiring-ingress.js";
import type { PetDataCompareShadowEvaluator } from "../src/admin/pet-data-compare-shadow-snapshot-provider.js";

type Row = Record<string, unknown>;

class ClaimDatabase implements CapableDatabaseClient {
  row?: Row;
  readonly writes: string[] = [];
  readonly sequence: string[] = [];
  readOnlySnapshots = 0;
  readHandler?: AppWiringReadParticipant;

  async ping() {}
  async verifyRollback() { return true; }
  async close() {}
  async query<T>(sql: string): Promise<T> {
    if (sql === "SELECT DATABASE() AS database_identity") return [{ database_identity: "hoi_bot" }] as T;
    return [] as T;
  }
  async execute(): Promise<DatabaseWriteResult> { throw new Error("RAW_EXECUTE_FORBIDDEN"); }
  async withTransaction<T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> {
    return this.withControlledTransaction(work as (transaction: ControlledDatabaseTransaction) => Promise<T>);
  }
  async withReadOnlySnapshot<T>(work: (transaction: ReadOnlySnapshotTransaction) => Promise<T>): Promise<T> {
    this.readOnlySnapshots += 1;
    this.sequence.push("snapshot");
    return work({ query: async <R>(sql: string, values?: readonly unknown[]) => {
      if (this.readHandler === undefined) return [] as R;
      return this.readHandler.query<R>(sql, values);
    } });
  }
  async withControlledTransaction<T>(work: (transaction: ControlledDatabaseTransaction) => Promise<T>): Promise<T> {
    const before = this.row === undefined ? undefined : { ...this.row };
    const transaction: ControlledDatabaseTransaction = {
      query: async <R>(sql: string, values: readonly unknown[] = []) => this.txQuery<R>(sql, values),
      execute: async (sql: string, values: readonly unknown[] = []) => this.txExecute(sql, values),
      withSavepoint: async <R>(nested: (tx: ControlledDatabaseTransaction) => Promise<R>) => nested(transaction),
    };
    try { return await work(transaction); }
    catch (error) { this.row = before; throw error; }
  }
  private async txQuery<T>(sql: string, values: readonly unknown[]): Promise<T> {
    return (sql.includes("FROM canonical_app_wiring_operations") && this.row?.request_identity_fingerprint === values[0] ? [this.row] : []) as T;
  }
  private async txExecute(sql: string, values: readonly unknown[]): Promise<DatabaseWriteResult> {
    this.writes.push(sql);
    if (sql.startsWith("INSERT INTO canonical_app_wiring_operations")) {
      this.sequence.push("claim");
      this.row = {
        app_wiring_operation_id: values[0], request_identity_fingerprint: values[1], request_namespace: values[2],
        entrypoint_kind: values[3], external_request_id: values[4], request_key: values[5], payload_fingerprint: values[6],
        route: values[9], reason_code: values[10], command_code: values[11], handler_key: values[12], claim_state: "CLAIMED",
        effect_mode: values[13], lease_token: values[14], lease_generation: 1n, lease_expires_time: values[15], attempt_count: 1n,
        recovery_status: "NONE", recovery_code: null, result_json: null, error_code: null,
      };
      return { affectedRows: 1n, insertId: 0n };
    }
    if (sql.includes("SET claim_state='COMPLETED'")) {
      Object.assign(this.row!, { claim_state: "COMPLETED", result_json: values[0], lease_token: null, lease_expires_time: null });
      return { affectedRows: 1n, insertId: 0n };
    }
    if (sql.includes("SET claim_state='FAILED'")) {
      Object.assign(this.row!, { claim_state: "FAILED", error_code: values[0], lease_token: null, lease_expires_time: null });
      return { affectedRows: 1n, insertId: 0n };
    }
    return { affectedRows: 0n, insertId: 0n };
  }
}

function event(overrides: Partial<NormalizedIrisEvent> = {}): NormalizedIrisEvent {
  return {
    eventId: "iris:pet-data-compare-1",
    providerEventId: "pet-data-compare-1",
    providerCode: "iris",
    eventKind: "1",
    direction: "incoming",
    channelId: "room-1",
    userId: "operator-external-1",
    displayName: "관리자",
    displayNameSource: "kakao_db",
    displayNameTrust: "trusted",
    message: "/펫데이터비교",
    eventCode: "message.created",
    eventCategory: "message",
    monitoringGroup: "text",
    eventMetadata: {},
    payloadHash: "a".repeat(64),
    ...overrides,
  };
}

async function provider(database: ClaimDatabase): Promise<MariaAppWiringOperationProvider> {
  const environment = await verifyStartupDatabaseIdentity(database, createEnvironmentContext({ environmentCode: "dev", databaseIdentity: "hoi_bot" }));
  return new MariaAppWiringOperationProvider(database, environment, () => "cmp00001", 1, () => new Date("2026-09-04T00:00:00Z"), () => "b".repeat(64));
}

function dispatcher(decision: CommandDispatchDecision, database: ClaimDatabase, calls: unknown[]) {
  return { resolveReadOnly: async (input: unknown) => { database.sequence.push("resolve"); calls.push(input); return decision; } };
}

function evaluator(database: ClaimDatabase, options: { authorized?: boolean; fault?: Error } = {}): { value: PetDataCompareShadowEvaluator; calls: number[] } {
  const calls: number[] = [];
  return {
    calls,
    value: {
      preview: async (participant) => {
        database.sequence.push("evaluate");
        calls.push(1);
        assert.equal(participant === database.readHandler, false);
        if (options.fault !== undefined) throw options.fault;
        const authorized = options.authorized !== false;
        return {
          authorized,
          resultFingerprint: (authorized ? "c" : "d").repeat(64),
          counts: { legacyPlayerCount: "10", legacyPetCount: "8", canonicalPlayerCount: "10", canonicalOwnedPetCount: "8" },
          deltas: { canonicalMinusLegacyPlayerCount: "0", canonicalMinusLegacyPetCount: "0" },
          summary: { authorized },
        };
      },
    },
  };
}

describe("PetDataCompareAppWiringIngress", () => {
  it("requires the exact incoming command and identity prerequisites before dispatcher or claim", async () => {
    for (const [index, invalid] of [
      { message: "/펫데이터비교 " }, { message: "/펫데이터비교 추가" }, { direction: "outgoing" as const },
      { userId: undefined }, { channelId: undefined },
    ].entries()) {
      const database = new ClaimDatabase();
      const dispatchCalls: unknown[] = [];
      const ingress = new PetDataCompareAppWiringIngress(await provider(database), dispatcher({ route: "SHADOW", reasonCode: "ROLLOUT_SHADOW", handlerKey: "admin_pet_data_compare" }, database, dispatchCalls));
      assert.deepEqual(await ingress.handle(event({ eventId: `invalid-${index}`, ...invalid })), { status: "ignored" });
      assert.equal(dispatchCalls.length, 0);
      assert.equal(database.row, undefined);
    }
  });

  it("dispatches an untrusted-name event with the actual trust bit and leaves authority to the DB evaluator", async () => {
    const database = new ClaimDatabase();
    const dispatchCalls: unknown[] = [];
    const shadow = evaluator(database);
    const ingress = new PetDataCompareAppWiringIngress(await provider(database), dispatcher({ route: "SHADOW", reasonCode: "ROLLOUT_SHADOW", commandCode: "ADMIN_PET_DATA_COMPARE", handlerKey: "admin_pet_data_compare" }, database, dispatchCalls), shadow.value);
    assert.deepEqual(await ingress.handle(event({ eventId: "untrusted", displayNameTrust: "untrusted" })), { status: "shadow", replayed: false, resultFingerprint: "c".repeat(64) });
    assert.deepEqual(dispatchCalls[0], { eventId: "untrusted", message: "/펫데이터비교", userId: "operator-external-1", hasTrustedDisplayName: false });
    assert.equal(shadow.calls.length, 1);
    assert.equal(database.row?.payload_fingerprint, createHash("sha256").update(JSON.stringify({
      channelId: "room-1",
      command: "/펫데이터비교",
      direction: "incoming",
      trustedDisplayName: false,
      userId: "operator-external-1",
    }), "utf8").digest("hex"));
  });

  it("resolves exactly once before claim, evaluates SHADOW in one read-only snapshot and replays deterministically", async () => {
    const database = new ClaimDatabase();
    const dispatchCalls: unknown[] = [];
    const shadow = evaluator(database);
    const ingress = new PetDataCompareAppWiringIngress(await provider(database), dispatcher({ route: "SHADOW", reasonCode: "ROLLOUT_SHADOW", commandCode: "ADMIN_PET_DATA_COMPARE", handlerKey: "admin_pet_data_compare" }, database, dispatchCalls), shadow.value);
    assert.deepEqual(await ingress.handle(event()), { status: "shadow", replayed: false, resultFingerprint: "c".repeat(64) });
    assert.deepEqual(database.sequence.slice(0, 4), ["resolve", "claim", "snapshot", "evaluate"]);
    assert.equal(dispatchCalls.length, 1);
    assert.deepEqual(dispatchCalls[0], { eventId: "iris:pet-data-compare-1", message: "/펫데이터비교", userId: "operator-external-1", hasTrustedDisplayName: true });
    assert.equal(database.row?.entrypoint_kind, "IRIS");
    assert.equal(database.row?.effect_mode, "READ_ONLY");
    assert.equal(database.row?.claim_state, "COMPLETED");
    assert.equal(database.readOnlySnapshots, 1);
    assert.deepEqual(await ingress.handle(event()), { status: "shadow", replayed: true, resultFingerprint: "c".repeat(64) });
    assert.equal(dispatchCalls.length, 2);
    assert.equal(shadow.calls.length, 1);
    assert.equal(database.readOnlySnapshots, 1);
    assert.equal(database.writes.some((sql) => /command_routing_decisions|operations|outbox_messages|player_profiles|player_pets|canonical_players|canonical_owned_pet_instances/i.test(sql.replace(/canonical_app_wiring_operations/gi, ""))), false);
  });

  it("returns LEGACY before claim, rejects MODERN before claim, and claims REJECT without evaluator DB work", async () => {
    const legacyDb = new ClaimDatabase();
    const legacyCalls: unknown[] = [];
    const legacy = new PetDataCompareAppWiringIngress(await provider(legacyDb), dispatcher({ route: "LEGACY_FALLBACK", reasonCode: "ROLLOUT_LEGACY_ONLY", handlerKey: "admin_pet_data_compare" }, legacyDb, legacyCalls));
    assert.deepEqual(await legacy.handle(event({ eventId: "legacy" })), { status: "legacy_fallback" });
    assert.equal(legacyDb.row, undefined);
    assert.equal(legacyCalls.length, 1);

    const modernDb = new ClaimDatabase();
    const modern = new PetDataCompareAppWiringIngress(await provider(modernDb), dispatcher({ route: "MODERN", reasonCode: "MODERN_ROUTE_ALLOWED", handlerKey: "admin_pet_data_compare" }, modernDb, []));
    await assert.rejects(() => modern.handle(event({ eventId: "modern" })), (error: unknown) => error instanceof Error && "code" in error && error.code === "PET_DATA_COMPARE_MODERN_MUTATION_NOT_ADOPTED");
    assert.equal(modernDb.row, undefined);

    const rejectDb = new ClaimDatabase();
    const rejectedEvaluator = evaluator(rejectDb, { fault: new Error("must not evaluate") });
    const rejected = new PetDataCompareAppWiringIngress(await provider(rejectDb), dispatcher({ route: "REJECT", reasonCode: "AUTH_SCOPE_NOT_SATISFIED", commandCode: "ADMIN_PET_DATA_COMPARE", handlerKey: "admin_pet_data_compare" }, rejectDb, []), rejectedEvaluator.value);
    assert.deepEqual(await rejected.handle(event({ eventId: "rejected" })), { status: "rejected", replayed: false, reasonCode: "AUTH_SCOPE_NOT_SATISFIED" });
    assert.equal(rejectedEvaluator.calls.length, 0);
    assert.equal(rejectDb.readOnlySnapshots, 0);
    assert.equal(rejectDb.row?.claim_state, "COMPLETED");
  });

  it("short-circuits unauthorized SHADOW data and replays the stored rejection", async () => {
    const database = new ClaimDatabase();
    const denied = evaluator(database, { authorized: false });
    const ingress = new PetDataCompareAppWiringIngress(await provider(database), dispatcher({ route: "SHADOW", reasonCode: "ROLLOUT_SHADOW", commandCode: "ADMIN_PET_DATA_COMPARE", handlerKey: "admin_pet_data_compare" }, database, []), denied.value);
    assert.deepEqual(await ingress.handle(event({ eventId: "denied" })), { status: "rejected", replayed: false, reasonCode: "ADMIN_PET_DATA_COMPARE_FORBIDDEN", resultFingerprint: "d".repeat(64) });
    assert.deepEqual(await ingress.handle(event({ eventId: "denied" })), { status: "rejected", replayed: true, reasonCode: "ADMIN_PET_DATA_COMPARE_FORBIDDEN", resultFingerprint: "d".repeat(64) });
    assert.equal(denied.calls.length, 1);
  });

  it("fails closed when a completed SHADOW receipt is missing or violates its exact contract", async () => {
    const mutations = [
      { status: "SHADOW_EVALUATED", referenceId: "PET_DATA_COMPARE" },
      { status: "SHADOW_OTHER", referenceId: "PET_DATA_COMPARE", resultFingerprint: "c".repeat(64) },
      { status: "SHADOW_EVALUATED", referenceId: "OTHER", resultFingerprint: "c".repeat(64) },
    ];
    for (const [index, receipt] of mutations.entries()) {
      const database = new ClaimDatabase();
      const shadow = evaluator(database);
      const ingress = new PetDataCompareAppWiringIngress(await provider(database), dispatcher({ route: "SHADOW", reasonCode: "ROLLOUT_SHADOW", commandCode: "ADMIN_PET_DATA_COMPARE", handlerKey: "admin_pet_data_compare" }, database, []), shadow.value);
      const replayEvent = event({ eventId: `tampered-shadow-${index}` });
      await ingress.handle(replayEvent);
      database.row!.result_json = JSON.stringify(receipt);
      await assert.rejects(() => ingress.handle(replayEvent), (error: unknown) => error instanceof Error && "code" in error && error.code === "PET_DATA_COMPARE_APP_WIRING_REPLAY_RECEIPT_INVALID");
      assert.equal(shadow.calls.length, 1);
    }

    const malformedDatabase = new ClaimDatabase();
    const malformedShadow = evaluator(malformedDatabase);
    const malformedIngress = new PetDataCompareAppWiringIngress(await provider(malformedDatabase), dispatcher({ route: "SHADOW", reasonCode: "ROLLOUT_SHADOW", commandCode: "ADMIN_PET_DATA_COMPARE", handlerKey: "admin_pet_data_compare" }, malformedDatabase, []), malformedShadow.value);
    const malformedEvent = event({ eventId: "malformed-shadow-fingerprint" });
    await malformedIngress.handle(malformedEvent);
    malformedDatabase.row!.result_json = JSON.stringify({ status: "SHADOW_EVALUATED", referenceId: "PET_DATA_COMPARE", resultFingerprint: "C".repeat(64) });
    await assert.rejects(() => malformedIngress.handle(malformedEvent), /APP_WIRING_RESULT_JSON_INVALID/);
  });

  it("fails closed for tampered SHADOW_REJECTED and REJECT completion receipts", async () => {
    const deniedDatabase = new ClaimDatabase();
    const denied = evaluator(deniedDatabase, { authorized: false });
    const deniedIngress = new PetDataCompareAppWiringIngress(await provider(deniedDatabase), dispatcher({ route: "SHADOW", reasonCode: "ROLLOUT_SHADOW", commandCode: "ADMIN_PET_DATA_COMPARE", handlerKey: "admin_pet_data_compare" }, deniedDatabase, []), denied.value);
    const deniedEvent = event({ eventId: "tampered-denied" });
    await deniedIngress.handle(deniedEvent);
    for (const receipt of [
      { status: "SHADOW_REJECTED", referenceId: "OTHER", resultFingerprint: "d".repeat(64) },
      { status: "SHADOW_REJECTED", referenceId: "ADMIN_PET_DATA_COMPARE_FORBIDDEN" },
    ]) {
      deniedDatabase.row!.result_json = JSON.stringify(receipt);
      await assert.rejects(() => deniedIngress.handle(deniedEvent), (error: unknown) => error instanceof Error && "code" in error && error.code === "PET_DATA_COMPARE_APP_WIRING_REPLAY_RECEIPT_INVALID");
    }

    const rejectDatabase = new ClaimDatabase();
    const rejectIngress = new PetDataCompareAppWiringIngress(await provider(rejectDatabase), dispatcher({ route: "REJECT", reasonCode: "AUTH_SCOPE_NOT_SATISFIED", commandCode: "ADMIN_PET_DATA_COMPARE", handlerKey: "admin_pet_data_compare" }, rejectDatabase, []));
    const rejectEvent = event({ eventId: "tampered-reject" });
    await rejectIngress.handle(rejectEvent);
    rejectDatabase.row!.reason_code = "";
    await assert.rejects(() => rejectIngress.handle(rejectEvent), (error: unknown) => error instanceof Error && "code" in error && error.code === "PET_DATA_COMPARE_APP_WIRING_REPLAY_RECEIPT_INVALID");
  });

  it("fails and fences evaluator errors, then fails closed on replay", async () => {
    const database = new ClaimDatabase();
    const faulting = evaluator(database, { fault: new Error("snapshot fault") });
    const ingress = new PetDataCompareAppWiringIngress(await provider(database), dispatcher({ route: "SHADOW", reasonCode: "ROLLOUT_SHADOW", handlerKey: "admin_pet_data_compare" }, database, []), faulting.value);
    await assert.rejects(() => ingress.handle(event({ eventId: "fault" })), /snapshot fault/);
    assert.equal(database.row?.claim_state, "FAILED");
    assert.equal(database.row?.error_code, "PET_DATA_COMPARE_SHADOW_EVALUATION_FAILED");
    await assert.rejects(() => ingress.handle(event({ eventId: "fault" })), /PET_DATA_COMPARE_APP_WIRING_PREVIOUSLY_FAILED/);
    assert.equal(faulting.calls.length, 1);
  });

  it("enforces read-only SQL and never opens the mutation capability", async () => {
    for (const [index, sql] of ["SELECT 1 FOR UPDATE", "UPDATE canonical_owned_pet_instances SET ownership_status='removed'", "SELECT LAST_INSERT_ID()"].entries()) {
      const database = new ClaimDatabase();
      const bad: PetDataCompareShadowEvaluator = { preview: async (participant) => {
        await participant.query(sql);
        throw new Error("unreachable");
      } };
      const ingress = new PetDataCompareAppWiringIngress(await provider(database), dispatcher({ route: "SHADOW", reasonCode: "ROLLOUT_SHADOW", handlerKey: "admin_pet_data_compare" }, database, []), bad);
      await assert.rejects(() => ingress.handle(event({ eventId: `bad-sql-${index}` })), /APP_WIRING_(?:LOCKING_QUERY_FORBIDDEN|QUERY_NOT_READ_ONLY)/);
      assert.equal(database.row?.claim_state, "FAILED");
      assert.equal(database.writes.some((statement) => /canonical_owned_pet_instances|outbox_messages|command_routing_decisions/i.test(statement)), false);
    }
  });
});
