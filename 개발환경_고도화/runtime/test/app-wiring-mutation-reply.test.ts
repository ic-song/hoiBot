import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CapableDatabaseClient, ControlledDatabaseTransaction, DatabaseTransaction, DatabaseWriteResult, ReadOnlySnapshotTransaction } from "../src/database.js";
import { executeAppWiringMutationIrisEntrypoint, executeAppWiringMutationReplyEntrypoint } from "../src/dispatch/app-wiring-entrypoint-runner.js";
import { MariaAppWiringOperationProvider, type AppWiringMutationParticipant } from "../src/dispatch/app-wiring-operation-provider.js";
import { createEnvironmentContext, verifyStartupDatabaseIdentity } from "../src/runtime/environment-context.js";

type Row = Record<string, unknown>;
const resultFingerprint = "d".repeat(64);
const petTitleOperationId = "petop001";
const petTitleBatchOperationId = "petba001";

class MutationReplyDatabase implements CapableDatabaseClient {
  claim?: Row;
  operation?: Row;
  execution?: Row;
  outbox?: Row;
  typedReceipt?: Row;
  receiptLink?: readonly unknown[];
  domainWrites = 0;
  failExecution = false;
  failOutbox = false;
  failReceiptLink = false;
  failTerminal = false;
  uncertainCommit = false;

  async ping() {}
  async verifyRollback() { return true; }
  async close() {}
  async query<T>(sql: string): Promise<T> { return (sql === "SELECT DATABASE() AS database_identity" ? [{ database_identity: "hoi_bot" }] : []) as T; }
  async execute(): Promise<DatabaseWriteResult> { throw new Error("RAW_POOL_WRITE_FORBIDDEN"); }
  async withTransaction<T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> { return this.withControlledTransaction(work as (transaction: ControlledDatabaseTransaction) => Promise<T>); }
  async withReadOnlySnapshot<T>(_work: (transaction: ReadOnlySnapshotTransaction) => Promise<T>): Promise<T> { throw new Error("SEPARATE_READ_SNAPSHOT_FORBIDDEN"); }

  async withControlledTransaction<T>(work: (transaction: ControlledDatabaseTransaction) => Promise<T>): Promise<T> {
    const snapshot = this.snapshot();
    let transaction!: ControlledDatabaseTransaction;
    transaction = {
      query: <R>(sql: string, values: readonly unknown[] = []) => this.txQuery<R>(sql, values),
      execute: (sql: string, values: readonly unknown[] = []) => this.txExecute(sql, values),
      withSavepoint: <R>(nested: (transaction: ControlledDatabaseTransaction) => Promise<R>) => nested(transaction),
    };
    try {
      const value = await work(transaction);
      if (this.uncertainCommit && this.claim?.claim_state === "COMPLETED") {
        this.uncertainCommit = false;
        throw Object.assign(new Error("COMMIT_RESULT_UNKNOWN"), { commitMayHaveSucceeded: true });
      }
      return value;
    } catch (error) {
      if ((error as { commitMayHaveSucceeded?: boolean }).commitMayHaveSucceeded !== true) this.restore(snapshot);
      throw error;
    }
  }

  private snapshot() {
    return {
      claim: this.claim === undefined ? undefined : { ...this.claim },
      operation: this.operation === undefined ? undefined : { ...this.operation },
      execution: this.execution === undefined ? undefined : { ...this.execution },
      outbox: this.outbox === undefined ? undefined : { ...this.outbox },
      typedReceipt: this.typedReceipt === undefined ? undefined : { ...this.typedReceipt },
      receiptLink: this.receiptLink,
      domainWrites: this.domainWrites,
    };
  }

  private restore(snapshot: ReturnType<MutationReplyDatabase["snapshot"]>) { Object.assign(this, snapshot); }

