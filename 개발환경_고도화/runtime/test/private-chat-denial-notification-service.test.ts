import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult, RootTransactionDatabaseClient } from "../src/database.js";
import { PrivateChatDenialNotificationService } from "../src/integration/private-chat-denial-notification-service.js";
import { createEnvironmentContext, verifyStartupDatabaseIdentity, type VerifiedEnvironmentContext } from "../src/runtime/environment-context.js";

type ReceiptVersion = "PET_SKILL_INFO_PRIVATE_DENIAL_RECEIPT_V1" | "PET_SKILL_INFO_PRIVATE_DENIAL_RECEIPT_V2" | "PET_SKILL_INFO_PRIVATE_DENIAL_RECEIPT_V3";
type RootFixture = ReturnType<typeof rootFixture>;
type Attempt = {
  private_chat_denial_attempt_id: string;
  private_chat_denial_counter_id: string;
  environment_code: string;
  database_identity: string;
  event_id: string;
  app_wiring_operation_id: string;
  command_code: string;
  attempt_ordinal: bigint;
  denial_reason: string;
  display_name_snapshot: string;
  private_room_name_snapshot: string;
  message_preview_snapshot: string;
  notification_disposition: string;
  notification_destination_fingerprint: string | null;
  result_fingerprint: string;
};
type State = {
  roots: Map<string, RootFixture>;
  attempts: Map<string, Attempt>;
  counter?: { private_chat_denial_counter_id: string; environment_code: string; database_identity: string; provider_code: string; external_user_id: string; attempt_count: bigint; last_event_id: string };
  identityId: bigint;
  config: { private_chat_denial_notification_channel_id: string; provider_code: string; external_channel_id: string; delivery_enabled: boolean; configuration_fingerprint: string };
  operations: Array<{ id: bigint; idempotencyScope: string; idempotencyKey: string; actorId: bigint; status: string; result: Record<string, unknown> | null }>;
  executions: Array<{ eventId: string; commandCode: string; operationId: bigint; status: string; resultCode: string }>;
  audits: Array<{ operationId: bigint; actorId: bigint; actionCode: string; resultCode: string; summary: Record<string, unknown> }>;
  outboxes: Array<{ id: bigint; operationId: bigint; providerCode: string; destinationId: string; messageType: string; payload: { data: string } }>;
  nextInsertId: bigint;
};

const environmentCode = "dev" as const;
const databaseIdentity = "wbs767_unit";
const externalUserId = "kakao-open-profile-77";
const identityId = 41n;
const destinationChannelId = "gm-room-90";
const configurationFingerprint = "c".repeat(64);

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function legacyPreview(rawMessage: string): string {
  const normalized = rawMessage.replace(/[\r\n]+/g, " ").trim();
  if (normalized.length === 0) return "-";
  return normalized.length > 100 ? `${normalized.slice(0, 100)}...` : normalized;
}

