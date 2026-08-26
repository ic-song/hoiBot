import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { MariaCommandDispatchRepository } from "../src/dispatch/command-dispatcher.js";
import { MatzangParticipantJoinService } from "../src/battle/matzang-participant-join-service.js";

const config = loadConfig();
if (!config.database.enabled || config.database.name !== "hoibot_matzang_participant_join_g7") throw new Error(`Blocked database: ${config.database.name}`);
const db = createDatabaseClient(config.database);
const restart = process.argv.includes("--verify-restart");
const base = process.env.MATZZANG_PARTICIPANT_JOIN_EVENT_ID ?? "matzang-participant-join-fixed";
const room = "synthetic-matzang-room";
const player = 992000001n;
const failedPlayer = 992000002n;
const snapshot = { displayName: "합성참가자", totalExp: 123456, petType: "하늘", upgradeLevel: 7 };

async function event(eventId: string, actor: bigint): Promise<void> {
  await db.execute("INSERT IGNORE INTO event_inbox(event_id,event_kind,processing_status,received_at,provider_code,provider_event_id,external_channel_id,external_user_id,event_origin,direction,payload_hash,parse_status) VALUES (?,'message','processed',UTC_TIMESTAMP(3),'iris',?,?,?,'kakao','incoming',SHA2(?,256),'parsed')", [eventId, eventId, room, actor.toString(), eventId]);
}