  private async txQuery<T>(sql: string, values: readonly unknown[]): Promise<T> {
    if (sql.includes("FROM canonical_app_wiring_operations")) return (this.claim?.request_identity_fingerprint === values[0] ? [this.claim] : []) as T;
    if (sql.includes("FROM canonical_pet_title_operations")) return (this.typedReceipt?.pet_title_operation_id === values[0] ? [this.typedReceipt] : []) as T;
    if (sql.includes("FROM canonical_pet_title_batch_operations")) return (this.typedReceipt?.pet_title_batch_operation_id === values[0] ? [this.typedReceipt] : []) as T;
    if (sql.includes("FROM canonical_app_wiring_receipt_links WHERE")) {
      const expected = sql.includes("WHERE app_wiring_operation_id=") ? this.receiptLink?.[1] : this.receiptLink?.[0];
      if (expected !== values[0]) return [] as T;
      const columns = ["canonical_app_wiring_receipt_link_id", "app_wiring_operation_id", "receipt_kind", "result_fingerprint", "daily_prayer_operation_id", "home_aggregate_operation_id", "market_operation_id", "member_title_operation_id", "mini_pet_title_operation_id", "package_use_operation_id", "pet_explore_operation_id", "pet_explore_event_control_operation_id", "pet_title_operation_id", "pet_title_batch_operation_id", "player_identity_operation_id"];
      return [Object.fromEntries(columns.map((column, index) => [column, this.receiptLink![index]]))] as T;
    }
    if (sql.includes("FROM outbox_messages outbox") || sql.includes("FROM operations operation")) {
      const fromOperation = sql.includes("FROM operations operation");
      const outbox = this.outbox;
      const matches = values.length === 1
        ? outbox?.id?.toString() === String(values[0])
        : this.operation?.idempotency_scope === values[0] && this.operation?.idempotency_key === values[1];
      if (!matches || this.operation === undefined || this.execution === undefined || (!fromOperation && outbox === undefined)) return [] as T;
      return [{ operation_id: this.operation.id, idempotency_scope: this.operation.idempotency_scope, idempotency_key: this.operation.idempotency_key, operation_status: this.operation.status, operation_result_json: this.operation.result_json, event_id: this.execution.event_id, command_code: this.execution.command_code, execution_status: this.execution.execution_status, result_code: this.execution.result_code, outbox_id: outbox?.id ?? null, provider_code: outbox === undefined ? null : "iris", destination_id: outbox?.destination_id ?? null, message_type: outbox === undefined ? null : "text", payload_json: outbox?.payload_json ?? null }] as T;
    }
    return [] as T;
  }

