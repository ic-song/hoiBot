import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { normalizeIrisEvent } from "../src/integration/iris-normalizer.js";
import { ProcessIrisEventService, recordOutboxDelivery } from "../src/integration/event-processing-service.js";
import { ChangePlayerServerService } from "../src/player/change-player-server-service.js";
import { ApplicationError } from "../src/shared/application-error.js";
import { hash } from "argon2";
import { AdminAuthService } from "../src/admin/auth-service.js";
import { IrisAdminCommandService } from "../src/admin/iris-admin-command-service.js";

const config = loadConfig();
const database = createDatabaseClient(config.database);
const suffix = randomUUID();
const providerEventId = `probe-${suffix}`;
const deleteProviderEventId = `probe-delete-${suffix}`;
const joinProviderEventId = `probe-join-${suffix}`;
const departProviderEventId = `probe-depart-${suffix}`;
let playerId: bigint | undefined;
let serverId: bigint | undefined;
let operatorId: bigint | undefined;
let externalIdentityId: bigint | undefined;
try {
  const processor = new ProcessIrisEventService(database);
  const event = normalizeIrisEvent({ msg: "/ping", sender: "untrusted-probe-name", json: { id: providerEventId, chat_id: `room-${suffix}`, user_id: `user-${suffix}`, type: 1, v: JSON.stringify({ origin: "MSG", isMine: false }) } });
  const first = await processor.execute(event);
  const duplicate = await processor.execute(event);
  const eventCounts = await database.query<Array<{ commands: bigint; outboxes: bigint; normalized: bigint; activity: bigint; untrusted_names: bigint; canonical_name: string | null }>>(
    `SELECT (SELECT COUNT(*) FROM command_executions WHERE event_id = ?) AS commands,
      (SELECT COUNT(*) FROM outbox_messages outbox JOIN command_executions command ON command.operation_id = outbox.operation_id WHERE command.event_id = ?) AS outboxes,
      (SELECT COUNT(*) FROM normalized_provider_events WHERE event_id = ?) AS normalized,
      (SELECT COUNT(*) FROM channel_activity_daily activity JOIN event_inbox inbox ON inbox.channel_id = activity.channel_id AND inbox.external_identity_id = activity.external_identity_id WHERE inbox.event_id = ?) AS activity,
      (SELECT COUNT(*) FROM external_identity_names observed JOIN event_inbox inbox ON inbox.external_identity_id = observed.external_identity_id WHERE inbox.event_id = ? AND observed.source_code = 'iris_cache' AND observed.trust_status = 'untrusted') AS untrusted_names,
      (SELECT identity.display_name FROM external_identities identity JOIN event_inbox inbox ON inbox.external_identity_id = identity.id WHERE inbox.event_id = ?) AS canonical_name`,
    [event.eventId, event.eventId, event.eventId, event.eventId, event.eventId, event.eventId]
  );
  if (first.duplicate || !duplicate.duplicate || eventCounts[0]?.commands !== 1n || eventCounts[0]?.outboxes !== 1n
    || eventCounts[0]?.normalized !== 1n || eventCounts[0]?.activity !== 1n
    || eventCounts[0]?.untrusted_names !== 1n || eventCounts[0]?.canonical_name !== null) {
    throw new Error("Iris duplicate processing invariant failed.");
  }

  const deleteEvent = normalizeIrisEvent({
    msg: JSON.stringify({ logId: `target-${suffix}`, hidden: true, byHost: false }), sender: "untrusted-probe-name",
    json: { id: deleteProviderEventId, chat_id: `room-${suffix}`, user_id: `user-${suffix}`, type: 0,
      v: JSON.stringify({ origin: "SYNCDLMSG", isMine: false }) }
  });
  const joinEvent = normalizeIrisEvent({ msg: "입장", sender: "untrusted-probe-name", json: { id: joinProviderEventId, chat_id: `room-${suffix}`, user_id: `user-${suffix}`, type: 0, v: JSON.stringify({ origin: "NEWMEM", isMine: false }) } });
  const departEvent = normalizeIrisEvent({ msg: "퇴장", sender: "untrusted-probe-name", json: { id: departProviderEventId, chat_id: `room-${suffix}`, user_id: `user-${suffix}`, type: 0, v: JSON.stringify({ origin: "DELMEM", isMine: false }) } });
  await processor.execute(deleteEvent);
  await processor.execute(joinEvent);
  await processor.execute(departEvent);
  const blueBotFeatures = await database.query<Array<{ incidents: bigint; target_id: string | null; membership_events: bigint; membership_status: string }>>(
    `SELECT
      (SELECT COUNT(*) FROM moderation_incidents WHERE event_id = ?) AS incidents,
      (SELECT target_provider_event_id FROM moderation_incidents WHERE event_id = ?) AS target_id,
      (SELECT COUNT(*) FROM channel_membership_events WHERE event_id IN (?, ?)) AS membership_events,
      (SELECT membership.status FROM channel_memberships membership JOIN event_inbox inbox
       ON inbox.channel_id = membership.channel_id AND inbox.external_identity_id = membership.external_identity_id
       WHERE inbox.event_id = ?) AS membership_status`,
    [deleteEvent.eventId, deleteEvent.eventId, joinEvent.eventId, departEvent.eventId, departEvent.eventId]
  );
  if (blueBotFeatures[0]?.incidents !== 1n || blueBotFeatures[0]?.target_id !== `target-${suffix}`
    || blueBotFeatures[0]?.membership_events !== 2n || blueBotFeatures[0]?.membership_status !== "inactive") {
    throw new Error("Normalized incident or membership invariant failed.");
  }
  await database.execute("UPDATE outbox_messages SET attempt_count = 9 WHERE id = ?", [first.replies[0]!.outboxId]);
  await recordOutboxDelivery(database, first.replies[0]!.outboxId, { ok: false, errorCode: "PROBE_FAILURE" });
  const deadLetter = await database.query<Array<{ status: string }>>("SELECT status FROM outbox_messages WHERE id = ?", [first.replies[0]!.outboxId]);
  if (deadLetter[0]?.status !== "dead_letter") throw new Error("Outbox dead-letter invariant failed.");

  const server = await database.execute(
    "INSERT INTO game_servers (code, display_name, active, version, created_at, updated_at) VALUES (?, 'probe', TRUE, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
    [`probe-${suffix}`]
  );
  serverId = server.insertId;
  const player = await database.execute("INSERT INTO players (status, version, created_at, updated_at) VALUES ('active', 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))");
  playerId = player.insertId;
  await database.execute(
    "INSERT INTO player_profiles (player_id, current_display_name, game_server_id, version, updated_at) VALUES (?, 'probe', ?, 1, UTC_TIMESTAMP(3))",
    [playerId, serverId]
  );
  const change = new ChangePlayerServerService(database);
  const command = { playerId: playerId.toString(), serverCode: `probe-${suffix}`, expectedVersion: "1", reason: "integration probe", idempotencyKey: `idem-${suffix}`, actorId: "1", sourceCode: "admin_api" as const };
  const changed = await change.execute(command);
  const repeated = await change.execute(command);
  let conflictObserved = false;
  try {
    await change.execute({ ...command, idempotencyKey: `conflict-${suffix}`, expectedVersion: "1" });
  } catch (error) {
    conflictObserved = error instanceof ApplicationError && error.code === "PROFILE_VERSION_CONFLICT";
  }
  const changeCounts = await database.query<Array<{ audits: bigint; outboxes: bigint; version: bigint }>>(
    `SELECT
      (SELECT COUNT(*) FROM command_audit WHERE target_type = 'player' AND target_id = ?) AS audits,
      (SELECT COUNT(*) FROM outbox_messages WHERE provider_code = 'internal' AND destination_id = ?) AS outboxes,
      (SELECT version FROM player_profiles WHERE player_id = ?) AS version`,
    [playerId, playerId.toString(), playerId]
  );
  if (changed.auditId !== repeated.auditId || !conflictObserved || changeCounts[0]?.audits !== 1n || changeCounts[0]?.outboxes !== 1n || changeCounts[0]?.version !== 2n) {
    throw new Error("Server change transaction or idempotency invariant failed.");
  }

  const password = `probe-password-${suffix}`;
  const operator = await database.execute(
    `INSERT INTO admin_operators (login_id, display_name, password_hash, status, created_at, updated_at)
     VALUES (?, 'probe', ?, 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [`probe-${suffix}`, await hash(password)]
  );
  operatorId = operator.insertId;
  await database.execute(
    `INSERT INTO admin_operator_roles (operator_id, role_id)
     SELECT ?, id FROM admin_roles WHERE code = 'super_admin'`,
    [operatorId]
  );
  const auth = new AdminAuthService(database);
  const login = await auth.login(`probe-${suffix}`, password);
  const session = await auth.authenticate(login.sessionToken, login.csrfToken);
  let csrfRejected = false;
  try {
    await auth.authenticate(login.sessionToken, "wrong-csrf");
  } catch (error) {
    csrfRejected = error instanceof ApplicationError && error.code === "CSRF_TOKEN_INVALID";
  }
  await auth.logout(login.sessionToken, login.csrfToken);
  let revoked = false;
  try {
    await auth.authenticate(login.sessionToken);
  } catch (error) {
    revoked = error instanceof ApplicationError && error.code === "ADMIN_SESSION_INVALID";
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try { await auth.login(`probe-${suffix}`, "wrong-password"); } catch { /* expected */ }
  }
  const lockState = await database.query<Array<{ failed_login_count: number; locked_until: Date | string | null }>>(
    "SELECT failed_login_count, locked_until FROM admin_operators WHERE id = ?",
    [operatorId]
  );
  let lockVerified = false;
  try {
    await auth.login(`probe-${suffix}`, password);
  } catch (error) {
    lockVerified = error instanceof ApplicationError && error.code === "ACCOUNT_LOCKED";
  }
  if (session.operatorId !== operatorId.toString() || !csrfRejected || !revoked || !lockVerified) {
    throw new Error(`Admin session invariant failed: csrf=${csrfRejected} revoked=${revoked} locked=${lockVerified} failedCount=${lockState[0]?.failed_login_count} lockedAt=${String(lockState[0]?.locked_until)}`);
  }

  const externalIdentity = await database.execute(
    `INSERT INTO external_identities
      (player_id, provider_code, external_user_id, display_name, status, created_at, updated_at)
     VALUES (?, 'kakao', ?, 'probe-admin', 'linked', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [playerId, `admin-user-${suffix}`]
  );
  externalIdentityId = externalIdentity.insertId;
  await database.execute(
    "INSERT INTO admin_operator_external_identities (operator_id, external_identity_id, created_at) VALUES (?, ?, UTC_TIMESTAMP(3))",
    [operatorId, externalIdentityId]
  );
  await database.execute(
    `INSERT INTO event_inbox
      (event_id, provider_code, provider_event_id, event_kind, direction, payload_hash, parse_status, processing_status, received_at, attempt_count)
     VALUES (?, 'iris', ?, '1', 'incoming', ?, 'parsed', 'processed', UTC_TIMESTAMP(3), 1)`,
    [`iris-admin-${suffix}`, `iris-admin-${suffix}`, "0".repeat(64)]
  );
  const irisAdminResult = await new IrisAdminCommandService(database).changePlayerServer({
    externalUserId: `admin-user-${suffix}`,
    channelId: `admin-room-${suffix}`,
    message: "/서버이동 probe probe",
    eventId: `iris-admin-${suffix}`
  });
  if (!irisAdminResult.data.includes("이동되었습니다") || irisAdminResult.outboxId === "") throw new Error("Iris admin command did not use the server-change service.");

  process.stdout.write(JSON.stringify({ eventDuplicateVerified: true, untrustedNameSeparated: true, activityAggregateVerified: true, incidentCorrelationVerified: true, membershipHistoryVerified: true, outboxDeadLetterVerified: true, serverChangeIdempotencyVerified: true, optimisticConflictVerified: true, adminSessionVerified: true, csrfVerified: true, fiveFailureLockVerified: true, irisAdminServiceVerified: true }) + "\n");
} finally {
  await database.withTransaction(async (transaction) => {
    if (operatorId !== undefined) {
      await transaction.execute("DELETE FROM admin_auth_events WHERE operator_id = ?", [operatorId]);
      await transaction.execute("DELETE FROM admin_operator_permission_overrides WHERE operator_id = ? OR granted_by = ?", [operatorId, operatorId]);
      await transaction.execute("DELETE FROM admin_sessions WHERE operator_id = ?", [operatorId]);
      await transaction.execute("DELETE FROM admin_operator_roles WHERE operator_id = ?", [operatorId]);
      await transaction.execute("DELETE FROM admin_operators WHERE id = ?", [operatorId]);
    }
    if (externalIdentityId !== undefined) {
      await transaction.execute("DELETE FROM external_identities WHERE id = ?", [externalIdentityId]);
    }
    if (playerId !== undefined) {
      const operations = await transaction.query<Array<{ id: bigint }>>("SELECT operation_id AS id FROM command_audit WHERE target_type = 'player' AND target_id = ?", [playerId]);
      for (const operation of operations) {
        await transaction.execute("DELETE FROM outbox_messages WHERE operation_id = ?", [operation.id]);
        await transaction.execute("DELETE FROM command_executions WHERE operation_id = ?", [operation.id]);
        await transaction.execute("DELETE FROM command_audit WHERE operation_id = ?", [operation.id]);
        await transaction.execute("DELETE FROM operations WHERE id = ?", [operation.id]);
      }
      await transaction.execute("DELETE FROM player_profiles WHERE player_id = ?", [playerId]);
      await transaction.execute("DELETE FROM players WHERE id = ?", [playerId]);
    }
    if (serverId !== undefined) await transaction.execute("DELETE FROM game_servers WHERE id = ?", [serverId]);
    await transaction.execute("DELETE FROM event_inbox WHERE event_id = ?", [`iris-admin-${suffix}`]);
    const eventIds = [providerEventId, deleteProviderEventId, joinProviderEventId, departProviderEventId].map((id) => `iris:${id}`);
    const eventId = eventIds[0]!;
    const eventLinks = await transaction.query<Array<{ channel_id: bigint | null; external_identity_id: bigint | null }>>(
      "SELECT channel_id, external_identity_id FROM event_inbox WHERE event_id = ?",
      [eventId]
    );
    const operations = await transaction.query<Array<{ id: bigint }>>("SELECT operation_id AS id FROM command_executions WHERE event_id = ?", [eventId]);
    for (const operation of operations) {
      await transaction.execute("DELETE FROM outbox_messages WHERE operation_id = ?", [operation.id]);
      await transaction.execute("DELETE FROM command_executions WHERE operation_id = ?", [operation.id]);
      await transaction.execute("DELETE FROM operations WHERE id = ?", [operation.id]);
    }
    await transaction.execute("DELETE FROM moderation_incidents WHERE event_id IN (?, ?, ?, ?)", eventIds);
    await transaction.execute("DELETE FROM channel_membership_events WHERE event_id IN (?, ?, ?, ?)", eventIds);
    await transaction.execute("DELETE FROM normalized_provider_events WHERE event_id IN (?, ?, ?, ?)", eventIds);
    const eventChannelId = eventLinks[0]?.channel_id;
    const eventIdentityId = eventLinks[0]?.external_identity_id;
    if (eventChannelId !== null && eventChannelId !== undefined && eventIdentityId !== null && eventIdentityId !== undefined) {
      await transaction.execute("DELETE FROM channel_activity_daily WHERE channel_id = ? AND external_identity_id = ?", [eventChannelId, eventIdentityId]);
    }
    await transaction.execute("DELETE FROM event_inbox WHERE event_id IN (?, ?, ?, ?)", eventIds);
    if (eventChannelId !== null && eventChannelId !== undefined && eventIdentityId !== null && eventIdentityId !== undefined) {
      await transaction.execute("DELETE FROM channel_memberships WHERE channel_id = ? AND external_identity_id = ?", [eventChannelId, eventIdentityId]);
    }
    if (eventIdentityId !== null && eventIdentityId !== undefined) {
      await transaction.execute("DELETE FROM external_identity_names WHERE external_identity_id = ?", [eventIdentityId]);
      await transaction.execute("DELETE FROM external_identities WHERE id = ?", [eventIdentityId]);
    }
    if (eventChannelId !== null && eventChannelId !== undefined) {
      await transaction.execute("DELETE FROM channels WHERE id = ?", [eventChannelId]);
    }
  });
  await database.close();
}
