import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import mariadb from "mariadb";
import { createDatabaseClient, type CapableDatabaseClient, type ControlledDatabaseTransaction } from "../src/database.js";
import { MariaAppWiringOperationProvider } from "../src/dispatch/app-wiring-operation-provider.js";
import { executeAppWiringEntrypoint } from "../src/dispatch/app-wiring-entrypoint-runner.js";
import { PetExploreAppWiringIngress } from "../src/pet/pet-explore-app-wiring-ingress.js";
import { PetExploreEventControlAppWiringProvider } from "../src/pet/pet-explore-event-control-app-wiring-provider.js";
import { createEnvironmentContext, verifyStartupDatabaseIdentity } from "../src/runtime/environment-context.js";
import { settlementCommandEvent } from "./fixtures/pet-explore-settlement-command-consumer.js";

const phase = process.env.OBJECT_DB_TRANSITION_GATE2_P2_PHASE;
const enabled = phase === "prepare" || phase === "restart-rollback";
const migrationRoot = new URL("../migrations/", import.meta.url);
const migration466Name = "466_object_db_transition_recovery_receipt_links.sql";
const migration466 = readFileSync(new URL(migration466Name, migrationRoot), "utf8");
const rollback466 = readFileSync(new URL("rollback/466_object_db_transition_recovery_receipt_links.rollback.sql", migrationRoot), "utf8");
const migration470 = readFileSync(new URL("470_pet_explore_event_control_app_wiring.sql", migrationRoot), "utf8");
const rollback470 = readFileSync(new URL("rollback/470_pet_explore_event_control_app_wiring.rollback.sql", migrationRoot), "utf8");

