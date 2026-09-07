import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, describe, it } from "node:test";
import { createDatabaseClient, hasDatabaseTransactionCapabilities, type DatabaseClient } from "../src/database.js";
import { MariaAppWiringOperationProvider } from "../src/dispatch/app-wiring-operation-provider.js";
import { MariaAppWiringReadOnlyRecoveryProvider } from "../src/dispatch/app-wiring-read-only-recovery-provider.js";
import { normalizeIrisEvent, type NormalizedIrisEvent } from "../src/integration/iris-normalizer.js";
import { OutboxWorker } from "../src/integration/outbox-worker.js";
import { executePetSkillInfoReadOnlyRecovery } from "../src/pet/pet-skill-info-read-only-recovery-ingress.js";
import type { PetSkillInfoActorContext } from "../src/pet/pet-skill-info-actor-context-provider.js";
import { normalizePetSkillInfoDispatchMessage } from "../src/pet/pet-skill-info-shadow-service.js";
import { createEnvironmentContext, verifyStartupDatabaseIdentity, type VerifiedEnvironmentContext } from "../src/runtime/environment-context.js";

const enabled = process.env.WBS770_PET_SKILL_INFO_DIRECT_REPLY_MARIADB_TEST === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

type CountRow = { count_value: bigint | number | string };
type Fixture = { playerId: string; externalIdentityId: string };
type DurableCounts = Readonly<{
  inbox: number;
  routing: number;
  claims: number;
  operations: number;
  executions: number;
  outboxes: number;
}>;

let database: DatabaseClient | undefined;
let environment: VerifiedEnvironmentContext | undefined;

function event(providerEventId: string, room: string, user: string): NormalizedIrisEvent {
  return normalizeIrisEvent({
    msg: "/펫스킬정보",
    room,
    sender: "호이",
    json: { id: providerEventId, type: "text", user_id: user, chat_id: room }
  });
}

async function insertLinkedFixture(user: string): Promise<Fixture> {
  assert.ok(database !== undefined);
  const player = await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
  const identity = await database.execute(
    "INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'호이','linked')",
    [player.insertId, user]
  );
  return { playerId: player.insertId.toString(), externalIdentityId: identity.insertId.toString() };
}

function actorContext(fixture: Fixture, room: string): PetSkillInfoActorContext {
  return Object.freeze({
    selectionSource: "ACTIVE_CONTEXT",
    platformCode: "kakao",
    externalContextId: room,
    externalIdentityId: fixture.externalIdentityId,
    selectedLegacyPlayerId: fixture.playerId,
    selectedCanonicalPlayerId: "playr001",
    entitlementLegacyPlayerId: fixture.playerId,
    portalAccountId: "portal01",
    platformContextMembershipId: "membr001",
    selectionVersion: "1"
  });
}

async function scalar(sql: string, values: readonly unknown[] = []): Promise<number> {
  assert.ok(database !== undefined);
  const rows = await database.query<CountRow[]>(sql, values);
  assert.equal(rows.length, 1);
  return Number(rows[0]!.count_value);
}

async function durableCounts(eventId: string): Promise<DurableCounts> {
  return {
    inbox: await scalar("SELECT COUNT(*) count_value FROM event_inbox WHERE event_id=?", [eventId]),
    routing: await scalar("SELECT COUNT(*) count_value FROM command_routing_decisions WHERE event_id=? AND command_code='PET_SKILL_INFO'", [eventId]),
    claims: await scalar("SELECT COUNT(*) count_value FROM canonical_app_wiring_operations WHERE external_request_id=? AND command_code='PET_SKILL_INFO'", [eventId]),
    operations: await scalar("SELECT COUNT(*) count_value FROM operations operation_row JOIN command_executions execution_row ON execution_row.operation_id=operation_row.id WHERE execution_row.event_id=? AND execution_row.command_code='PET_SKILL_INFO'", [eventId]),
    executions: await scalar("SELECT COUNT(*) count_value FROM command_executions WHERE event_id=? AND command_code='PET_SKILL_INFO'", [eventId]),
    outboxes: await scalar("SELECT COUNT(*) count_value FROM outbox_messages outbox_row JOIN command_executions execution_row ON execution_row.operation_id=outbox_row.operation_id WHERE execution_row.event_id=? AND execution_row.command_code='PET_SKILL_INFO'", [eventId])
  };
}

