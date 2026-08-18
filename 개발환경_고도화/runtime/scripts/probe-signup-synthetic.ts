import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { ApplicationError } from "../src/shared/application-error.js";
import {
  SIGNUP_TERMS_VERSION,
  buildSignupTermsMessage,
  buildSignupWelcomeMessage
} from "../src/signup/signup-policy.js";
import { SignupService, type SignupCommandResult } from "../src/signup/signup-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (config.database.name !== "hoibot_schema_design" && !/^hoibot_rehearsal_[a-z0-9_]+$/i.test(config.database.name)) {
  throw new Error(`Synthetic signup probe is blocked for database: ${config.database.name}`);
}

const database = createDatabaseClient(config.database);
const service = new SignupService(database);
const runKey = randomUUID().replaceAll("-", "").slice(0, 12);
const channelId = "synthetic-room-001";
const acceptExternalUserId = `synthetic-signup-accept-${runKey}`;
const rejectExternalUserId = `synthetic-signup-reject-${runKey}`;
const acceptDisplayName = `합성승인${runKey} 남`;
const rejectDisplayName = `합성거절${runKey} 여`;

// 가입 명령과 FK로 연결할 합성 Iris 이벤트를 생성합니다.
async function seedEvent(eventId: string, externalUserId: string, externalIdentityId: bigint): Promise<void> {
  await database.execute(
    `INSERT INTO event_inbox
       (event_id, provider_code, provider_event_id, external_channel_id, channel_id,
        external_user_id, external_identity_id, event_kind, event_origin, direction,
        payload_hash, parse_status, processing_status, received_at)
     VALUES (?, 'iris', ?, ?, 900000001, ?, ?, 'message', 'synthetic_probe', 'incoming',
       REPEAT('0', 64), 'parsed', 'processed', UTC_TIMESTAMP(3))`,
    [eventId, eventId, channelId, externalUserId, externalIdentityId]
  );
}