try {
  await db.execute("INSERT IGNORE INTO players(id,status,version) VALUES (?,'active',1),(?,'active',1)", [player, failedPlayer]);
  await db.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,'합성참가자',1),(?,'롤백참가자',1) ON DUPLICATE KEY UPDATE current_display_name=VALUES(current_display_name)", [player, failedPlayer]);
  await db.execute("INSERT INTO matzang_room_scopes(destination_id,active) VALUES (?,TRUE) ON DUPLICATE KEY UPDATE active=TRUE", [room]);
  await db.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='MATZZANG_PARTICIPANT_JOIN'");
  for (const suffix of ["inactive", "join", "duplicate", "rejoin", "complete"]) await event(`${base}-${suffix}`, player);
  await event(`${base}-failed`, failedPlayer);
  const dispatch = new MariaCommandDispatchRepository(db);
  assert.equal((await dispatch.findExact("/참여"))?.handlerKey, "matzang_participant_join");
  assert.equal((await dispatch.findExact("ㅊㅇ"))?.commandCode, "MATZZANG_PARTICIPANT_JOIN");
  assert.equal(await dispatch.findExact("/참여 1"), undefined);
  const service = new MatzangParticipantJoinService(db);

  if (!restart) {
    await db.execute("DELETE FROM matzang_participants WHERE field_key='current' AND player_id IN (?,?)", [player, failedPlayer]);
    await db.execute("UPDATE matzang_fields SET active=FALSE,resting=FALSE,max_count=10 WHERE field_key='current'");
    const inactive = await service.handle({ eventId: `${base}-inactive`, destinationId: room, playerId: player.toString(), message: "/참여", snapshot });
    assert.equal(inactive.status, "inactive");
    assert.equal((await db.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM matzang_participants WHERE player_id=?", [player]))[0]?.count, 0n);

    await db.execute("UPDATE matzang_fields SET active=TRUE,resting=FALSE WHERE field_key='current'");
    const joined = await service.handle({ eventId: `${base}-join`, destinationId: room, playerId: player.toString(), message: "/참여", snapshot });
    assert.equal(joined.status, "joined");
    assert.equal(joined.mutated, true);
    assert.match("data" in joined ? joined.data : "", /입장 완료/);
    const replay = await service.handle({ eventId: `${base}-join`, destinationId: room, playerId: player.toString(), message: "ㅊㅇ", snapshot });
    assert.deepEqual(replay, joined);

    const duplicate = await service.handle({ eventId: `${base}-duplicate`, destinationId: room, playerId: player.toString(), message: "ㅊㅇ", snapshot });
    assert.equal(duplicate.status, "already_joined");
    await db.execute("UPDATE matzang_fields SET resting=TRUE WHERE field_key='current'");
    await db.execute("UPDATE matzang_participants SET active=FALSE,eliminated=TRUE WHERE field_key='current' AND player_id=?", [player]);
    const rejoined = await service.handle({ eventId: `${base}-rejoin`, destinationId: room, playerId: player.toString(), message: "/참여", snapshot: { ...snapshot, totalExp: 222222 } });
    assert.equal(rejoined.status, "joined");
    assert.match("data" in rejoined ? rejoined.data : "", /휴식 시간/);
    const persisted = (await db.query<Array<{ active: number; eliminated: number; total_exp: bigint; match_count: number }>>("SELECT active,eliminated,total_exp,match_count FROM matzang_participants WHERE field_key='current' AND player_id=?", [player]))[0]!;
    assert.deepEqual([persisted.active, persisted.eliminated, persisted.total_exp, persisted.match_count], [1, 0, 222222n, 0]);

    await db.execute("UPDATE matzang_participants SET active=FALSE,match_count=10 WHERE field_key='current' AND player_id=?", [player]);
    const complete = await service.handle({ eventId: `${base}-complete`, destinationId: room, playerId: player.toString(), message: "/참여", snapshot });
    assert.equal(complete.status, "complete");

    await db.execute("DROP TRIGGER IF EXISTS synthetic_matzang_join_rollback");
    await db.execute(`CREATE TRIGGER synthetic_matzang_join_rollback BEFORE INSERT ON matzang_participant_join_events FOR EACH ROW
      BEGIN IF NEW.player_id=${failedPlayer.toString()} THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic join rollback'; END IF; END`);
    await assert.rejects(() => service.handle({ eventId: `${base}-failed`, destinationId: room, playerId: failedPlayer.toString(), message: "/참여", snapshot: { ...snapshot, displayName: "롤백참가자" } }), /synthetic join rollback/);
    await db.execute("DROP TRIGGER synthetic_matzang_join_rollback");
    const rolledBack = (await db.query<Array<{ operations: bigint; participants: bigint }>>("SELECT (SELECT COUNT(*) FROM operations WHERE idempotency_scope='matzang.participant.join' AND idempotency_key=?) operations,(SELECT COUNT(*) FROM matzang_participants WHERE player_id=?) participants", [`${base}-failed`, failedPlayer]))[0]!;
    assert.deepEqual([rolledBack.operations, rolledBack.participants], [0n, 0n]);
  } else {
    const replay = await service.handle({ eventId: `${base}-join`, destinationId: room, playerId: player.toString(), message: "/참여", snapshot });
    assert.equal(replay.status, "joined");
  }

  const effects = (await db.query<Array<{ operations: bigint; joinEvents: bigint; outboxes: bigint; audits: bigint; executions: bigint }>>(
    "SELECT (SELECT COUNT(*) FROM operations WHERE idempotency_scope='matzang.participant.join' AND idempotency_key LIKE ?) operations,(SELECT COUNT(*) FROM matzang_participant_join_events event_row JOIN operations operation_row ON operation_row.id=event_row.operation_id WHERE operation_row.idempotency_key LIKE ?) joinEvents,(SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_key LIKE ?) outboxes,(SELECT COUNT(*) FROM command_audit audit JOIN operations operation_row ON operation_row.id=audit.operation_id WHERE operation_row.idempotency_key LIKE ?) audits,(SELECT COUNT(*) FROM command_executions WHERE event_id LIKE ?) executions",
    [`${base}%`, `${base}%`, `${base}%`, `${base}%`, `${base}%`]
  ))[0]!;
  assert.deepEqual([effects.operations, effects.joinEvents, effects.outboxes, effects.audits, effects.executions], [5n, 5n, 5n, 5n, 5n]);
  process.stdout.write(`${JSON.stringify({ mode: restart ? "verify-restart" : "probe", scenarios: ["exact-alias", "inactive", "join", "replay", "duplicate", "rest-rejoin", "complete", "rollback", "restart"], effects: { operations: effects.operations.toString(), joinEvents: effects.joinEvents.toString(), outboxes: effects.outboxes.toString(), audits: effects.audits.toString(), executions: effects.executions.toString() }, operationalDataTouched: false })}\n`);
} finally {
  await db.execute("DROP TRIGGER IF EXISTS synthetic_matzang_join_rollback").catch(() => undefined);
  await db.close();
}