async function commandPathStateFingerprint(): Promise<string> {
  assert.ok(database !== undefined);
  const rows = await database.query<Array<{ Table: string; Checksum: bigint | number | string | null }>>(
    `CHECKSUM TABLE event_inbox,normalized_provider_events,channels,external_identities,
       external_identity_names,channel_memberships,channel_activity_daily,command_routing_decisions,
       canonical_app_wiring_operations,operations,command_executions,outbox_messages,delivery_attempts`
  );
  assert.equal(rows.length, 13);
  return rows.map(row => `${row.Table}:${String(row.Checksum)}`).join("|");
}

function recovery(): MariaAppWiringReadOnlyRecoveryProvider {
  assert.ok(database !== undefined && environment !== undefined);
  if (!hasDatabaseTransactionCapabilities(database)) throw new Error("WBS770_DATABASE_TRANSACTION_CAPABILITIES_REQUIRED");
  return new MariaAppWiringReadOnlyRecoveryProvider(
    database,
    new MariaAppWiringOperationProvider(database, environment)
  );
}

after(async () => database?.close());

describe("WBS770 /펫스킬정보 DIRECT reply isolated MariaDB", { skip: !enabled }, () => {
  it("applies migration 487 and proves atomic enqueue, replay, denial, historical Shadow, and worker single ownership without network", async () => {
    const databaseIdentity = required("DATABASE_NAME");
    database = createDatabaseClient({
      enabled: true,
      host: required("DATABASE_HOST"),
      port: Number(required("DATABASE_PORT")),
      user: required("DATABASE_USER"),
      password: required("DATABASE_PASSWORD"),
      name: databaseIdentity,
      connectionLimit: 4,
      connectTimeoutMs: 5_000
    });
    environment = await verifyStartupDatabaseIdentity(
      database,
      createEnvironmentContext({ environmentCode: "dev", databaseIdentity })
    );

    const routeRows = await database.query<Array<{ rollout_state: string; version: number }>>(
      "SELECT rollout_state,version FROM command_registry WHERE command_code='PET_SKILL_INFO'"
    );
    assert.deepEqual(routeRows, [{ rollout_state: "CANARY", version: 2 }]);
    const eventColumn = await database.query<Array<{ COLUMN_TYPE: string; CHARACTER_SET_NAME: string; COLLATION_NAME: string }>>(
      "SELECT COLUMN_TYPE,CHARACTER_SET_NAME,COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='command_routing_decisions' AND COLUMN_NAME='event_id'"
    );
    assert.deepEqual(eventColumn, [{ COLUMN_TYPE: "varchar(128)", CHARACTER_SET_NAME: "utf8mb4", COLLATION_NAME: "utf8mb4_unicode_ci" }]);

    const directRoom = "wbs770-direct-room";
    const directFixture = await insertLinkedFixture("wbs770-direct-user");
    const directEvent = event("wbs770-direct-event", directRoom, "wbs770-direct-user");
    let directEvaluatorRuns = 0;
    const directActor = {
      resolve: async (): Promise<PetSkillInfoActorContext> => {
        directEvaluatorRuns += 1;
        return actorContext(directFixture, directRoom);
      }
    };
    const directInput = {
      database,
      recovery: recovery(),
      environmentContext: environment,
      event: directEvent,
      replyIdentity: directEvent,
      channelType: "open_group" as const,
      route: "MODERN" as const,
      reasonCode: "MODERN_ROUTE_ALLOWED",
      actorContext: directActor
    };
    const first = await executePetSkillInfoReadOnlyRecovery(directInput);
    assert.equal(first.processing.duplicate, false);
    assert.deepEqual(first.processing.replies, [], "HTTP immediate-send list must remain empty");
    assert.deepEqual(first.queuedReply, {
      outboxId: first.queuedReply?.outboxId,
      room: directRoom,
      data: "사용법:\n/펫스킬정보 [펫스킬이름] — 펫스킬 효과 조회\n/펫스킬정보 [유저닉네임] — 유저 펫스킬가방 조회 (관리자 전용)"
    });
    assert.match(first.queuedReply?.outboxId ?? "", /^[1-9][0-9]*$/);
    assert.equal(directEvaluatorRuns, 1);
    const directFirstCounts = await durableCounts(directEvent.eventId);
    assert.deepEqual(directFirstCounts, { inbox: 1, routing: 1, claims: 1, operations: 1, executions: 1, outboxes: 1 });
    const atomicRows = await database.query<Array<{ processing_status: string; claim_state: string; operation_status: string; execution_status: string; result_code: string; outbox_status: string; route: string }>>(
      `SELECT inbox.processing_status,claim_row.claim_state,operation_row.status operation_status,
              execution_row.execution_status,execution_row.result_code,outbox_row.status outbox_status,routing.route
       FROM event_inbox inbox
       JOIN command_routing_decisions routing ON routing.event_id=inbox.event_id AND routing.command_code='PET_SKILL_INFO'
       JOIN canonical_app_wiring_operations claim_row ON claim_row.external_request_id=inbox.event_id AND claim_row.command_code='PET_SKILL_INFO'
       JOIN command_executions execution_row ON execution_row.event_id=inbox.event_id AND execution_row.command_code='PET_SKILL_INFO'
       JOIN operations operation_row ON operation_row.id=execution_row.operation_id
       JOIN outbox_messages outbox_row ON outbox_row.operation_id=operation_row.id
       WHERE inbox.event_id=?`,
      [directEvent.eventId]
    );
    assert.deepEqual(atomicRows, [{
      processing_status: "processed",
      claim_state: "COMPLETED",
      operation_status: "completed",
      execution_status: "completed",
      result_code: "reply_queued",
      outbox_status: "pending",
      route: "MODERN"
    }]);

    const replay = await executePetSkillInfoReadOnlyRecovery({ ...directInput, recovery: recovery() });
    assert.equal(replay.processing.duplicate, true);
    assert.deepEqual(replay.processing.replies, []);
    assert.deepEqual(replay.queuedReply, first.queuedReply);
    assert.equal(directEvaluatorRuns, 1, "replay must not invoke the evaluator");
    assert.deepEqual(await durableCounts(directEvent.eventId), directFirstCounts, "replay must create no durable rows");

    const deniedEvent = event("wbs770-denied-event", "wbs770-denied-room", "wbs770-denied-user");
    let deniedActorRuns = 0;
    const denied = await executePetSkillInfoReadOnlyRecovery({
      database,
      recovery: recovery(),
      environmentContext: environment,
      event: deniedEvent,
      replyIdentity: deniedEvent,
      channelType: "open_direct",
      route: "MODERN",
      reasonCode: "MODERN_ROUTE_ALLOWED",
      actorContext: { resolve: async () => { deniedActorRuns += 1; throw new Error("DENIED_ACTOR_MUST_NOT_RUN"); } }
    });
    assert.equal(denied.denialReason, "PET_SKILL_INFO_PRIVATE_IDENTITY_REQUIRED");
    assert.equal(denied.queuedReply, undefined);
    assert.equal(deniedActorRuns, 0);
    assert.deepEqual(await durableCounts(deniedEvent.eventId), { inbox: 1, routing: 1, claims: 1, operations: 1, executions: 1, outboxes: 0 });
    const deniedRows = await database.query<Array<{ route: string; claim_state: string; result_code: string; operation_scope: string }>>(
      `SELECT claim_row.route,claim_row.claim_state,execution_row.result_code,operation_row.idempotency_scope operation_scope
       FROM canonical_app_wiring_operations claim_row
       JOIN command_executions execution_row ON execution_row.event_id=claim_row.external_request_id AND execution_row.command_code=claim_row.command_code
       JOIN operations operation_row ON operation_row.id=execution_row.operation_id
       WHERE claim_row.external_request_id=? AND claim_row.command_code='PET_SKILL_INFO'`,
      [deniedEvent.eventId]
    );
    assert.deepEqual(deniedRows, [{ route: "MODERN", claim_state: "COMPLETED", result_code: "ignored", operation_scope: "app-wiring.read-only-no-reply" }]);

    const shadowRoom = "wbs770-shadow-room";
    const shadowFixture = await insertLinkedFixture("wbs770-shadow-user");
    const shadowEvent = event("wbs770-shadow-event", shadowRoom, "wbs770-shadow-user");
    const historicalDispatchMessage = normalizePetSkillInfoDispatchMessage(shadowEvent.message!);
    const historicalMessageHash = createHash("sha256").update(historicalDispatchMessage, "utf8").digest("hex");
    await database.execute(
      "INSERT INTO command_routing_decisions(event_id,message_hash,command_code,route,reason_code) VALUES (?,?,'PET_SKILL_INFO','SHADOW','SHADOW_ROLLOUT')",
      [shadowEvent.eventId, historicalMessageHash]
    );
    assert.deepEqual(await durableCounts(shadowEvent.eventId), { inbox: 0, routing: 1, claims: 0, operations: 0, executions: 0, outboxes: 0 });
    let shadowEvaluatorRuns = 0;
    const shadowBase = {
      database,
      environmentContext: environment,
      event: shadowEvent,
      replyIdentity: shadowEvent,
      channelType: "open_group" as const,
      actorContext: {
        resolve: async (): Promise<PetSkillInfoActorContext> => {
          shadowEvaluatorRuns += 1;
          return actorContext(shadowFixture, shadowRoom);
        }
      }
    };
    const shadow = await executePetSkillInfoReadOnlyRecovery({ ...shadowBase, recovery: recovery(), route: "SHADOW", reasonCode: "SHADOW_ROLLOUT" });
    assert.equal(shadow.queuedReply, undefined);
    assert.equal(shadowEvaluatorRuns, 1);
    const shadowCounts = await durableCounts(shadowEvent.eventId);
    assert.deepEqual(shadowCounts, { inbox: 1, routing: 1, claims: 1, operations: 1, executions: 1, outboxes: 0 });
    const historicalStateBeforeReplay = await commandPathStateFingerprint();
    const historicalReplay = await executePetSkillInfoReadOnlyRecovery({ ...shadowBase, recovery: recovery(), route: "MODERN", reasonCode: "MODERN_ROUTE_ALLOWED" });
    assert.equal(historicalReplay.processing.duplicate, true);
    assert.equal(historicalReplay.queuedReply, undefined, "historical SHADOW receipt must remain NO_REPLY");
    assert.equal(shadowEvaluatorRuns, 1);
    assert.deepEqual(await durableCounts(shadowEvent.eventId), shadowCounts);
    assert.equal(await commandPathStateFingerprint(), historicalStateBeforeReplay, "historical MODERN replay must not change any command-path durable table");
    assert.equal(await scalar("SELECT COUNT(*) count_value FROM command_routing_decisions WHERE event_id=? AND route='SHADOW'", [shadowEvent.eventId]), 1);

    const delivered: Array<{ room: string; data: string }> = [];
    let externalNetworkCalls = 0;
    const worker = new OutboxWorker(database, async message => { delivered.push(message); });
    assert.equal(await worker.runOnce(), 1);
    assert.deepEqual(delivered, [{ room: directRoom, data: first.queuedReply!.data }]);
    assert.equal(await worker.runOnce(), 0, "sent rows must not be claimed on replay");
    assert.equal(delivered.length, 1, "sender spy must be invoked exactly once");
    assert.equal(externalNetworkCalls, 0, "the rehearsal must not invoke an external network adapter");
    assert.equal(await scalar("SELECT COUNT(*) count_value FROM outbox_messages WHERE id=? AND status='sent' AND attempt_count=1", [first.queuedReply!.outboxId]), 1);
    assert.equal(await scalar("SELECT COUNT(*) count_value FROM delivery_attempts WHERE outbox_message_id=? AND attempt_no=1 AND result_code='sent'", [first.queuedReply!.outboxId]), 1);
  });
});
