import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";

const config = loadConfig(); const database = createDatabaseClient(config.database);
const verifyRestart = process.argv.includes("--verify-restart");
const baseEventId = process.env.ADMIN_DAILY_PAYOUT_SHADOW_EVENT_ID ?? `admin-daily-shadow-${randomUUID().replaceAll("-","").slice(0,10)}`;
if (verifyRestart && process.env.ADMIN_DAILY_PAYOUT_SHADOW_EVENT_ID === undefined) throw new Error("ADMIN_DAILY_PAYOUT_SHADOW_EVENT_ID is required with --verify-restart.");
const replies: string[] = [];
const app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply) => { replies.push(reply.data); } });

// 실제 Iris endpoint로 합성 관리자 명령을 전송합니다.
async function dispatch(providerEventId: string, message = "/관리자일당", userId = "synthetic-admin-alpha") { return app.inject({ method: "POST", url: "/api/v1/integrations/iris/events", headers: { authorization: `Bearer ${config.irisSharedToken}` }, payload: { msg: message, room: "합성 관리자일당 Shadow 방", sender: "호이 남", json: { id: providerEventId, chat_id: "synthetic-room-001", user_id: userId, type: 1 } } }); }

try {
  const normalEvent = `${baseEventId}-normal`;
  if (!verifyRestart) {
    await database.execute("INSERT INTO admin_operators (login_id,display_name,password_hash,status) VALUES ('daily-payout-alpha','호이 남',REPEAT('a',64),'active'),('daily-payout-beta','오픈채팅봇',REPEAT('b',64),'active') ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),status='active'");
    await database.execute(`INSERT IGNORE INTO admin_operator_external_identities (operator_id,external_identity_id) SELECT operator.id,identity.id FROM admin_operators operator JOIN external_identities identity ON (operator.login_id='daily-payout-alpha' AND identity.external_user_id='synthetic-admin-alpha') OR (operator.login_id='daily-payout-beta' AND identity.external_user_id='synthetic-user-beta')`);
    await database.execute(`INSERT INTO admin_daily_payout_operators (operator_id,legacy_display_name,active) SELECT mapping.operator_id,'호이 남',TRUE FROM admin_operator_external_identities mapping JOIN external_identities identity ON identity.id=mapping.external_identity_id WHERE identity.external_user_id='synthetic-admin-alpha' ON DUPLICATE KEY UPDATE active=TRUE`);
    const normal = await dispatch(normalEvent); assert.equal(normal.statusCode,202); assert.match(replies.at(-1)??"",/관리자 2명에게 10억/);
    const duplicate = await dispatch(normalEvent); assert.equal(duplicate.json().duplicate,true); assert.equal(replies.length,1);
    const suffix = await dispatch(`${baseEventId}-suffix`,"/관리자일당 1"); assert.equal(suffix.statusCode,202); assert.equal(replies.length,1);
    const denied = await dispatch(`${baseEventId}-denied`,"/관리자일당","synthetic-unlinked"); assert.equal(denied.statusCode,202); assert.equal(replies.length,1);
  } else {
    const replay = await dispatch(normalEvent); assert.equal(replay.json().duplicate,true); assert.equal(replies.length,0);
  }
  const key=`iris:${normalEvent}`;
  const effects=await database.query<Array<{operations:bigint;executions:bigint;payouts:bigint;grants:bigint;ledgers:bigint;audits:bigint;outbox:bigint;deliveries:bigint}>>(`SELECT
    (SELECT COUNT(*) FROM operations WHERE idempotency_key=?) AS operations,
    (SELECT COUNT(*) FROM command_executions WHERE event_id=? AND command_code='admin_daily_payout') AS executions,
    (SELECT COUNT(*) FROM admin_daily_payout_executions execution JOIN operations operation_row ON operation_row.id=execution.operation_id WHERE operation_row.idempotency_key=?) AS payouts,
    (SELECT COUNT(*) FROM admin_daily_payout_grants grant_row JOIN admin_daily_payout_executions execution ON execution.id=grant_row.execution_id JOIN operations operation_row ON operation_row.id=execution.operation_id WHERE operation_row.idempotency_key=?) AS grants,
    (SELECT COUNT(*) FROM currency_ledger ledger JOIN operations operation_row ON operation_row.id=ledger.operation_id WHERE operation_row.idempotency_key=?) AS ledgers,
    (SELECT COUNT(*) FROM command_audit audit JOIN operations operation_row ON operation_row.id=audit.operation_id WHERE operation_row.idempotency_key=?) AS audits,
    (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_key=?) AS outbox,
    (SELECT COUNT(*) FROM delivery_attempts delivery JOIN outbox_messages outbox ON outbox.id=delivery.outbox_message_id JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_key=?) AS deliveries`,[key,key,key,key,key,key,key,key]);
  assert.deepEqual(effects[0],{operations:1n,executions:1n,payouts:1n,grants:2n,ledgers:2n,audits:1n,outbox:1n,deliveries:1n});
  process.stdout.write(`${JSON.stringify({mode:verifyRestart?"verify-restart":"shadow",baseEventId,effects:effects[0],operationalSnapshotTouched:false},(_key,value)=>typeof value==="bigint"?value.toString():value)}\n`);
} finally { await app.close(); }