  private async txExecute(sql: string, values: readonly unknown[]): Promise<DatabaseWriteResult> {
    if (sql.startsWith("INSERT INTO canonical_app_wiring_operations")) {
      this.claim = { app_wiring_operation_id: values[0], request_identity_fingerprint: values[1], request_namespace: values[2], entrypoint_kind: values[3], external_request_id: values[4], request_key: values[5], payload_fingerprint: values[6], route: values[9], reason_code: values[10], command_code: values[11], handler_key: values[12], claim_state: "CLAIMED", effect_mode: values[13], lease_token: values[14], lease_generation: 1n, lease_expires_time: values[15], attempt_count: 1n, recovery_status: "NONE", recovery_code: null, result_json: null, error_code: null };
      return { affectedRows: 1n, insertId: 0n };
    }
    if (sql.includes("SET claim_state='MUTATION_STARTED'")) { Object.assign(this.claim!, { claim_state: "MUTATION_STARTED", recovery_status: "PENDING" }); return { affectedRows: 1n, insertId: 0n }; }
    if (sql.startsWith("UPDATE pet_title_domain")) { this.domainWrites += 1; return { affectedRows: 1n, insertId: 0n }; }
    if (sql.startsWith("INSERT INTO canonical_pet_title_operations")) { this.typedReceipt = { pet_title_operation_id: values[0], result_fingerprint: values[1], operation_status: "COMPLETED" }; return { affectedRows: 1n, insertId: 0n }; }
    if (sql.startsWith("INSERT INTO canonical_pet_title_batch_operations")) { this.typedReceipt = { pet_title_batch_operation_id: values[0], result_fingerprint: values[1], operation_status: "COMPLETED" }; return { affectedRows: 1n, insertId: 0n }; }
    if (sql.startsWith("INSERT INTO operations")) { this.operation = { id: 11n, idempotency_scope: "app-wiring.mutation-reply", idempotency_key: values[1], status: "processing", result_json: null }; return { affectedRows: 1n, insertId: 11n }; }
    if (sql.startsWith("INSERT INTO command_executions")) { if (this.failExecution) throw new Error("EXECUTION_INSERT_FAILED"); this.execution = { event_id: values[0], command_code: values[1], execution_status: "completed", result_code: sql.includes("'no_reply'") ? "no_reply" : "reply_queued" }; return { affectedRows: 1n, insertId: 12n }; }
    if (sql.startsWith("INSERT INTO outbox_messages")) { if (this.failOutbox) throw new Error("OUTBOX_INSERT_FAILED"); this.outbox = { id: 21n, destination_id: values[1], payload_json: values[2] }; return { affectedRows: 1n, insertId: 21n }; }
    if (sql.startsWith("UPDATE operations")) { Object.assign(this.operation!, { status: "completed", result_json: values[0] }); return { affectedRows: 1n, insertId: 0n }; }
    if (sql.startsWith("INSERT INTO canonical_app_wiring_receipt_links")) { if (this.failReceiptLink) throw new Error("RECEIPT_LINK_INSERT_FAILED"); this.receiptLink = values; return { affectedRows: 1n, insertId: 0n }; }
    if (sql.includes("SET claim_state='COMPLETED'")) { if (this.failTerminal) throw new Error("CLAIM_TERMINAL_FAILED"); Object.assign(this.claim!, { claim_state: "COMPLETED", result_json: values[0], lease_token: null, lease_expires_time: null, recovery_status: "NONE", error_code: null }); return { affectedRows: 1n, insertId: 0n }; }
    if (sql.includes("SET claim_state='FAILED'")) { Object.assign(this.claim!, { claim_state: "FAILED", result_json: null, error_code: values[0], lease_token: null, lease_expires_time: null }); return { affectedRows: 1n, insertId: 0n }; }
    return { affectedRows: 0n, insertId: 0n };
  }
}

async function provider(database: MutationReplyDatabase) {
  const environment = await verifyStartupDatabaseIdentity(database, createEnvironmentContext({ environmentCode: "dev", databaseIdentity: "hoi_bot" }));
  return new MariaAppWiringOperationProvider(database, environment, () => "a1234567", 1, () => new Date("2026-09-05T00:00:00.000Z"), () => "b".repeat(64));
}

function input(calls: string[]) {
  return {
    claim: { entrypointKind: "IRIS" as const, externalRequestId: "event-select-1", normalizedPayload: { index: 1 }, actor: "pet_title" },
    resolveRoute: () => ({ route: "MODERN" as const, effectMode: "MUTATION" as const, reasonCode: "CANARY", handlerKey: "pet_title_lifecycle" }),
    handler: async (database: AppWiringMutationParticipant) => {
      calls.push("handler");
      await database.execute("UPDATE pet_title_domain SET selected=TRUE");
      await database.execute("INSERT INTO canonical_pet_title_operations VALUES (?,?)", [petTitleOperationId, resultFingerprint]);
      return { value: "selected", reply: { eventId: "event-select-1", commandCode: "PET_TITLE_SELECT", destinationId: "room-1", data: "선택 완료" }, receipt: { status: "REPLY_QUEUED", resultFingerprint }, typedReceipt: { receiptKind: "PET_TITLE" as const, petTitleOperationId, resultFingerprint } };
    },
    replayCompleted: async () => "selected",
    replayFailed: async () => { throw new Error("PREVIOUSLY_FAILED"); },
    errorCode: () => "PET_TITLE_SELECT_FAILED",
  };
}