// 합성 Kakao identity를 미가입 후보 상태로 생성합니다.
async function seedCandidate(externalUserId: string, displayName: string): Promise<bigint> {
  const result = await database.execute(
    `INSERT INTO external_identities
       (player_id, provider_code, external_user_id, display_name, status, created_at, updated_at)
     VALUES (NULL, 'kakao', ?, ?, 'candidate', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [externalUserId, displayName]
  );
  return result.insertId;
}

// 기대한 가입 오류 코드와 상태인지 확인합니다.
async function assertApplicationError(work: () => Promise<unknown>, code: string, statusCode: number): Promise<void> {
  await assert.rejects(work, (error: unknown) =>
    error instanceof ApplicationError && error.code === code && error.statusCode === statusCode
  );
}

try {
  await assertApplicationError(() => service.handle({
    externalUserId: acceptExternalUserId,
    displayName: acceptDisplayName,
    channelId,
    message: "/가입 해줘",
    eventId: `invalid-${runKey}`
  }), "INVALID_SIGNUP_COMMAND", 422);

  const acceptIdentityId = await seedCandidate(acceptExternalUserId, acceptDisplayName);
  await database.execute(
    `INSERT INTO pre_signup_attendance
       (external_identity_id, legacy_display_name, normalized_display_name, attendance_count,
        last_attended_on, game_server_id, status, version, created_at, updated_at)
     VALUES (?, ?, ?, 3, UTC_DATE(), 900000002, 'active', 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [acceptIdentityId, acceptDisplayName, acceptDisplayName.toLowerCase()]
  );
  const requestEventId = `signup-request-${runKey}`;
  const acceptEventId = `signup-accept-${runKey}`;
  await seedEvent(requestEventId, acceptExternalUserId, acceptIdentityId);
  await seedEvent(acceptEventId, acceptExternalUserId, acceptIdentityId);

  const requestCommand = {
    externalUserId: acceptExternalUserId,
    displayName: acceptDisplayName,
    channelId,
    message: "/가입",
    eventId: requestEventId
  };
  const requestResult = await service.handle(requestCommand);
  const requestReplay = await service.handle(requestCommand);
  assert.deepEqual(requestReplay, requestResult);
  assert.equal(requestResult.status, "pending");
  assert.equal(requestResult.data, buildSignupTermsMessage());

  const pending = await database.query<Array<{
    status: string;
    normalized_display_name: string | null;
    terms_version: string;
    player_id: bigint | null;
  }>>(
    `SELECT status, normalized_display_name, terms_version, player_id
     FROM player_signup_requests WHERE external_identity_id = ?`,
    [acceptIdentityId]
  );
  assert.deepEqual(pending, [{
    status: "pending",
    normalized_display_name: acceptDisplayName.toLowerCase(),
    terms_version: SIGNUP_TERMS_VERSION,
    player_id: null
  }]);

  const playersBeforeAccept = await database.query<Array<{ count_value: bigint }>>(
    "SELECT COUNT(*) AS count_value FROM player_profiles WHERE current_display_name = ?",
    [acceptDisplayName]
  );
  assert.equal(playersBeforeAccept[0]?.count_value, 0n);

  const acceptCommand = { ...requestCommand, message: "/시작한다", eventId: acceptEventId };
  const restartedDatabase = createDatabaseClient(config.database);
  let acceptResult: SignupCommandResult;
  try {
    acceptResult = await new SignupService(restartedDatabase).handle(acceptCommand);
  } finally {
    await restartedDatabase.close();
  }
  const acceptReplay = await service.handle(acceptCommand);
  assert.deepEqual(acceptReplay, acceptResult);
  assert.equal(acceptResult.status, "accepted");
  assert.equal(acceptResult.data, buildSignupWelcomeMessage());
  assert.ok(acceptResult.playerId);

  const accepted = await database.query<Array<{
    identity_status: string;
    identity_player_id: bigint;
    signup_status: string;
    profile_name: string;
    game_server_id: bigint;
    level: bigint;
    rebirth_count: bigint;
    terms_agreed: number;
    profile_version: bigint;
  }>>(
    `SELECT identity.status AS identity_status, identity.player_id AS identity_player_id,
       signup.status AS signup_status, profile.current_display_name AS profile_name,
       profile.game_server_id, profile.level, profile.rebirth_count, profile.terms_agreed,
       profile.version AS profile_version
     FROM external_identities identity
     JOIN player_signup_requests signup ON signup.external_identity_id = identity.id
     JOIN player_profiles profile ON profile.player_id = identity.player_id
     WHERE identity.id = ?`,
    [acceptIdentityId]
  );
  assert.equal(accepted[0]?.identity_status, "linked");
  assert.equal(accepted[0]?.identity_player_id.toString(), acceptResult.playerId);
  assert.equal(accepted[0]?.signup_status, "accepted");
  assert.equal(accepted[0]?.profile_name, acceptDisplayName);
  assert.equal(accepted[0]?.game_server_id.toString(), "900000002");
  assert.equal(accepted[0]?.level.toString(), "1");
  assert.equal(accepted[0]?.rebirth_count.toString(), "1");
  assert.equal(Boolean(accepted[0]?.terms_agreed), true);
  assert.equal(accepted[0]?.profile_version.toString(), "1");

  const initialRows = await database.query<Array<{
    pet_count: bigint;
    currency_count: bigint;
    counter_count: bigint;
    lifetime_attendance: bigint;
    today_attendance: bigint;
    attendance_projection_count: bigint;
    pre_signup_migrated_count: bigint;
  }>>(
    `SELECT
       (SELECT COUNT(*) FROM player_pets WHERE player_id = ?) AS pet_count,
       (SELECT COUNT(*) FROM currency_accounts WHERE player_id = ?) AS currency_count,
       (SELECT COUNT(*) FROM player_counters WHERE player_id = ?) AS counter_count,
       (SELECT value FROM player_counters WHERE player_id = ? AND counter_code = 'attendance' AND period_key = 'lifetime') AS lifetime_attendance,
       (SELECT value FROM player_counters WHERE player_id = ? AND counter_code = 'attendance' AND period_key = 'today') AS today_attendance,
       (SELECT COUNT(*) FROM player_attendance WHERE player_id = ? AND attendance_count = 3) AS attendance_projection_count,
       (SELECT COUNT(*) FROM pre_signup_attendance WHERE external_identity_id = ? AND status = 'migrated' AND migrated_player_id = ?) AS pre_signup_migrated_count`,
    [acceptResult.playerId, acceptResult.playerId, acceptResult.playerId,
      acceptResult.playerId, acceptResult.playerId, acceptResult.playerId,
      acceptIdentityId, acceptResult.playerId]
  );
  assert.deepEqual(initialRows, [{
    pet_count: 1n,
    currency_count: 2n,
    counter_count: 11n,
    lifetime_attendance: 3n,
    today_attendance: 1n,
    attendance_projection_count: 1n,
    pre_signup_migrated_count: 1n
  }]);

  const acceptEffects = await database.query<Array<{
    operation_count: bigint;
    audit_count: bigint;
    execution_count: bigint;
    outbox_count: bigint;
  }>>(
    `SELECT
       (SELECT COUNT(*) FROM operations WHERE actor_type = 'external_identity' AND actor_id = ?) AS operation_count,
       (SELECT COUNT(*) FROM command_audit WHERE actor_type = 'external_identity' AND actor_id = ?) AS audit_count,
       (SELECT COUNT(*) FROM command_executions execution JOIN operations operation_row ON operation_row.id = execution.operation_id WHERE operation_row.actor_type = 'external_identity' AND operation_row.actor_id = ?) AS execution_count,
       (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id = outbox.operation_id WHERE operation_row.actor_type = 'external_identity' AND operation_row.actor_id = ?) AS outbox_count`,
    [acceptIdentityId, acceptIdentityId, acceptIdentityId, acceptIdentityId]
  );
  assert.deepEqual(acceptEffects, [{ operation_count: 2n, audit_count: 2n, execution_count: 2n, outbox_count: 3n }]);

  const rejectIdentityId = await seedCandidate(rejectExternalUserId, rejectDisplayName);
  const rejectRequestEventId = `signup-reject-request-${runKey}`;
  const rejectEventId = `signup-reject-${runKey}`;
  await seedEvent(rejectRequestEventId, rejectExternalUserId, rejectIdentityId);
  await seedEvent(rejectEventId, rejectExternalUserId, rejectIdentityId);
  await service.handle({
    externalUserId: rejectExternalUserId,
    displayName: rejectDisplayName,
    channelId,
    message: "/가입",
    eventId: rejectRequestEventId
  });
  const rejectCommand = {
    externalUserId: rejectExternalUserId,
    displayName: rejectDisplayName,
    channelId,
    message: "거절한다",
    eventId: rejectEventId
  };
  const rejectResult = await service.handle(rejectCommand);
  const rejectReplay = await service.handle(rejectCommand);
  assert.deepEqual(rejectReplay, rejectResult);
  assert.equal(rejectResult.status, "rejected");
  assert.equal(rejectResult.data, "호월 봇: 다음에 다시 만나요..!");

  const rejected = await database.query<Array<{
    identity_player_id: bigint | null;
    signup_status: string;
    normalized_display_name: string | null;
  }>>(
    `SELECT identity.player_id AS identity_player_id, signup.status AS signup_status,
       signup.normalized_display_name
     FROM external_identities identity
     JOIN player_signup_requests signup ON signup.external_identity_id = identity.id
     WHERE identity.id = ?`,
    [rejectIdentityId]
  );
  assert.deepEqual(rejected, [{ identity_player_id: null, signup_status: "rejected", normalized_display_name: null }]);
  const rejectedPlayers = await database.query<Array<{ count_value: bigint }>>(
    "SELECT COUNT(*) AS count_value FROM player_profiles WHERE current_display_name = ?",
    [rejectDisplayName]
  );
  assert.equal(rejectedPlayers[0]?.count_value, 0n);

  process.stdout.write(`${JSON.stringify({
    sliceId: "player-signup",
    commands: ["/가입", "시작한다", "/시작한다", "거절한다", "/거절한다"],
    suffixGuardVerified: true,
    pendingCreatedWithoutPlayer: true,
    exactTermsReplyMatched: true,
    pendingSurvivedNewDatabaseClient: true,
    acceptedPlayerId: acceptResult.playerId,
    acceptedInitialRows: { pet: 1, currency: 2, counter: 11, preSignupAttendance: 3 },
    preSignupAttendanceMigrated: true,
    acceptedEffects: { operation: 2, audit: 2, commandExecution: 2, outbox: 3 },
    acceptedIdempotencyVerified: true,
    exactWelcomeReplyMatched: true,
    rejectedWithoutPlayer: true,
    rejectedNameReservationReleased: true,
    rejectedIdempotencyVerified: true,
    exactRejectReplyMatched: true
  })}\n`);
} finally {
  await database.close();
}