function denialProjection(input: {
  eventId: string;
  displayName?: string;
  privateRoomName?: string;
  rawMessage?: string;
  version?: ReceiptVersion;
}) {
  const rawMessage = input.rawMessage ?? "/펫스킬정보";
  const version = input.version ?? "PET_SKILL_INFO_PRIVATE_DENIAL_RECEIPT_V2";
  const binding = {
    rawMessage,
    effectiveMessage: rawMessage,
    devContext: "DEFAULT",
    environmentCode,
    databaseIdentity,
    eventId: input.eventId,
    providerEventId: `provider-${input.eventId}`,
    eventProviderCode: "iris",
    identityProviderCode: "kakao",
    externalUserId,
    displayName: input.displayName ?? "호이 사용자",
    displayNameSource: "kakao_db",
    displayNameTrust: "trusted",
    channelType: "open_direct",
    externalChannelId: `private-${input.eventId}`
  } as const;
  const authorization = { mode: "PRIVATE_DENIED", reasonCode: "PET_SKILL_INFO_PRIVATE_PASS_REQUIRED" } as const;
  if (version === "PET_SKILL_INFO_PRIVATE_DENIAL_RECEIPT_V1") {
    return { version, binding, authorization, value: { status: "denied", reasonCode: authorization.reasonCode } };
  }
  return {
    version,
    binding,
    authorization,
    ...(version==="PET_SKILL_INFO_PRIVATE_DENIAL_RECEIPT_V3"?{actorContext:{selectionSource:"ACTIVE_CONTEXT",platformCode:"kakao",externalContextId:binding.externalChannelId,externalIdentityId:identityId.toString(),selectedLegacyPlayerId:"22",selectedCanonicalPlayerId:"player22",entitlementLegacyPlayerId:"11",portalAccountId:"portal01",platformContextMembershipId:"member01",selectionVersion:"4"}}:{}),
    value: { status: "denied", reasonCode: authorization.reasonCode },
    notification: {
      scope: "PET_SKILL_INFO_ONLY",
      commandCode: "PET_SKILL_INFO",
      environmentCode,
      databaseIdentity,
      providerCode: "kakao",
      externalIdentityId: identityId.toString(),
      externalUserId,
      displayName: binding.displayName,
      privateRoomName: input.privateRoomName ?? "카카오 개인방 A",
      privateRoomNameSource: "kakao_chat_room_meta",
      messagePreview: legacyPreview(rawMessage),
      notifyEvery: 3,
      previewMaxLength: 100,
      destinationChannelId,
      deliveryEnabled: true,
      configurationFingerprint
    }
  } as const;
}

function rootFixture(input: Parameters<typeof denialProjection>[0]&{route?:"SHADOW"|"MODERN"}) {
  const projection = denialProjection(input);
  const resultFingerprint = fingerprint(projection);
  const appWiringOperationId = `awo-${input.eventId}`;
  const receiptOperationId = BigInt(1000 + Number(input.eventId.replace(/\D/g, "") || "0"));
  return {
    app_wiring_operation_id: appWiringOperationId,
    claim_state: "COMPLETED",
    effect_mode: "READ_ONLY",
    route: input.route??"SHADOW",
    environment_code: environmentCode,
    database_identity: databaseIdentity,
    claim_result_json: { status: input.route==="MODERN"?"MODERN_DENIED":"SHADOW_DENIED", referenceId: receiptOperationId.toString(), resultFingerprint },
    receipt_operation_id: receiptOperationId,
    operation_status: "completed",
    operation_result_json: {
      status: input.route==="MODERN"?"MODERN_DENIED":"SHADOW_DENIED",
      route: input.route??"SHADOW",
      delivery: "NO_REPLY",
      resultFingerprint,
      appWiringOperationId,
      eventId: input.eventId,
      commandCode: "PET_SKILL_INFO",
      receiptProjection: projection
    },
    execution_status: "completed",
    execution_result_code: "ignored",
    external_identity_id: identityId,
    provider_code: "iris",
    external_user_id: externalUserId,
    root_outbox_count: 0n
  };
}

function cloneState(state: State): State {
  return structuredClone(state);
}

function writeResult(insertId = 0n, affectedRows = 1n): DatabaseWriteResult {
  return { insertId, affectedRows };
}