function noReplyInput(calls: string[]) {
  const base = input(calls);
  return {
    ...base,
    claim: { ...base.claim, externalRequestId: "event-silent-1", normalizedPayload: { index: 2 } },
    handler: async (database: AppWiringMutationParticipant) => {
      calls.push("handler");
      await database.execute("UPDATE pet_title_domain SET selected=TRUE");
      await database.execute("INSERT INTO canonical_pet_title_operations VALUES (?,?)", [petTitleOperationId, resultFingerprint]);
      return { value: "silent", noReply: { kind: "NO_REPLY" as const, eventId: "event-silent-1", commandCode: "PET_TITLE_SELL" }, receipt: { status: "NO_REPLY", resultFingerprint }, typedReceipt: { receiptKind: "PET_TITLE" as const, petTitleOperationId, resultFingerprint } };
    },
    replayCompleted: async () => "silent",
  };
}

function batchInput(calls:string[]){
  const base=input(calls);
  return {
    ...base,
    claim:{...base.claim,externalRequestId:"event-admin-sync-1",normalizedPayload:{command:"ADMIN_PET_TITLE_SYNC"}},
    handler:async(database:AppWiringMutationParticipant)=>{
      calls.push("handler");
      await database.execute("UPDATE pet_title_domain SET selected=TRUE");
      await database.execute("INSERT INTO canonical_pet_title_batch_operations VALUES (?,?)",[petTitleBatchOperationId,resultFingerprint]);
      return {value:"synced",reply:{eventId:"event-admin-sync-1",commandCode:"ADMIN_PET_TITLE_SYNC",destinationId:"room-1",data:"동기화 완료"},receipt:{status:"REPLY_QUEUED",resultFingerprint},typedReceipt:{receiptKind:"PET_TITLE_BATCH" as const,petTitleBatchOperationId,resultFingerprint}};
    },
    replayCompleted:async()=>"synced",
  };
}

