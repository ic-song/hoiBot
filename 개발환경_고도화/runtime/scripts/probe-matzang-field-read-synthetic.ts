import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { MariaCommandDispatchRepository } from "../src/dispatch/command-dispatcher.js";
import { MatzangCommandService } from "../src/battle/matzang-command-service.js";

const config = loadConfig();
if (!config.database.enabled || !/^(hoibot_matzang_field_read_g7)$/i.test(config.database.name)) throw new Error(`Blocked database: ${config.database.name}`);
const database = createDatabaseClient(config.database);
const restart = process.argv.includes("--verify-restart");
const base = process.env.MATZZANG_FIELD_READ_EVENT_ID ?? `matzang-field-read-${randomUUID()}`;
const room = "synthetic-field-read-room", visible = 972000001n, completed = 972000002n, inactive = 972000003n;
if (restart && process.env.MATZZANG_FIELD_READ_EVENT_ID === undefined) throw new Error("MATZZANG_FIELD_READ_EVENT_ID is required");

try {
  await database.execute("INSERT IGNORE INTO players(id,status) VALUES (?,'active'),(?,'active'),(?,'active')", [visible, completed, inactive]);
  await database.execute("UPDATE matzang_fields SET active=TRUE,resting=FALSE,max_count=10 WHERE field_key='current'");
  await database.execute(`INSERT INTO matzang_participants(field_key,player_id,display_name,active,eliminated,match_count,pt,total_exp,version) VALUES
    ('current',?,'합성알파',TRUE,FALSE,1,3,100,1),('current',?,'합성완료',TRUE,TRUE,10,20,90,1),('current',?,'합성비활성',FALSE,FALSE,0,0,80,1)
    ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),active=VALUES(active),eliminated=VALUES(eliminated),match_count=VALUES(match_count),pt=VALUES(pt)`, [visible, completed, inactive]);
  const events = [`${base}-list`, `${base}-inactive`, `${base}-empty`, `${base}-rollback`];
  for (const eventId of events) await database.execute("INSERT IGNORE INTO event_inbox(event_id,event_kind,processing_status,received_at,provider_code,provider_event_id,external_channel_id,external_user_id,event_origin,direction,payload_hash,parse_status) VALUES (?,'message','processed',UTC_TIMESTAMP(3),'iris',?,?,?,'kakao','incoming',SHA2(?,256),'parsed')", [eventId, eventId, room, visible.toString(), eventId]);
  const dispatch = new MariaCommandDispatchRepository(database), definition = await dispatch.findExact("/맞짱필드목록");
  assert.equal(definition?.handlerKey, "matzang_field_list"); assert.equal(definition?.rolloutState, "SHADOW"); assert.equal(await dispatch.findExact("/맞짱필드목록 안내"), undefined);
  const service = new MatzangCommandService(database), eventId = `${base}-list`;
  if (!restart) {
    const listed = await service.handle({ eventId, destinationId: room, playerId: visible.toString(), message: "/맞짱필드목록" });
    assert.equal(listed.status, "field_list"); assert.match(listed.data, /현재 참여자 1명/); assert.match(listed.data, /합성알파/); assert.doesNotMatch(listed.data, /합성완료|합성비활성/);
    const replay = await service.handle({ eventId, destinationId: room, playerId: visible.toString(), message: "/맞짱필드목록" }); assert.equal(replay.outboxId, listed.outboxId);
    await database.execute("UPDATE matzang_fields SET active=FALSE WHERE field_key='current'");
    const closed = await service.handle({ eventId: `${base}-inactive`, destinationId: "another-room", playerId: visible.toString(), message: "/맞짱필드목록" }); assert.equal(closed.status, "inactive");
    await database.execute("UPDATE matzang_fields SET active=TRUE WHERE field_key='current'"); await database.execute("UPDATE matzang_participants SET active=FALSE WHERE field_key='current'");
    const empty = await service.handle({ eventId: `${base}-empty`, destinationId: "another-room", playerId: visible.toString(), message: "/맞짱필드목록" }); assert.equal(empty.status, "field_list"); assert.match(empty.data, /참여자가 없습니다/);
    await database.execute("CREATE TRIGGER probe_matzang_field_read_outbox_fail BEFORE INSERT ON outbox_messages FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic outbox failure'");
    await assert.rejects(service.handle({ eventId: `${base}-rollback`, destinationId: room, playerId: visible.toString(), message: "/맞짱필드목록" }), /synthetic outbox failure/);
    await database.execute("DROP TRIGGER probe_matzang_field_read_outbox_fail");
    const rolledBack = await database.query<Array<{ total: bigint }>>("SELECT COUNT(*) total FROM operations WHERE idempotency_scope='matzang.command.field_list' AND idempotency_key=?", [`${base}-rollback`]); assert.equal(rolledBack[0]!.total, 0n);
  } else {
    const replay = await service.handle({ eventId, destinationId: room, playerId: visible.toString(), message: "/맞짱필드목록" }); assert.equal(replay.status, "field_list"); assert.match(replay.data, /합성알파/);
  }
  const effects = (await database.query<Array<{ operations: bigint; executions: bigint; outbox: bigint; audits: bigint }>>("SELECT (SELECT COUNT(*) FROM operations WHERE idempotency_scope='matzang.command.field_list' AND idempotency_key LIKE ?) operations,(SELECT COUNT(*) FROM command_executions WHERE event_id LIKE ?) executions,(SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_scope='matzang.command.field_list' AND operation_row.idempotency_key LIKE ?) outbox,(SELECT COUNT(*) FROM command_audit audit JOIN operations operation_row ON operation_row.id=audit.operation_id WHERE operation_row.idempotency_scope='matzang.command.field_list' AND operation_row.idempotency_key LIKE ?) audits", [`${base}%`, `${base}%`, `${base}%`, `${base}%`]))[0]!;
  process.stdout.write(`${JSON.stringify({ mode: restart ? "verify-restart" : "probe", scenarios: ["exact-dispatch", "shadow", "active-filter", "inactive", "empty", "replay", "rollback", "restart"], effects: { operations: effects.operations.toString(), executions: effects.executions.toString(), outbox: effects.outbox.toString(), audits: effects.audits.toString() }, operationalDataTouched: false })}\n`);
} finally { await database.close(); }