function createFakeDatabase(initialRoots: RootFixture[] = []) {
  let state: State = {
    roots: new Map(initialRoots.map((root) => [root.operation_result_json.eventId, root])),
    attempts: new Map(),
    identityId,
    config: {
      private_chat_denial_notification_channel_id: "channel1",
      provider_code: "kakao",
      external_channel_id: destinationChannelId,
      delivery_enabled: true,
      configuration_fingerprint: configurationFingerprint
    },
    operations: [],
    executions: [],
    audits: [],
    outboxes: [],
    nextInsertId: 5000n
  };
  let commits = 0;
  let rollbacks = 0;

  const query = async <T>(working: State, sql: string, values: readonly unknown[] = []): Promise<T> => {
    if (sql.includes("FROM command_executions execution") && sql.includes("LIMIT 2 FOR UPDATE")) {
      const root = working.roots.get(String(values[0]));
      return (root === undefined ? [] : [root]) as T;
    }
    if (sql.includes("FROM private_chat_denial_attempts WHERE event_id=")) {
      const attempt = working.attempts.get(String(values[0]));
      return (attempt === undefined ? [] : [attempt]) as T;
    }
    if (sql.includes("FROM external_identities WHERE provider_code=")) {
      return [{ id: working.identityId }] as T;
    }
    if (sql.includes("FROM private_chat_denial_notification_channels WHERE environment_code=")) {
      return [working.config] as T;
    }
    if (sql.includes("FROM private_chat_denial_counters WHERE environment_code=")) {
      const counter = working.counter;
      return (counter === undefined || counter.environment_code !== values[0] || counter.database_identity !== values[1] || counter.provider_code !== values[2] || counter.external_user_id !== values[3]
        ? []
        : [{ private_chat_denial_counter_id: counter.private_chat_denial_counter_id, attempt_count: counter.attempt_count }]) as T;
    }
    if (sql.includes("FROM operations operation") && sql.includes("audit_count")) {
      const eventId = String(values[0]);
      const commandCode = String(values[1]);
      const scope = String(values[2]);
      const idempotencyKey = String(values[3]);
      const rows: Array<Record<string, unknown>> = [];
      for (const operation of working.operations.filter((candidate) => candidate.idempotencyScope === scope && candidate.idempotencyKey === idempotencyKey)) {
        const execution = working.executions.find((candidate) => candidate.operationId === operation.id && candidate.eventId === eventId && candidate.commandCode === commandCode);
        const auditCount = working.audits.filter((candidate) => candidate.operationId === operation.id && candidate.actionCode === "private_chat.denial.notice").length;
        const outboxes = working.outboxes.filter((candidate) => candidate.operationId === operation.id);
        for (const outbox of outboxes.length === 0 ? [undefined] : outboxes) {
          rows.push({
            notice_operation_id: operation.id,
            operation_status: operation.status,
            operation_result_json: operation.result ?? {},
            execution_status: execution?.status ?? null,
            execution_result_code: execution?.resultCode ?? null,
            audit_count: BigInt(auditCount),
            outbox_id: outbox?.id ?? null,
            outbox_provider_code: outbox?.providerCode ?? null,
            destination_id: outbox?.destinationId ?? null,
            message_type: outbox?.messageType ?? null,
            payload_json: outbox?.payload ?? null
          });
        }
      }
      return rows.slice(0, 2) as T;
    }
    throw new Error(`UNEXPECTED_QUERY: ${sql}`);
  };

  const execute = async (working: State, sql: string, values: readonly unknown[] = []): Promise<DatabaseWriteResult> => {
    if (sql.startsWith("INSERT INTO private_chat_denial_counters")) {
      working.counter = {
        private_chat_denial_counter_id: String(values[0]),
        environment_code: String(values[1]),
        database_identity: String(values[2]),
        provider_code: String(values[3]),
        external_user_id: String(values[4]),
        attempt_count: 1n,
        last_event_id: String(values[5])
      };
      return writeResult();
    }
    if (sql.startsWith("UPDATE private_chat_denial_counters")) {
      const counter = working.counter;
      if (counter === undefined || counter.private_chat_denial_counter_id !== values[4] || counter.environment_code !== values[5] || counter.database_identity !== values[6] || counter.attempt_count !== BigInt(String(values[7]))) {
        return writeResult(0n, 0n);
      }
      counter.attempt_count = BigInt(String(values[0]));
      counter.last_event_id = String(values[1]);
      return writeResult();
    }
    if (sql.startsWith("INSERT INTO operations")) {
      working.nextInsertId += 1n;
      working.operations.push({ id: working.nextInsertId, idempotencyScope: String(values[1]), idempotencyKey: String(values[2]), actorId: BigInt(String(values[3])), status: "processing", result: null });
      return writeResult(working.nextInsertId);
    }
    if (sql.startsWith("INSERT INTO outbox_messages")) {
      working.nextInsertId += 1n;
      working.outboxes.push({ id: working.nextInsertId, operationId: BigInt(String(values[0])), providerCode: "iris", destinationId: String(values[1]), messageType: "text", payload: JSON.parse(String(values[2])) as { data: string } });
      return writeResult(working.nextInsertId);
    }
    if (sql.startsWith("INSERT INTO private_chat_denial_attempts")) {
      working.attempts.set(String(values[4]), {
        private_chat_denial_attempt_id: String(values[0]),
        private_chat_denial_counter_id: String(values[1]),
        environment_code: String(values[2]),
        database_identity: String(values[3]),
        event_id: String(values[4]),
        app_wiring_operation_id: String(values[5]),
        command_code: String(values[6]),
        attempt_ordinal: BigInt(String(values[7])),
        denial_reason: String(values[8]),
        display_name_snapshot: String(values[9]),
        private_room_name_snapshot: String(values[10]),
        message_preview_snapshot: String(values[11]),
        notification_disposition: String(values[12]),
        notification_destination_fingerprint: values[13] === null ? null : String(values[13]),
        result_fingerprint: String(values[14])
      });
      return writeResult();
    }
    if (sql.startsWith("INSERT INTO command_executions")) {
      working.executions.push({ eventId: String(values[0]), commandCode: String(values[1]), operationId: BigInt(String(values[2])), status: "completed", resultCode: String(values[3]) });
      return writeResult();
    }
    if (sql.startsWith("INSERT INTO command_audit")) {
      working.audits.push({ operationId: BigInt(String(values[0])), actorId: BigInt(String(values[1])), actionCode: "private_chat.denial.notice", resultCode: String(values[2]), summary: JSON.parse(String(values[3])) as Record<string, unknown> });
      return writeResult();
    }
    if (sql.startsWith("UPDATE operations")) {
      const operation = working.operations.find((candidate) => candidate.id === BigInt(String(values[1])) && candidate.status === "processing");
      if (operation === undefined) return writeResult(0n, 0n);
      operation.status = "completed";
      operation.result = JSON.parse(String(values[0])) as Record<string, unknown>;
      return writeResult();
    }
    throw new Error(`UNEXPECTED_EXECUTE: ${sql}`);
  };

  const database: DatabaseClient & RootTransactionDatabaseClient = {
    ping: async () => undefined,
    verifyRollback: async () => true,
    query: async <T>(sql: string, values: readonly unknown[] = []): Promise<T> => {
      if (sql === "SELECT DATABASE() AS database_identity") return [{ database_identity: databaseIdentity }] as T;
      if (sql.includes("LEFT JOIN private_chat_denial_attempts attempt")) {
        const requestedEnvironment = String(values[0]);
        const requestedDatabase = String(values[1]);
        const versions = new Set([String(values[2]),String(values[3])]);
        const limit = Number(values[4]);
        return [...state.roots.values()]
          .filter((root) => root.environment_code === requestedEnvironment
            && root.database_identity === requestedDatabase
            && versions.has(String(root.operation_result_json.receiptProjection.version))
            && !state.attempts.has(root.operation_result_json.eventId))
          .slice(0, limit)
          .map((root) => ({ event_id: root.operation_result_json.eventId })) as T;
      }
      return query<T>(state, sql, values);
    },
    execute: (sql, values = []) => execute(state, sql, values),
    withTransaction: async <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => database.withRootTransaction(work),
    withRootTransaction: async <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => {
      const working = cloneState(state);
      try {
        const result = await work({ query: (sql, values = []) => query(working, sql, values), execute: (sql, values = []) => execute(working, sql, values) });
        state = working;
        commits += 1;
        return result;
      } catch (error) {
        rollbacks += 1;
        throw error;
      }
    },
    close: async () => undefined
  };
  return {
    database,
    get state() { return state; },
    get commits() { return commits; },
    get rollbacks() { return rollbacks; },
    addRoot(root: RootFixture) { state.roots.set(root.operation_result_json.eventId, root); }
  };
}