describe("app-wiring MUTATION Iris reply atomic boundary", () => {
  it("persists, replays and validates the global PET_TITLE_BATCH typed receipt without a fake player",async()=>{
    const database=new MutationReplyDatabase(),service=await provider(database),calls:string[]=[];
    assert.deepEqual(await executeAppWiringMutationReplyEntrypoint(service,batchInput(calls)),{value:"synced",reply:{outboxId:"21",room:"room-1",data:"동기화 완료"}});
    assert.equal(database.receiptLink?.[2],"PET_TITLE_BATCH");
    assert.equal(database.receiptLink?.[13],petTitleBatchOperationId);
    assert.equal(database.receiptLink?.[14],null);
    assert.deepEqual(await executeAppWiringMutationReplyEntrypoint(service,batchInput(calls)),{value:"synced",reply:{outboxId:"21",room:"room-1",data:"동기화 완료"}});
    assert.deepEqual(calls,["handler"]);
    database.typedReceipt!.result_fingerprint="e".repeat(64);
    await assert.rejects(()=>executeAppWiringMutationReplyEntrypoint(service,batchInput(calls)),/APP_WIRING_REPLAY_TYPED_RECEIPT_FINGERPRINT_MISMATCH/);
  });

  it("rolls back PET_TITLE_BATCH domain, typed receipt and delivery graph together",async()=>{
    const database=new MutationReplyDatabase(),service=await provider(database);database.failOutbox=true;
    await assert.rejects(()=>executeAppWiringMutationReplyEntrypoint(service,batchInput([])),/OUTBOX_INSERT_FAILED/);
    assert.equal(database.domainWrites,0);assert.equal(database.typedReceipt,undefined);assert.equal(database.receiptLink,undefined);assert.equal(database.claim?.claim_state,"FAILED");
  });

  it("persists domain mutation, typed receipt, outbox and terminal claim together and replays one outbox", async () => {
    const database = new MutationReplyDatabase();
    const service = await provider(database);
    const calls: string[] = [];
    assert.deepEqual(await executeAppWiringMutationReplyEntrypoint(service, input(calls)), { value: "selected", reply: { outboxId: "21", room: "room-1", data: "선택 완료" } });
    assert.equal(database.domainWrites, 1);
    assert.equal(database.operation?.idempotency_scope, "app-wiring.mutation-reply");
    assert.equal(database.receiptLink?.[2], "PET_TITLE");
    assert.equal(database.claim?.claim_state, "COMPLETED");
    assert.deepEqual(await executeAppWiringMutationReplyEntrypoint(service, input(calls)), { value: "selected", reply: { outboxId: "21", room: "room-1", data: "선택 완료" } });
    assert.deepEqual(calls, ["handler"]);
  });

  it("rolls back domain and receipt work when outbox persistence fails", async () => {
    const database = new MutationReplyDatabase();
    const service = await provider(database);
    database.failOutbox = true;
    await assert.rejects(() => executeAppWiringMutationReplyEntrypoint(service, input([])), /OUTBOX_INSERT_FAILED/);
    assert.equal(database.domainWrites, 0);
    assert.equal(database.typedReceipt, undefined);
    assert.equal(database.operation, undefined);
    assert.equal(database.claim?.claim_state, "FAILED");
  });

  for (const [flag, error] of [["failExecution", "EXECUTION_INSERT_FAILED"], ["failReceiptLink", "RECEIPT_LINK_INSERT_FAILED"], ["failTerminal", "CLAIM_TERMINAL_FAILED"]] as const) {
    it(`rolls back the complete mutation reply graph on ${flag}`, async () => {
      const database = new MutationReplyDatabase();
      const service = await provider(database);
      database[flag] = true;
      await assert.rejects(() => executeAppWiringMutationReplyEntrypoint(service, input([])), new RegExp(error));
      assert.equal(database.domainWrites, 0);
      assert.equal(database.typedReceipt, undefined);
      assert.equal(database.operation, undefined);
      assert.equal(database.execution, undefined);
      assert.equal(database.outbox, undefined);
      assert.equal(database.receiptLink, undefined);
      assert.equal(database.claim?.claim_state, "FAILED");
    });
  }

  it("reconciles an unknown commit without repeating the domain mutation", async () => {
    const database = new MutationReplyDatabase();
    const service = await provider(database);
    database.uncertainCommit = true;
    const calls: string[] = [];
    const result = await executeAppWiringMutationReplyEntrypoint(service, input(calls));
    assert.deepEqual(result.reply, { outboxId: "21", room: "room-1", data: "선택 완료" });
    assert.equal(database.domainWrites, 1);
    assert.deepEqual(calls, ["handler"]);
  });

  it("fails closed when the replayed mutation outbox payload drifts", async () => {
    const database = new MutationReplyDatabase();
    const service = await provider(database);
    await executeAppWiringMutationReplyEntrypoint(service, input([]));
    database.outbox!.payload_json = JSON.stringify({ data: "변조" });
    await assert.rejects(() => executeAppWiringMutationReplyEntrypoint(service, input([])), /APP_WIRING_REPLY_REPLAY_DRIFT/);
    assert.equal(database.domainWrites, 1);
  });

  it("replays a legacy REPLY operation that predates the outcome discriminator", async () => {
    const database = new MutationReplyDatabase();
    const service = await provider(database);
    const calls: string[] = [];
    await executeAppWiringMutationReplyEntrypoint(service, input(calls));
    const legacyResult = JSON.parse(String(database.operation?.result_json)) as Record<string, unknown>;
    delete legacyResult.outcomeKind;
    database.operation!.result_json = JSON.stringify(legacyResult);
    assert.deepEqual(await executeAppWiringMutationReplyEntrypoint(service, input(calls)), { value: "selected", reply: { outboxId: "21", room: "room-1", data: "선택 완료" } });
    assert.deepEqual(calls, ["handler"]);
  });

  it("rejects a reply reference that is not the typed operation id and rolls back T1", async () => {
    const database = new MutationReplyDatabase();
    const service = await provider(database);
    const invalid = input([]);
    await assert.rejects(() => executeAppWiringMutationReplyEntrypoint(service, {
      ...invalid,
      handler: async (participant) => ({ ...(await invalid.handler(participant)), receipt: { status: "REPLY_QUEUED", referenceId: "wrong001", resultFingerprint } }),
    }), /APP_WIRING_REPLY_REFERENCE_TYPED_RECEIPT_MISMATCH/);
    assert.equal(database.domainWrites, 0);
    assert.equal(database.outbox, undefined);
    assert.equal(database.claim?.claim_state, "FAILED");
  });

  it("prevents the domain handler from creating a second coordinator-owned reply outbox", async () => {
    const database = new MutationReplyDatabase();
    const service = await provider(database);
    const invalid = input([]);
    await assert.rejects(() => executeAppWiringMutationReplyEntrypoint(service, {
      ...invalid,
      handler: async (participant) => {
        await participant.execute("UPDATE pet_title_domain SET selected=TRUE");
        await participant.execute("INSERT INTO outbox_messages(operation_id) VALUES (?)", [11n]);
        return invalid.handler(participant);
      },
    }), /APP_WIRING_REPLY_TABLE_COORDINATOR_ONLY/);
    assert.equal(database.domainWrites, 0);
    assert.equal(database.operation, undefined);
    assert.equal(database.outbox, undefined);
    assert.equal(database.claim?.claim_state, "FAILED");
  });

  it("rejects a replayed LEGACY_FALLBACK mutation before invoking either replay callback", async () => {
    const database = new MutationReplyDatabase();
    const service = await provider(database);
    await executeAppWiringMutationReplyEntrypoint(service, input([]));
    database.claim!.route = "LEGACY_FALLBACK";
    const callbacks: string[] = [];
    const replayInput = input([]);
    await assert.rejects(() => executeAppWiringMutationReplyEntrypoint(service, {
      ...replayInput,
      replayCompleted: async () => { callbacks.push("completed"); return "selected"; },
      replayFailed: async () => { callbacks.push("failed"); throw new Error("PREVIOUSLY_FAILED"); },
    }), /APP_WIRING_MUTATION_REPLY_ROUTE_INVALID/);
    assert.deepEqual(callbacks, []);
  });
});