function sha(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function connection() {
  return mariadb.createConnection({
    host: process.env.DATABASE_HOST ?? "127.0.0.1",
    port: Number(process.env.DATABASE_PORT ?? "3323"),
    user: process.env.DATABASE_USER ?? "root",
    password: process.env.DATABASE_PASSWORD ?? "",
    database: process.env.DATABASE_NAME,
    charset: "utf8mb4",
    timezone: "Z",
    multipleStatements: true,
    bigIntAsNumber: false,
  });
}

async function applyThrough465(db: Awaited<ReturnType<typeof connection>>): Promise<number> {
  const names = readdirSync(migrationRoot)
    .filter((name) => /^\d+_[a-z0-9_]+\.sql$/i.test(name) && Number(name.slice(0, 3)) <= 465)
    .sort();
  for (const name of names) await db.query(readFileSync(new URL(name, migrationRoot), "utf8"));
  return names.length;
}

async function columnCount(db: Awaited<ReturnType<typeof connection>>): Promise<number> {
  const rows = await db.query<Array<{ count_value: bigint }>>(
    `SELECT COUNT(*) count_value FROM information_schema.columns
     WHERE table_schema=DATABASE() AND table_name='canonical_app_wiring_operations'
       AND column_name IN ('effect_mode','lease_token','lease_generation','lease_expires_time','attempt_count','recovery_status','recovery_code')`,
  );
  return Number(rows[0]?.count_value ?? 0n);
}

async function assertForwardShape(db: Awaited<ReturnType<typeof connection>>, expectedReceiptForeignKeys = 10): Promise<void> {
  assert.equal(await columnCount(db), 7);
  const indexes = await db.query<Array<{ count_value: bigint }>>(
    `SELECT COUNT(DISTINCT index_name) count_value FROM information_schema.statistics
     WHERE table_schema=DATABASE() AND table_name='canonical_app_wiring_operations'
       AND index_name IN ('ix_odbt_466_01_01','ix_odbt_466_01_02')`,
  );
  assert.equal(Number(indexes[0]?.count_value ?? 0n), 2);
  const checks = await db.query<Array<{ count_value: bigint }>>(
    `SELECT COUNT(*) count_value FROM information_schema.table_constraints
     WHERE constraint_schema=DATABASE() AND table_name='canonical_app_wiring_operations'
       AND constraint_type='CHECK' AND constraint_name LIKE 'chk_odbt_466_01_rule_%'`,
  );
  assert.equal(Number(checks[0]?.count_value ?? 0n), 16);
  const foreignKeys = await db.query<Array<{ count_value: bigint }>>(
    `SELECT COUNT(*) count_value FROM information_schema.table_constraints
     WHERE constraint_schema=DATABASE() AND table_name='canonical_app_wiring_receipt_links'
       AND constraint_type='FOREIGN KEY'`,
  );
  assert.equal(Number(foreignKeys[0]?.count_value ?? 0n), expectedReceiptForeignKeys);
}

async function assertEventControlReceiptShape(db: Awaited<ReturnType<typeof connection>>): Promise<void> {
  const table = await db.query<Array<{ count_value: bigint }>>(
    "SELECT COUNT(*) count_value FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='canonical_pet_explore_event_control_operations'",
  );
  assert.equal(Number(table[0]?.count_value ?? 0n), 1);
  const linkColumn = await db.query<Array<{ count_value: bigint }>>(
    "SELECT COUNT(*) count_value FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='canonical_app_wiring_receipt_links' AND column_name='pet_explore_event_control_operation_id'",
  );
  assert.equal(Number(linkColumn[0]?.count_value ?? 0n), 1);
  const foreignKey = await db.query<Array<{ count_value: bigint }>>(
    "SELECT COUNT(*) count_value FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND table_name='canonical_app_wiring_receipt_links' AND constraint_name='fk_odbt_470_02_01' AND constraint_type='FOREIGN KEY'",
  );
  assert.equal(Number(foreignKey[0]?.count_value ?? 0n), 1);
  const replacementChecks = await db.query<Array<{ constraint_name: string }>>(
    "SELECT constraint_name FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND table_name='canonical_app_wiring_receipt_links' AND constraint_type='CHECK' AND constraint_name IN ('chk_odbt_470_02_rule_01','chk_odbt_470_02_rule_02','chk_odbt_466_02_rule_02','chk_odbt_466_02_rule_03') ORDER BY constraint_name",
  );
  assert.deepEqual(replacementChecks.map((row) => row.constraint_name), ["chk_odbt_470_02_rule_01", "chk_odbt_470_02_rule_02"]);
}

async function assertRealProviderReadPaths(): Promise<void> {
  const database = createDatabaseClient({
    enabled: true,
    host: process.env.DATABASE_HOST ?? "127.0.0.1",
    port: Number(process.env.DATABASE_PORT ?? "3323"),
    user: process.env.DATABASE_USER ?? "root",
    password: process.env.DATABASE_PASSWORD ?? "",
    name: process.env.DATABASE_NAME!,
    connectionLimit: 4,
    connectTimeoutMs: 5_000,
  });
  try {
    const environment = await verifyStartupDatabaseIdentity(
      database,
      createEnvironmentContext({ environmentCode: "dev", databaseIdentity: process.env.DATABASE_NAME! }),
    );
    const ids = ["p2prv001", "p2prv002", "p2prv003", "p2prv004", "p2prv005"];
    let idIndex = 0;
    const provider = new MariaAppWiringOperationProvider(
      database,
      environment,
      () => ids[idIndex++]!,
      ids.length,
      () => new Date("2026-09-04T00:00:00.000Z"),
      () => "1".repeat(64),
      30_000,
    );
    let readCalls = 0;
    const runShadow = (payload: unknown) => executeAppWiringEntrypoint(provider, {
      claim: { entrypointKind: "IRIS", externalRequestId: "p2-provider-shadow", normalizedPayload: payload, actor: "test:p2" },
      resolveRoute: () => ({ route: "SHADOW", effectMode: "READ_ONLY", reasonCode: "ROLLOUT_SHADOW", commandCode: "P2_SHADOW", handlerKey: "p2_shadow" }),
      handlers: {
        MODERN: { READ_ONLY: async () => { throw new Error("unexpected modern"); }, MUTATION: async () => { throw new Error("unexpected modern"); } },
        LEGACY_FALLBACK: { READ_ONLY: async () => { throw new Error("unexpected legacy"); }, MUTATION: async () => { throw new Error("unexpected legacy"); } },
        SHADOW: async (participant) => {
          readCalls += 1;
          const rows = await participant.query<Array<{ value: number }>>("SELECT 1 value");
          return { value: `shadow:${rows[0]!.value}`, receipt: { status: "SHADOW_EVALUATED", referenceId: "P2" } };
        },
        REJECT: async () => { throw new Error("unexpected reject"); },
      },
      replayCompleted: async () => "shadow:replayed",
      replayFailed: async () => { throw new Error("unexpected failed replay"); },
      errorCode: () => "P2_PROVIDER_FAILED",
    });
    assert.equal(await runShadow({ command: "/p2" }), "shadow:1");
    assert.equal(await runShadow({ command: "/p2" }), "shadow:replayed");
    assert.equal(readCalls, 1, "terminal replay must not execute the evaluator again");
    await assert.rejects(() => runShadow({ command: "/p2-drift" }), /APP_WIRING_PAYLOAD_DRIFT/);

    let rejectCalls = 0;
    const runReject = () => executeAppWiringEntrypoint(provider, {
      claim: { entrypointKind: "IRIS", externalRequestId: "p2-provider-reject", normalizedPayload: { command: "/denied" }, actor: "test:p2" },
      resolveRoute: () => ({ route: "REJECT", effectMode: "READ_ONLY", reasonCode: "P2_DENIED" }),
      handlers: {
        MODERN: { READ_ONLY: async () => { throw new Error("unexpected modern"); }, MUTATION: async () => { throw new Error("unexpected modern"); } },
        LEGACY_FALLBACK: { READ_ONLY: async () => { throw new Error("unexpected legacy"); }, MUTATION: async () => { throw new Error("unexpected legacy"); } },
        SHADOW: async () => { throw new Error("unexpected shadow"); },
        REJECT: async () => { rejectCalls += 1; return { value: "rejected", receipt: { status: "REJECTED", referenceId: "P2_DENIED" } }; },
      },
      replayCompleted: async () => "rejected:replayed",
      replayFailed: async () => { throw new Error("unexpected failed replay"); },
      errorCode: () => "P2_PROVIDER_FAILED",
    });
    assert.equal(await runReject(), "rejected");
    assert.equal(await runReject(), "rejected:replayed");
    assert.equal(rejectCalls, 1);

    const activeClaim = {
      entrypointKind: "IRIS" as const,
      externalRequestId: "p2-provider-active",
      normalizedPayload: { command: "/active" },
      actor: "test:p2",
    };
    const stalePrepared = await provider.prepare(activeClaim, () => ({ route: "SHADOW", effectMode: "READ_ONLY", reasonCode: "ROLLOUT_SHADOW", commandCode: "P2_ACTIVE" }));
    await assert.rejects(
      () => provider.prepare(activeClaim, () => ({ route: "SHADOW", effectMode: "READ_ONLY", reasonCode: "ROLLOUT_SHADOW", commandCode: "P2_ACTIVE" })),
      /APP_WIRING_REQUEST_IN_PROGRESS/,
    );
    await database.execute(
      "UPDATE canonical_app_wiring_operations SET lease_expires_time='2026-09-03 00:00:00' WHERE external_request_id='p2-provider-active'",
    );
    const recovered = await provider.prepare(activeClaim, () => ({ route: "REJECT", effectMode: "READ_ONLY", reasonCode: "MUST_NOT_RESELECT" }));
    assert.equal(recovered.replayed, false);
    assert.equal(recovered.claim.route, "SHADOW");
    assert.equal(recovered.claim.claimState, "CLAIMED");
    const generation = await database.query<Array<{ lease_generation: bigint; attempt_count: bigint; recovery_status: string }>>(
      "SELECT lease_generation,attempt_count,recovery_status FROM canonical_app_wiring_operations WHERE external_request_id='p2-provider-active'",
    );
    assert.deepEqual([Number(generation[0]!.lease_generation), Number(generation[0]!.attempt_count), generation[0]!.recovery_status], [2, 2, "RECOVERED"]);
    if (stalePrepared.replayed) throw new Error("P2_STALE_CLAIM_UNEXPECTED_REPLAY");
    await assert.rejects(
      () => provider.runReadOnly(stalePrepared, async () => ({ value: "stale", receipt: { status: "STALE" } })),
      /APP_WIRING_LEASE_FENCE_CONFLICT/,
    );

    const legacyNamespace = `hoibot:dev:${process.env.DATABASE_NAME}`;
    const legacyRequestIdentity = sha(JSON.stringify([legacyNamespace, "IRIS", "p2-legacy-active"]));
    const legacyPayloadFingerprint = sha(JSON.stringify({ legacy: true }));
    await database.execute(
      `INSERT INTO canonical_app_wiring_operations
       (app_wiring_operation_id,request_identity_fingerprint,request_namespace,entrypoint_kind,external_request_id,request_key,payload_fingerprint,environment_code,database_identity,route,reason_code,command_code,handler_key,claim_state,result_json,error_code,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME)
       VALUES ('p2leg001',?,'${legacyNamespace}','IRIS','p2-legacy-active','IRIS:p2-legacy-active',?,'dev',?,'LEGACY_FALLBACK','ROLLOUT_LEGACY_ONLY','P2_LEGACY','p2_legacy','CLAIMED',NULL,NULL,'test:p2','2026-09-04 00:00:00','test:p2','2026-09-04 00:00:00')`,
      [legacyRequestIdentity, legacyPayloadFingerprint, process.env.DATABASE_NAME!],
    );
    await assert.rejects(
      () => provider.prepare(
        { entrypointKind: "IRIS", externalRequestId: "p2-legacy-active", normalizedPayload: { legacy: true }, actor: "test:p2" },
        () => ({ route: "LEGACY_FALLBACK", effectMode: "MUTATION", reasonCode: "ROLLOUT_LEGACY_ONLY", commandCode: "P2_LEGACY" }),
      ),
      /APP_WIRING_LEGACY_ACTIVE_DRAIN_REQUIRED/,
    );
  } finally {
    await database.close();
  }
}

const modernEventId = "p2-modern-event-control";
const modernExternalUserId = "p2-modern-operator";
const modernChannelId = "p2-modern-room";

function modernEvent() {
  return settlementCommandEvent({
    eventId: modernEventId,
    providerEventId: modernEventId,
    userId: modernExternalUserId,
    channelId: modernChannelId,
    message: "/펫탐험이벤트활성화",
  });
}

function modernRouteDispatcher() {
  return {
    resolveReadOnly: async () => ({
      route: "MODERN" as const,
      reasonCode: "MODERN_ROUTE_ALLOWED",
      commandCode: "PET_EXPLORE_EVENT_CONTROL",
      handlerKey: "pet_explore_event_control",
    }),
  };
}

function runtimeDatabase() {
  return createDatabaseClient({
    enabled: true,
    host: process.env.DATABASE_HOST ?? "127.0.0.1",
    port: Number(process.env.DATABASE_PORT ?? "3323"),
    user: process.env.DATABASE_USER ?? "root",
    password: process.env.DATABASE_PASSWORD ?? "",
    name: process.env.DATABASE_NAME!,
    connectionLimit: 4,
    connectTimeoutMs: 5_000,
  });
}

function observedContenderDatabase(
  database: ReturnType<typeof runtimeDatabase>,
  onClaimLockRead: () => void,
): CapableDatabaseClient {
  let observed = false;
  const wrap = (transaction: ControlledDatabaseTransaction): ControlledDatabaseTransaction => {
    let wrapped!: ControlledDatabaseTransaction;
    wrapped = {
      query: async <T>(sql: string, values?: readonly unknown[]) => {
        if (!observed && /FROM canonical_app_wiring_operations[\s\S]*FOR UPDATE/i.test(sql)) {
          observed = true;
          onClaimLockRead();
        }
        return transaction.query<T>(sql, values);
      },
      execute: (sql, values) => transaction.execute(sql, values),
      withSavepoint: <T>(work: (nested: ControlledDatabaseTransaction) => Promise<T>) => transaction.withSavepoint((nested) => work(wrap(nested))),
    };
    return wrapped;
  };
  return {
    ping: () => database.ping(),
    verifyRollback: () => database.verifyRollback(),
    query: <T>(sql: string, values?: readonly unknown[]) => database.query<T>(sql, values),
    execute: (sql, values) => database.execute(sql, values),
    withTransaction: (work) => database.withTransaction(work),
    close: async () => {},
    withReadOnlySnapshot: (work) => database.withReadOnlySnapshot(work),
    withControlledTransaction: (work) => database.withControlledTransaction((transaction) => work(wrap(transaction))),
  };
}

async function verifiedEnvironment(database: ReturnType<typeof runtimeDatabase>) {
  return verifyStartupDatabaseIdentity(
    database,
    createEnvironmentContext({ environmentCode: "dev", databaseIdentity: process.env.DATABASE_NAME! }),
  );
}

async function seedModernEventControlFixture(): Promise<void> {
  const database = runtimeDatabase();
  try {
    const player = await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const identity = await database.execute(
      "INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'P2 합성 운영자','linked')",
      [player.insertId, modernExternalUserId],
    );
    const operator = await database.execute(
      "INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES ('p2-modern-login','P2 합성 운영자','synthetic-not-a-real-password','active')",
    );
    await database.execute(
      "INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)",
      [operator.insertId, identity.insertId],
    );
    await database.execute(
      "INSERT INTO admin_operator_roles(operator_id,role_id) SELECT ?,id FROM admin_roles WHERE code='super_admin'",
      [operator.insertId],
    );
    await database.execute(
      "INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?, 'message','incoming',REPEAT('7',64),'processed',UTC_TIMESTAMP(3))",
      [modernEventId, modernEventId, modernChannelId, modernExternalUserId],
    );
    await database.execute(
      "INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES ('p2-fault-event','p2-fault-event',?,?, 'message','incoming',REPEAT('8',64),'processed',UTC_TIMESTAMP(3))",
      [modernChannelId, modernExternalUserId],
    );
  } finally {
    await database.close();
  }
}

async function transitionCounts(database: ReturnType<typeof runtimeDatabase>) {
  const rows = await database.query<Array<Record<string, bigint | string>>>(
    `SELECT
       (SELECT COUNT(*) FROM canonical_app_wiring_operations WHERE external_request_id=?) app_claims,
       (SELECT COUNT(*) FROM canonical_pet_explore_event_control_operations WHERE request_key=?) typed_operations,
       (SELECT COUNT(*) FROM canonical_app_wiring_receipt_links link JOIN canonical_app_wiring_operations claim ON claim.app_wiring_operation_id=link.app_wiring_operation_id WHERE claim.external_request_id=?) receipt_links,
       (SELECT COUNT(*) FROM operations WHERE idempotency_key=?) legacy_operations,
       (SELECT COUNT(*) FROM command_executions WHERE event_id=?) command_executions,
       (SELECT COUNT(*) FROM outbox_messages message JOIN operations operation ON operation.id=message.operation_id WHERE operation.idempotency_key=?) outbox_messages`,
    [modernEventId, `IRIS:${modernEventId}`, modernEventId, `IRIS:${modernEventId}`, modernEventId, `IRIS:${modernEventId}`],
  );
  return Object.fromEntries(Object.entries(rows[0]!).map(([key, value]) => [key, String(value)]));
}

async function transitionSnapshot(database: ReturnType<typeof runtimeDatabase>): Promise<string> {
  const statements = [
    "SELECT * FROM canonical_app_wiring_operations WHERE external_request_id IN ('p2-modern-event-control','p2-fault-event') ORDER BY external_request_id",
    "SELECT * FROM canonical_pet_explore_event_control_operations WHERE request_key IN ('IRIS:p2-modern-event-control','IRIS:p2-fault-event') ORDER BY request_key",
    "SELECT link.* FROM canonical_app_wiring_receipt_links link JOIN canonical_app_wiring_operations claim ON claim.app_wiring_operation_id=link.app_wiring_operation_id WHERE claim.external_request_id IN ('p2-modern-event-control','p2-fault-event') ORDER BY claim.external_request_id",
    "SELECT * FROM pet_explore_runtime_config WHERE config_id=1",
    "SELECT * FROM operations WHERE idempotency_key IN ('IRIS:p2-modern-event-control','IRIS:p2-fault-event') ORDER BY id",
    "SELECT change_row.* FROM pet_explore_event_control_changes change_row JOIN operations operation ON operation.id=change_row.operation_id WHERE operation.idempotency_key IN ('IRIS:p2-modern-event-control','IRIS:p2-fault-event') ORDER BY change_row.operation_id",
    "SELECT relocation.* FROM pet_explore_event_control_relocations relocation JOIN operations operation ON operation.id=relocation.operation_id WHERE operation.idempotency_key IN ('IRIS:p2-modern-event-control','IRIS:p2-fault-event') ORDER BY relocation.operation_id,relocation.participation_id",
    "SELECT audit.* FROM command_audit audit JOIN operations operation ON operation.id=audit.operation_id WHERE operation.idempotency_key IN ('IRIS:p2-modern-event-control','IRIS:p2-fault-event') ORDER BY audit.id",
    "SELECT * FROM command_executions WHERE event_id IN ('p2-modern-event-control','p2-fault-event') ORDER BY event_id,command_code",
    "SELECT message.* FROM outbox_messages message JOIN operations operation ON operation.id=message.operation_id WHERE operation.idempotency_key IN ('IRIS:p2-modern-event-control','IRIS:p2-fault-event') ORDER BY message.id",
  ];
  const snapshot: unknown[] = [];
  for (const statement of statements) snapshot.push(await database.query<Array<Record<string, unknown>>>(statement));
  return JSON.stringify(snapshot, (_key, value) => typeof value === "bigint" ? value.toString() : value);
}

async function assertRealModernMutationAndFaultRollback(): Promise<void> {
  await seedModernEventControlFixture();
  const database = runtimeDatabase();
  try {
    const environment = await verifiedEnvironment(database);
    const appIds = ["p2app001", "p2link01", "p2fail01", "p2link02"];
    let appId = 0;
    const appProvider = new MariaAppWiringOperationProvider(
      database,
      environment,
      () => appIds[appId++]!,
      appIds.length,
      () => new Date("2026-09-04T00:00:00.000Z"),
      () => "2".repeat(64),
      30_000,
    );
    const eventIds = ["p2event1", "p2event2"];
    let eventId = 0;
    const domainProvider = new PetExploreEventControlAppWiringProvider(
      () => eventIds[eventId++]!,
      3,
      () => new Date("2026-09-04T00:00:00.000Z"),
    );
    let executeCount = 0;
    let releaseFirst!: () => void;
    let enteredFirst!: () => void;
    let contenderReachedClaimLock!: () => void;
    const firstEntered = new Promise<void>((resolve) => { enteredFirst = resolve; });
    const release = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const contenderReached = new Promise<void>((resolve) => { contenderReachedClaimLock = resolve; });
    const ingress = new PetExploreAppWiringIngress(
      appProvider,
      modernRouteDispatcher(),
      undefined,
      {
        execute: async (participant, event, claim) => {
          executeCount += 1;
          enteredFirst();
          await release;
          return domainProvider.execute(participant, event, claim);
        },
      },
    );
    const first = ingress.handle(modernEvent());
    await firstEntered;
    const contenderProvider = new MariaAppWiringOperationProvider(
      observedContenderDatabase(database, contenderReachedClaimLock),
      environment,
      () => { throw new Error("P2_CONTENDER_MUST_REPLAY_EXISTING_OPERATION"); },
      1,
      () => new Date("2026-09-04T00:00:00.000Z"),
      () => "6".repeat(64),
      30_000,
    );
    const contenderIngress = new PetExploreAppWiringIngress(
      contenderProvider,
      modernRouteDispatcher(),
      undefined,
      { execute: async () => { throw new Error("P2_CONTENDER_MUST_NOT_EXECUTE_DOMAIN_MUTATION"); } },
    );
    const concurrent = contenderIngress.handle(modernEvent());
    try {
      await contenderReached;
    } finally {
      releaseFirst();
    }
    const results = await Promise.all([first, concurrent]);
    assert.deepEqual(results.map((result) => result.status), ["modern", "modern"]);
    assert.deepEqual(results.map((result) => result.status === "modern" ? result.replayed : null).sort(), [false, true]);
    assert.equal(executeCount, 1, "same request must have exactly one mutation owner");

    const replay = await ingress.handle(modernEvent());
    assert.equal(replay.status, "modern");
    if (replay.status === "modern") assert.equal(replay.replayed, true);
    assert.equal(executeCount, 1, "terminal replay must not execute domain mutation again");

    const claim = (await database.query<Array<{ claim_state: string; effect_mode: string; lease_token: string | null; result_json: string }>>(
      "SELECT claim_state,effect_mode,lease_token,result_json FROM canonical_app_wiring_operations WHERE external_request_id=?",
      [modernEventId],
    ))[0]!;
    assert.deepEqual([claim.claim_state, claim.effect_mode, claim.lease_token], ["COMPLETED", "MUTATION", null]);
    const receipt = (await database.query<Array<{ operation_status: string; result_fingerprint: string }>>(
      "SELECT operation_status,result_fingerprint FROM canonical_pet_explore_event_control_operations WHERE pet_explore_event_control_operation_id='p2event1'",
    ))[0]!;
    const link = (await database.query<Array<{ receipt_kind: string; result_fingerprint: string; pet_explore_event_control_operation_id: string }>>(
      "SELECT receipt_kind,result_fingerprint,pet_explore_event_control_operation_id FROM canonical_app_wiring_receipt_links WHERE app_wiring_operation_id='p2app001'",
    ))[0]!;
    assert.equal(receipt.operation_status, "COMPLETED");
    assert.deepEqual([link.receipt_kind, link.pet_explore_event_control_operation_id, link.result_fingerprint], ["PET_EXPLORE_EVENT_CONTROL", "p2event1", receipt.result_fingerprint]);
    const claimResult = JSON.parse(claim.result_json) as { referenceId?: string; resultFingerprint?: string };
    assert.deepEqual([claimResult.referenceId, claimResult.resultFingerprint], ["p2event1", receipt.result_fingerprint]);
    const config = (await database.query<Array<{ event_mine_active: number; guild_raid_active: number; version: bigint }>>(
      "SELECT event_mine_active,guild_raid_active,version FROM pet_explore_runtime_config WHERE config_id=1",
    ))[0]!;
    assert.deepEqual([Number(config.event_mine_active), Number(config.guild_raid_active), Number(config.version)], [1, 0, 2]);
    assert.deepEqual(await transitionCounts(database), {
      app_claims: "1", typed_operations: "1", receipt_links: "1", legacy_operations: "1", command_executions: "1", outbox_messages: "2",
    });

    await database.execute(
      "CREATE TRIGGER wbs743_p2_terminal_fault BEFORE UPDATE ON canonical_app_wiring_operations FOR EACH ROW SET NEW.claim_state=IF(OLD.external_request_id='p2-fault-event' AND NEW.claim_state='COMPLETED','P2_FAULT',NEW.claim_state)",
    );
    const faultIngress = new PetExploreAppWiringIngress(appProvider, modernRouteDispatcher(), undefined, domainProvider);
    const faultEvent = settlementCommandEvent({
      eventId: "p2-fault-event",
      providerEventId: "p2-fault-event",
      userId: modernExternalUserId,
      channelId: modernChannelId,
      message: "/레이드이벤트활성화",
    });
    try {
      await assert.rejects(() => faultIngress.handle(faultEvent));
    } finally {
      await database.execute("DROP TRIGGER IF EXISTS wbs743_p2_terminal_fault");
    }
    const failed = (await database.query<Array<{ claim_state: string; error_code: string; lease_token: string | null }>>(
      "SELECT claim_state,error_code,lease_token FROM canonical_app_wiring_operations WHERE external_request_id='p2-fault-event'",
    ))[0]!;
    assert.deepEqual([failed.claim_state, failed.error_code, failed.lease_token], ["FAILED", "PET_EXPLORE_MODERN_MUTATION_FAILED", null]);
    const rolledBack = (await database.query<Array<{ guild_raid_active: number; version: bigint }>>(
      "SELECT guild_raid_active,version FROM pet_explore_runtime_config WHERE config_id=1",
    ))[0]!;
    assert.deepEqual([Number(rolledBack.guild_raid_active), Number(rolledBack.version)], [0, 2]);
    const faultArtifacts = (await database.query<Array<{ typed_count: bigint; link_count: bigint }>>(
      `SELECT
       (SELECT COUNT(*) FROM canonical_pet_explore_event_control_operations WHERE request_key='IRIS:p2-fault-event') typed_count,
       (SELECT COUNT(*) FROM canonical_app_wiring_receipt_links link JOIN canonical_app_wiring_operations claim ON claim.app_wiring_operation_id=link.app_wiring_operation_id WHERE claim.external_request_id='p2-fault-event') link_count`,
    ))[0]!;
    assert.deepEqual([Number(faultArtifacts.typed_count), Number(faultArtifacts.link_count)], [0, 0]);
    const faultLegacyArtifacts = (await database.query<Array<{ operation_count: bigint; change_count: bigint; audit_count: bigint; execution_count: bigint; outbox_count: bigint }>>(
      `SELECT
       (SELECT COUNT(*) FROM operations WHERE idempotency_key='IRIS:p2-fault-event') operation_count,
       (SELECT COUNT(*) FROM pet_explore_event_control_changes change_row JOIN operations operation ON operation.id=change_row.operation_id WHERE operation.idempotency_key='IRIS:p2-fault-event') change_count,
       (SELECT COUNT(*) FROM command_audit audit JOIN operations operation ON operation.id=audit.operation_id WHERE operation.idempotency_key='IRIS:p2-fault-event') audit_count,
       (SELECT COUNT(*) FROM command_executions WHERE event_id='p2-fault-event') execution_count,
       (SELECT COUNT(*) FROM outbox_messages message JOIN operations operation ON operation.id=message.operation_id WHERE operation.idempotency_key='IRIS:p2-fault-event') outbox_count`,
    ))[0]!;
    assert.deepEqual(Object.values(faultLegacyArtifacts).map(Number), [0, 0, 0, 0, 0]);
  } finally {
    await database.close();
  }
}

async function assertExpiredMutationOwnerIsFenced(): Promise<void> {
  const database = runtimeDatabase();
  try {
    const environment = await verifiedEnvironment(database);
    let clock = new Date("2026-09-04T00:00:00.000Z");
    const staleProvider = new MariaAppWiringOperationProvider(
      database,
      environment,
      () => "p2exp001",
      3,
      () => clock,
      () => "4".repeat(64),
      30_000,
    );
    const input = {
      entrypointKind: "IRIS" as const,
      externalRequestId: "p2-expired-mutation",
      normalizedPayload: { command: "/p2-expired" },
      actor: "test:p2",
    };
    const stale = await staleProvider.prepare(input, () => ({
      route: "MODERN",
      effectMode: "MUTATION",
      reasonCode: "MODERN_ROUTE_ALLOWED",
      commandCode: "P2_EXPIRED_MUTATION",
    }));
    if (stale.replayed) throw new Error("P2_EXPIRED_CLAIM_UNEXPECTED_REPLAY");
    await assert.rejects(
      () => staleProvider.runMutation(stale, async (participant) => {
        await participant.execute("UPDATE pet_explore_runtime_config SET guild_raid_active=TRUE,version=version+1 WHERE config_id=1");
        clock = new Date("2026-09-04T00:01:00.000Z");
        await participant.execute("UPDATE pet_explore_runtime_config SET guild_raid_active=FALSE,version=version+1 WHERE config_id=1");
        return {
          value: "unreachable",
          receipt: { status: "UNREACHABLE", resultFingerprint: "0".repeat(64) },
          typedReceipt: { receiptKind: "PET_EXPLORE_EVENT_CONTROL", petExploreEventControlOperationId: "p2event1", resultFingerprint: "0".repeat(64) },
        };
      }),
      /APP_WIRING_LEASE_EXPIRED/,
    );
    const unchanged = (await database.query<Array<{ guild_raid_active: number; version: bigint }>>(
      "SELECT guild_raid_active,version FROM pet_explore_runtime_config WHERE config_id=1",
    ))[0]!;
    assert.deepEqual([Number(unchanged.guild_raid_active), Number(unchanged.version)], [0, 2]);
    const takeoverProvider = new MariaAppWiringOperationProvider(
      database,
      environment,
      () => { throw new Error("P2_TAKEOVER_MUST_REUSE_OPERATION_ID"); },
      1,
      () => clock,
      () => "5".repeat(64),
      30_000,
    );
    const takeover = await takeoverProvider.prepare(input, () => { throw new Error("P2_TAKEOVER_MUST_NOT_REROUTE"); });
    assert.equal(takeover.replayed, false);
    if (takeover.replayed) throw new Error("P2_TAKEOVER_UNEXPECTED_REPLAY");
    assert.equal(takeover.claim.claimState, "CLAIMED");
    await assert.rejects(
      () => staleProvider.runMutation(stale, async () => { throw new Error("P2_STALE_HANDLER_MUST_NOT_RUN"); }),
      /APP_WIRING_LEASE_FENCE_CONFLICT/,
    );
  } finally {
    await database.close();
  }
}

async function assertRestartReplayWithoutDml(): Promise<void> {
  const database = runtimeDatabase();
  try {
    const before = await transitionCounts(database);
    const beforeSnapshot = await transitionSnapshot(database);
    const environment = await verifiedEnvironment(database);
    const appProvider = new MariaAppWiringOperationProvider(
      database,
      environment,
      () => { throw new Error("P2_RESTART_REPLAY_GENERATED_NEW_ID"); },
      1,
      () => new Date("2026-09-04T00:01:00.000Z"),
      () => "3".repeat(64),
      30_000,
    );
    const ingress = new PetExploreAppWiringIngress(
      appProvider,
      modernRouteDispatcher(),
      undefined,
      { execute: async () => { throw new Error("P2_RESTART_REPLAY_RERAN_DOMAIN_MUTATION"); } },
    );
    const replay = await ingress.handle(modernEvent());
    assert.equal(replay.status, "modern");
    if (replay.status === "modern") assert.equal(replay.replayed, true);
    assert.deepEqual(await transitionCounts(database), before, "restart replay must add no domain, receipt, claim, execution, or outbox DML");
    assert.equal(await transitionSnapshot(database), beforeSnapshot, "restart replay must preserve every relevant row value, not only counts");
    const fingerprint = (await database.query<Array<{ result_fingerprint: string }>>(
      "SELECT result_fingerprint FROM canonical_pet_explore_event_control_operations WHERE request_key='IRIS:p2-modern-event-control'",
    ))[0]!.result_fingerprint;
    await database.execute(
      "UPDATE canonical_app_wiring_receipt_links link JOIN canonical_app_wiring_operations claim ON claim.app_wiring_operation_id=link.app_wiring_operation_id SET link.result_fingerprint=REPEAT('0',64) WHERE claim.external_request_id=?",
      [modernEventId],
    );
    await assert.rejects(() => ingress.handle(modernEvent()), /APP_WIRING_REPLAY_RECEIPT_LINK_MISMATCH/);
    await database.execute(
      "UPDATE canonical_app_wiring_receipt_links link JOIN canonical_app_wiring_operations claim ON claim.app_wiring_operation_id=link.app_wiring_operation_id SET link.result_fingerprint=? WHERE claim.external_request_id=?",
      [fingerprint, modernEventId],
    );
    await database.execute(
      "UPDATE canonical_app_wiring_operations SET result_json=JSON_SET(result_json,'$.referenceId','wrong001') WHERE external_request_id=?",
      [modernEventId],
    );
    await assert.rejects(() => ingress.handle(modernEvent()), /APP_WIRING_REPLAY_REFERENCE_ID_MISMATCH/);
    await database.execute(
      "UPDATE canonical_app_wiring_operations SET result_json=JSON_SET(result_json,'$.referenceId','p2event1') WHERE external_request_id=?",
      [modernEventId],
    );
  } finally {
    await database.close();
  }
}

describe("WBS743 Gate2 P2 isolated MariaDB migrations 466 and 470", { skip: !enabled }, () => {
  it("proves migration, real provider concurrency and atomicity, restart replay, rollback and re-forward", async () => {
    const db = await connection();
    try {
      if (phase === "prepare") {
        const migrationCount = await applyThrough465(db);
        assert.ok(migrationCount > 400, `unexpected pre-466 migration count: ${migrationCount}`);

        await db.query(
          `INSERT INTO canonical_app_wiring_operations
           (app_wiring_operation_id,request_identity_fingerprint,request_namespace,entrypoint_kind,external_request_id,request_key,payload_fingerprint,environment_code,database_identity,route,reason_code,command_code,handler_key,claim_state,result_json,error_code,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME)
           VALUES ('p2bad001',?,'hoibot:dev:p2isolated','IRIS','p2-invalid','IRIS:p2-invalid',?,'dev','p2isolated','SHADOW','ROLLOUT_SHADOW','P2_INVALID','p2_invalid','COMPLETED','{\"status\":\"bad\",\"extra\":1}',NULL,'test:p2','2026-09-04 00:00:00','test:p2','2026-09-04 00:00:00')`,
          ["a".repeat(64), "b".repeat(64)],
        );
        await assert.rejects(() => db.query(migration466), /Subquery returns more than 1 row|ER_SUBQUERY_NO_1_ROW/i);
        assert.equal(await columnCount(db), 0, "preflight failure must happen before the first DDL");
        const absent = await db.query<Array<{ count_value: bigint }>>(
          "SELECT COUNT(*) count_value FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='canonical_app_wiring_receipt_links'",
        );
        assert.equal(Number(absent[0]?.count_value ?? 0n), 0);
        await db.query("DELETE FROM canonical_app_wiring_operations WHERE app_wiring_operation_id='p2bad001'");

        await db.query(
          `INSERT INTO canonical_app_wiring_operations
           (app_wiring_operation_id,request_identity_fingerprint,request_namespace,entrypoint_kind,external_request_id,request_key,payload_fingerprint,environment_code,database_identity,route,reason_code,command_code,handler_key,claim_state,result_json,error_code,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME)
           VALUES
           ('p2clm001',?,'hoibot:dev:p2isolated','IRIS','p2-claimed','IRIS:p2-claimed',?,'dev','p2isolated','MODERN','MODERN_ROUTE_ALLOWED','P2_CLAIM','p2_claim','CLAIMED',NULL,NULL,'test:p2','2026-09-04 00:00:00','test:p2','2026-09-04 00:00:00'),
           ('p2cmp001',?,'hoibot:dev:p2isolated','IRIS','p2-completed','IRIS:p2-completed',?,'dev','p2isolated','SHADOW','ROLLOUT_SHADOW','P2_COMPLETE','p2_complete','COMPLETED','{\"status\":\"SHADOW_EVALUATED\"}',NULL,'test:p2','2026-09-04 00:00:00','test:p2','2026-09-04 00:00:00')`,
          ["c".repeat(64), "d".repeat(64), "e".repeat(64), "f".repeat(64)],
        );
        await db.query(migration466);
        await assertForwardShape(db);
        const backfill = await db.query<Array<{ app_wiring_operation_id: string; effect_mode: string; lease_generation: bigint; attempt_count: bigint; recovery_status: string }>>(
          "SELECT app_wiring_operation_id,effect_mode,lease_generation,attempt_count,recovery_status FROM canonical_app_wiring_operations WHERE app_wiring_operation_id IN ('p2clm001','p2cmp001') ORDER BY app_wiring_operation_id",
        );
        assert.deepEqual(backfill.map((row) => [row.app_wiring_operation_id, row.effect_mode, Number(row.lease_generation), Number(row.attempt_count), row.recovery_status]), [
          ["p2clm001", "MUTATION", 0, 1, "NONE"],
          ["p2cmp001", "READ_ONLY", 0, 1, "NONE"],
        ]);
        await db.query(migration466);
        await assertForwardShape(db);
        await assertRealProviderReadPaths();
        await db.query(migration470);
        await assertEventControlReceiptShape(db);
        await assertRealModernMutationAndFaultRollback();
        await assertExpiredMutationOwnerIsFenced();
        await db.query(migration470);
        await assertEventControlReceiptShape(db);
        await db.query(
          "CREATE TABLE IF NOT EXISTS wbs743_p2_evidence (evidence_key VARCHAR(64) PRIMARY KEY,evidence_value VARCHAR(191) NOT NULL)",
        );
        await db.query(
          "INSERT INTO wbs743_p2_evidence(evidence_key,evidence_value) VALUES ('migration466_checksum',?),('migration470_checksum',?),('prepare_complete','true') ON DUPLICATE KEY UPDATE evidence_value=VALUES(evidence_value)",
          [sha(migration466), sha(migration470)],
        );
        return;
      }

      const evidence = await db.query<Array<{ evidence_key: string; evidence_value: string }>>(
        "SELECT evidence_key,evidence_value FROM wbs743_p2_evidence ORDER BY evidence_key",
      );
      assert.deepEqual(Object.fromEntries(evidence.map((row) => [row.evidence_key, row.evidence_value])), {
        migration466_checksum: sha(migration466),
        migration470_checksum: sha(migration470),
        prepare_complete: "true",
      });
      await assertForwardShape(db, 11);
      await assertEventControlReceiptShape(db);
      await assertRestartReplayWithoutDml();
      await assert.rejects(() => db.query(rollback470), /Subquery returns more than 1 row|ER_SUBQUERY_NO_1_ROW/i);
      await assertEventControlReceiptShape(db);
      await db.query("DELETE FROM canonical_app_wiring_receipt_links WHERE receipt_kind='PET_EXPLORE_EVENT_CONTROL'");
      await db.query("DELETE FROM canonical_pet_explore_event_control_operations");
      await db.query("DELETE FROM canonical_app_wiring_operations WHERE external_request_id='p2-modern-event-control'");
      await db.query(rollback470);
      await db.query(rollback470);
      const removedEventControl = await db.query<Array<{ count_value: bigint }>>(
        "SELECT COUNT(*) count_value FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='canonical_pet_explore_event_control_operations'",
      );
      assert.equal(Number(removedEventControl[0]?.count_value ?? 0n), 0);
      await db.query(rollback466);
      assert.equal(await columnCount(db), 0);
      await db.query(rollback466);
      assert.equal(await columnCount(db), 0);
      await db.query(migration466);
      await assertForwardShape(db);
      await db.query(migration470);
      await assertEventControlReceiptShape(db);
      const completedMutationOrphans = await db.query<Array<{ count_value: bigint }>>(
        `SELECT COUNT(*) count_value FROM canonical_app_wiring_operations claim
         LEFT JOIN canonical_app_wiring_receipt_links link ON link.app_wiring_operation_id=claim.app_wiring_operation_id
         WHERE claim.claim_state='COMPLETED' AND claim.effect_mode='MUTATION' AND link.app_wiring_operation_id IS NULL`,
      );
      assert.equal(Number(completedMutationOrphans[0]?.count_value ?? 0n), 0);
    } finally {
      await db.end();
    }
  });
});