async function verifiedEnvironment(database: DatabaseClient): Promise<VerifiedEnvironmentContext> {
  return verifyStartupDatabaseIdentity(database, createEnvironmentContext({ environmentCode, databaseIdentity }));
}

function deterministicIds() {
  let sequence = 0;
  return () => `unit${String(++sequence).padStart(4, "0")}`;
}

describe("private chat denial notification service", () => {
  it("counts a modern direct denial without creating a user reply outbox", async () => {
    const fake=createFakeDatabase([rootFixture({eventId:"event-1",route:"MODERN"})]);
    const service=new PrivateChatDenialNotificationService(fake.database,await verifiedEnvironment(fake.database),deterministicIds());
    assert.deepEqual(await service.processEvent("event-1"),{status:"counted",replayed:false,attemptOrdinal:"1",notificationDisposition:"NOT_DUE"});
    assert.equal(fake.state.outboxes.length,0);
  });

  it("keeps attempts one and two outbox-free, then queues the exact legacy admin notice on attempt three", async () => {
    const fake = createFakeDatabase([
      rootFixture({ eventId: "event-1", displayName: "첫 닉네임", privateRoomName: "개인방 A" }),
      rootFixture({ eventId: "event-2", displayName: "변경 닉네임", privateRoomName: "개인방 B" }),
      rootFixture({ eventId: "event-3", displayName: "현재 닉네임", privateRoomName: "개인방 C", rawMessage: "/펫스킬정보\n다음 줄" })
    ]);
    const service = new PrivateChatDenialNotificationService(fake.database, await verifiedEnvironment(fake.database), deterministicIds(), () => new Date("2026-09-07T12:00:00.000Z"));

    assert.deepEqual(await service.processEvent("event-1"), { status: "counted", replayed: false, attemptOrdinal: "1", notificationDisposition: "NOT_DUE" });
    assert.equal(fake.state.outboxes.length, 0);
    assert.deepEqual(await service.processEvent("event-2"), { status: "counted", replayed: false, attemptOrdinal: "2", notificationDisposition: "NOT_DUE" });
    assert.equal(fake.state.outboxes.length, 0);
    assert.deepEqual(await service.processEvent("event-3"), { status: "counted", replayed: false, attemptOrdinal: "3", notificationDisposition: "QUEUED" });
    assert.equal(fake.state.counter?.external_user_id, externalUserId, "nickname and room changes must retain the stable identity counter");
    assert.deepEqual([fake.state.counter?.environment_code, fake.state.counter?.database_identity], [environmentCode, databaseIdentity], "the stable identity counter is isolated by verified environment and database");
    assert.equal(fake.state.counter?.attempt_count, 3n);
    assert.equal(fake.state.outboxes.length, 1);
    assert.equal(fake.state.outboxes[0]?.destinationId, destinationChannelId);
    assert.equal(fake.state.outboxes[0]?.payload.data,
      "[패스 미사용 1:1톡 감지]\n유저: 현재 닉네임\n개인톡방: 개인방 C\n누적 횟수: 3회\n최근 메시지: /펫스킬정보 다음 줄");
    assert.deepEqual(fake.state.operations.map(({ id, idempotencyScope, idempotencyKey, actorId, status }) => ({ id, idempotencyScope, idempotencyKey, actorId, status })), [
      { id: 5001n, idempotencyScope: "private-chat-denial.notice", idempotencyKey: "awo-event-1", actorId: identityId, status: "completed" },
      { id: 5002n, idempotencyScope: "private-chat-denial.notice", idempotencyKey: "awo-event-2", actorId: identityId, status: "completed" },
      { id: 5003n, idempotencyScope: "private-chat-denial.notice", idempotencyKey: "awo-event-3", actorId: identityId, status: "completed" }
    ]);
    assert.deepEqual(fake.state.executions, [
      { eventId: "event-1", commandCode: "PRIVATE_CHAT_DENIAL_NOTICE", operationId: 5001n, status: "completed", resultCode: "not_due" },
      { eventId: "event-2", commandCode: "PRIVATE_CHAT_DENIAL_NOTICE", operationId: 5002n, status: "completed", resultCode: "not_due" },
      { eventId: "event-3", commandCode: "PRIVATE_CHAT_DENIAL_NOTICE", operationId: 5003n, status: "completed", resultCode: "queued" }
    ]);
    assert.deepEqual(fake.state.audits.map(({ operationId, actorId, actionCode, resultCode }) => ({ operationId, actorId, actionCode, resultCode })), [
      { operationId: 5001n, actorId: identityId, actionCode: "private_chat.denial.notice", resultCode: "not_due" },
      { operationId: 5002n, actorId: identityId, actionCode: "private_chat.denial.notice", resultCode: "not_due" },
      { operationId: 5003n, actorId: identityId, actionCode: "private_chat.denial.notice", resultCode: "queued" }
    ]);
    assert.deepEqual(fake.state.outboxes[0], {
      id: 5004n,
      operationId: 5003n,
      providerCode: "iris",
      destinationId: destinationChannelId,
      messageType: "text",
      payload: { data: "[패스 미사용 1:1톡 감지]\n유저: 현재 닉네임\n개인톡방: 개인방 C\n누적 횟수: 3회\n최근 메시지: /펫스킬정보 다음 줄" }
    });
    for (const [index, operation] of fake.state.operations.entries()) {
      const attempt = fake.state.attempts.get(`event-${index + 1}`)!;
      assert.deepEqual([attempt.environment_code, attempt.database_identity], [environmentCode, databaseIdentity]);
      assert.deepEqual(operation.result, {
        attemptId: attempt.private_chat_denial_attempt_id,
        counterId: attempt.private_chat_denial_counter_id,
        attemptOrdinal: String(index + 1),
        notificationDisposition: index === 2 ? "QUEUED" : "NOT_DUE",
        outboxId: index === 2 ? "5004" : null,
        resultFingerprint: attempt.result_fingerprint
      });
      assert.deepEqual(fake.state.audits[index]?.summary, {
        attemptId: attempt.private_chat_denial_attempt_id,
        counterId: attempt.private_chat_denial_counter_id,
        attemptOrdinal: String(index + 1),
        denialReason: "PRIVATE_HOI_PASS_REQUIRED",
        notificationDisposition: index === 2 ? "QUEUED" : "NOT_DUE",
        outboxId: index === 2 ? "5004" : null,
        resultFingerprint: attempt.result_fingerprint
      });
    }
  });

  it("replays the same event without incrementing the stable counter or creating another outbox", async () => {
    const fake = createFakeDatabase([rootFixture({ eventId: "event-1" })]);
    const service = new PrivateChatDenialNotificationService(fake.database, await verifiedEnvironment(fake.database), deterministicIds());
    const first = await service.processEvent("event-1");
    const before = cloneState(fake.state);
    const replay = await service.processEvent("event-1");
    assert.deepEqual(replay, { ...first, replayed: true });
    assert.equal(fake.state.counter?.attempt_count, before.counter?.attempt_count);
    assert.equal(fake.state.attempts.size, before.attempts.size);
    assert.equal(fake.state.outboxes.length, before.outboxes.length);

    fake.state.config.configuration_fingerprint = "d".repeat(64);
    assert.deepEqual(await service.processEvent("event-1"), { ...first, replayed: true }, "replay is bound to its immutable receipt, not current routing config");
    assert.equal(fake.state.counter?.attempt_count, before.counter?.attempt_count, "immutable replay must not mutate the counter");
    assert.equal(fake.state.attempts.size, before.attempts.size);
    assert.equal(fake.state.outboxes.length, before.outboxes.length);
    assert.equal(fake.rollbacks, 0);
  });

  it("fails closed and rolls back cleanly on root, configuration, or identity drift", async () => {
    const cases: Array<{ name: string; mutate: (fake: ReturnType<typeof createFakeDatabase>) => void; error: RegExp }> = [
      { name: "root", mutate: (fake) => { fake.state.roots.get("event-1")!.claim_result_json.resultFingerprint = "0".repeat(64); }, error: /PRIVATE_CHAT_DENIAL_ROOT_RECEIPT_DRIFT/ },
      { name: "root outbox", mutate: (fake) => { fake.state.roots.get("event-1")!.root_outbox_count = 1n; }, error: /PRIVATE_CHAT_DENIAL_ROOT_RECEIPT_DRIFT/ },
      { name: "configuration", mutate: (fake) => { fake.state.config.configuration_fingerprint = "d".repeat(64); }, error: /PRIVATE_CHAT_DENIAL_NOTIFICATION_CONFIG_DRIFT/ },
      { name: "identity", mutate: (fake) => { fake.state.identityId = 42n; }, error: /PRIVATE_CHAT_DENIAL_IDENTITY_DRIFT/ }
    ];
    for (const drift of cases) {
      const fake = createFakeDatabase([rootFixture({ eventId: "event-1" })]);
      drift.mutate(fake);
      const service = new PrivateChatDenialNotificationService(fake.database, await verifiedEnvironment(fake.database), deterministicIds());
      await assert.rejects(() => service.processEvent("event-1"), drift.error, drift.name);
      assert.equal(fake.rollbacks, 1, `${drift.name} transaction rollback`);
      assert.equal(fake.commits, 0, `${drift.name} transaction must not commit`);
      assert.equal(fake.state.counter, undefined);
      assert.equal(fake.state.attempts.size, 0);
      assert.equal(fake.state.outboxes.length, 0);
    }

    const replayTamperCases: Array<{ name: string; mutate: (fake: ReturnType<typeof createFakeDatabase>) => void; error: RegExp }> = [
      { name: "attempt environment", mutate: (fake) => { fake.state.attempts.get("event-1")!.environment_code = "prod"; }, error: /PRIVATE_CHAT_DENIAL_ATTEMPT_REPLAY_DRIFT/ },
      { name: "attempt database", mutate: (fake) => { fake.state.attempts.get("event-1")!.database_identity = "other_database"; }, error: /PRIVATE_CHAT_DENIAL_ATTEMPT_REPLAY_DRIFT/ },
      { name: "operation", mutate: (fake) => { fake.state.operations[0]!.status = "processing"; }, error: /PRIVATE_CHAT_DENIAL_REPLAY_INFRASTRUCTURE_DRIFT/ },
      { name: "execution", mutate: (fake) => { fake.state.executions[0]!.resultCode = "queued"; }, error: /PRIVATE_CHAT_DENIAL_REPLAY_INFRASTRUCTURE_DRIFT/ },
      { name: "audit", mutate: (fake) => { fake.state.audits.length = 0; }, error: /PRIVATE_CHAT_DENIAL_REPLAY_INFRASTRUCTURE_DRIFT/ },
      { name: "extra outbox", mutate: (fake) => { fake.state.outboxes.push({ id: 7001n, operationId: 5001n, providerCode: "iris", destinationId: destinationChannelId, messageType: "text", payload: { data: "unexpected" } }); }, error: /PRIVATE_CHAT_DENIAL_REPLAY_INFRASTRUCTURE_DRIFT/ },
      { name: "ordinal disposition", mutate: (fake) => {
        const attempt = fake.state.attempts.get("event-1")!;
        attempt.notification_disposition = "QUEUED";
        attempt.notification_destination_fingerprint = configurationFingerprint;
        attempt.result_fingerprint = fingerprint({ environmentCode, databaseIdentity, appWiringOperationId: "awo-event-1", counterId: attempt.private_chat_denial_counter_id, eventId: "event-1", ordinal: "1", reason: "PRIVATE_HOI_PASS_REQUIRED", disposition: "QUEUED", configurationFingerprint });
      }, error: /PRIVATE_CHAT_DENIAL_REPLAY_INFRASTRUCTURE_DRIFT/ }
    ];
    for (const tamper of replayTamperCases) {
      const fake = createFakeDatabase([rootFixture({ eventId: "event-1" })]);
      const service = new PrivateChatDenialNotificationService(fake.database, await verifiedEnvironment(fake.database), deterministicIds());
      await service.processEvent("event-1");
      tamper.mutate(fake);
      const before = cloneState(fake.state);
      await assert.rejects(() => service.processEvent("event-1"), tamper.error, tamper.name);
      assert.deepEqual(fake.state, before, `${tamper.name} replay failure must not mutate persisted state`);
      assert.equal(fake.rollbacks, 1, `${tamper.name} replay rolls back`);
    }

    const missingOutbox = createFakeDatabase([rootFixture({ eventId: "event-1" }), rootFixture({ eventId: "event-2" }), rootFixture({ eventId: "event-3" })]);
    const queuedService = new PrivateChatDenialNotificationService(missingOutbox.database, await verifiedEnvironment(missingOutbox.database), deterministicIds());
    await queuedService.processEvent("event-1");
    await queuedService.processEvent("event-2");
    await queuedService.processEvent("event-3");
    missingOutbox.state.outboxes.length = 0;
    const beforeMissingOutboxReplay = cloneState(missingOutbox.state);
    await assert.rejects(() => queuedService.processEvent("event-3"), /PRIVATE_CHAT_DENIAL_REPLAY_INFRASTRUCTURE_DRIFT/);
    assert.deepEqual(missingOutbox.state, beforeMissingOutboxReplay, "missing queued outbox fails closed without mutation");
    assert.equal(missingOutbox.rollbacks, 1);
  });

  it("reconciles V2/V3 root receipts whose attempt is missing", async () => {
    const completed = rootFixture({ eventId: "event-1" });
    const missingV2 = rootFixture({ eventId: "event-2" });
    const historicalV1 = rootFixture({ eventId: "event-3", version: "PET_SKILL_INFO_PRIVATE_DENIAL_RECEIPT_V1" });
    const missingV3 = rootFixture({ eventId: "event-5", version: "PET_SKILL_INFO_PRIVATE_DENIAL_RECEIPT_V3" });
    const otherEnvironment = rootFixture({ eventId: "event-4" });
    Reflect.set(otherEnvironment, "environment_code", "prod");
    const fake = createFakeDatabase([completed]);
    const service = new PrivateChatDenialNotificationService(fake.database, await verifiedEnvironment(fake.database), deterministicIds());
    await service.processEvent("event-1");
    fake.addRoot(missingV2);
    fake.addRoot(historicalV1);
    fake.addRoot(missingV3);
    fake.addRoot(otherEnvironment);

    assert.equal(await service.reconcilePending(), 2);
    assert.equal(fake.state.attempts.has("event-1"), true, "already completed V2 remains unchanged");
    assert.equal(fake.state.attempts.has("event-2"), true, "missing V2 is processed");
    assert.equal(fake.state.attempts.has("event-3"), false, "historical V1 is not backfilled");
    assert.equal(fake.state.attempts.has("event-4"), false, "another environment's V2 is excluded before processing");
    assert.equal(fake.state.attempts.has("event-5"), true, "missing V3 is processed");
    assert.equal(fake.state.counter?.attempt_count, 3n);
  });
});