describe("app-wiring MUTATION Iris typed no-reply boundary", () => {
  it("persists a typed receipt with zero outboxes and replays without invoking the handler", async () => {
    const database = new MutationReplyDatabase();
    const service = await provider(database);
    const calls: string[] = [];
    assert.deepEqual(await executeAppWiringMutationIrisEntrypoint(service, noReplyInput(calls)), { value: "silent", noReply: { kind: "NO_REPLY" } });
    assert.equal(database.domainWrites, 1);
    assert.equal(database.execution?.result_code, "no_reply");
    assert.equal(database.outbox, undefined);
    assert.equal(database.claim?.claim_state, "COMPLETED");
    assert.deepEqual(await executeAppWiringMutationIrisEntrypoint(service, noReplyInput(calls)), { value: "silent", noReply: { kind: "NO_REPLY" } });
    assert.deepEqual(calls, ["handler"]);
  });

  it("reconciles an unknown no-reply commit without repeating the mutation", async () => {
    const database = new MutationReplyDatabase();
    const service = await provider(database);
    database.uncertainCommit = true;
    const calls: string[] = [];
    assert.deepEqual(await executeAppWiringMutationIrisEntrypoint(service, noReplyInput(calls)), { value: "silent", noReply: { kind: "NO_REPLY" } });
    assert.equal(database.domainWrites, 1);
    assert.deepEqual(calls, ["handler"]);
  });

  it("fails closed when a no-reply operation gains an outbox", async () => {
    const database = new MutationReplyDatabase();
    const service = await provider(database);
    await executeAppWiringMutationIrisEntrypoint(service, noReplyInput([]));
    database.outbox = { id: 21n, destination_id: "room-1", payload_json: JSON.stringify({ data: "unexpected" }) };
    await assert.rejects(() => executeAppWiringMutationIrisEntrypoint(service, noReplyInput([])), /APP_WIRING_REPLY_REPLAY_DRIFT/);
  });

  it("rolls back the no-reply graph when execution persistence fails", async () => {
    const database = new MutationReplyDatabase();
    const service = await provider(database);
    database.failExecution = true;
    await assert.rejects(() => executeAppWiringMutationIrisEntrypoint(service, noReplyInput([])), /EXECUTION_INSERT_FAILED/);
    assert.equal(database.domainWrites, 0);
    assert.equal(database.typedReceipt, undefined);
    assert.equal(database.operation, undefined);
    assert.equal(database.claim?.claim_state, "FAILED");
  });

  for (const [flag, error] of [["failReceiptLink", "RECEIPT_LINK_INSERT_FAILED"], ["failTerminal", "CLAIM_TERMINAL_FAILED"]] as const) {
    it(`rolls back the complete no-reply graph on ${flag}`, async () => {
      const database = new MutationReplyDatabase();
      const service = await provider(database);
      database[flag] = true;
      await assert.rejects(() => executeAppWiringMutationIrisEntrypoint(service, noReplyInput([])), new RegExp(error));
      assert.equal(database.domainWrites, 0);
      assert.equal(database.typedReceipt, undefined);
      assert.equal(database.operation, undefined);
      assert.equal(database.execution, undefined);
      assert.equal(database.outbox, undefined);
      assert.equal(database.receiptLink, undefined);
      assert.equal(database.claim?.claim_state, "FAILED");
    });
  }

  it("fails closed when the persisted no-reply discriminator is missing", async () => {
    const database = new MutationReplyDatabase();
    const service = await provider(database);
    await executeAppWiringMutationIrisEntrypoint(service, noReplyInput([]));
    const result = JSON.parse(String(database.operation?.result_json)) as Record<string, unknown>;
    delete result.outcomeKind;
    database.operation!.result_json = JSON.stringify(result);
    await assert.rejects(() => executeAppWiringMutationIrisEntrypoint(service, noReplyInput([])), /APP_WIRING_REPLY_REPLAY_DRIFT/);
  });

  it("rejects an ambiguous reply plus no-reply outcome before commit", async () => {
    const database = new MutationReplyDatabase();
    const service = await provider(database);
    const invalid = noReplyInput([]);
    await assert.rejects(() => executeAppWiringMutationIrisEntrypoint(service, {
      ...invalid,
      handler: async (participant) => ({
        ...(await invalid.handler(participant)),
        reply: { eventId: "event-silent-1", commandCode: "PET_TITLE_SELL", destinationId: "room-1", data: "unexpected" },
      }),
    }), /APP_WIRING_MUTATION_IRIS_OUTCOME_INVALID/);
    assert.equal(database.domainWrites, 0);
    assert.equal(database.typedReceipt, undefined);
    assert.equal(database.operation, undefined);
    assert.equal(database.claim?.claim_state, "FAILED");
  });

  it("rejects an inconsistent no-reply status before commit", async () => {
    const database = new MutationReplyDatabase();
    const service = await provider(database);
    const invalid = noReplyInput([]);
    await assert.rejects(() => executeAppWiringMutationIrisEntrypoint(service, {
      ...invalid,
      handler: async (participant) => ({ ...(await invalid.handler(participant)), receipt: { status: "REPLY_QUEUED", resultFingerprint } }),
    }), /APP_WIRING_NO_REPLY_STATUS_INVALID/);
    assert.equal(database.domainWrites, 0);
    assert.equal(database.outbox, undefined);
    assert.equal(database.claim?.claim_state, "FAILED");
  });
});
