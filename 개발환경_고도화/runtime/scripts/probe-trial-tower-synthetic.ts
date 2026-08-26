import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { TrialTowerProvider } from "../src/trial/trial-tower-provider.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_trial_tower(?:_[a-z0-9_]+)?$/i.test(config.database.name)) throw new Error(`Synthetic trial tower probe blocked: ${config.database.name}`);
const db = createDatabaseClient(config.database), eventId = process.env.TRIAL_TOWER_EVENT_ID ?? "trial-tower-g7-r1";
try {
  const player = await db.execute("INSERT INTO players(status) VALUES ('active')");
  await db.execute("INSERT INTO player_pets(player_id,display_name,pet_type_code,experience,enhancement_level) VALUES (?,'합성펫','sky',0,100)", [player.insertId]);
  await db.execute("INSERT INTO currency_accounts(player_id,currency_code,balance) VALUES (?,'point',100000000)", [player.insertId]);
  const item = (await db.query<Array<{ id: bigint }>>("SELECT id FROM item_definitions WHERE code='trial_booster'"))[0]!;
  await db.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity) VALUES (?,?,2)", [player.insertId, item.id]);
  await db.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,'synthetic-trial-room',?,'message','incoming',REPEAT('7',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)", [eventId, eventId, `synthetic-trial-user-${player.insertId.toString()}`]);
  const samples = [0, 0, .9, .9, 0, 0];
  const provider = new TrialTowerProvider(db, () => samples.shift() ?? 0);
  const input = { eventId, destinationId: "synthetic-trial-room", playerId: player.insertId.toString(), recordDate: "2026-08-27", profile: { charm: 10000, petType: "하늘", upgrade: 100, skills: ["구원", "탑 숭배자"] } };
  const first = await provider.attempt(input), replay = await provider.attempt(input);
  assert.equal(first.status, "win"); assert.deepEqual(replay, first);
  const counts = (await db.query<Array<{ operations: bigint; attempts: bigint; rng: bigint; outboxes: bigint; audits: bigint; executions: bigint }>>(`SELECT (SELECT COUNT(*) FROM operations WHERE idempotency_scope='trial.tower.attempt' AND idempotency_key=?) operations,(SELECT COUNT(*) FROM trial_tower_attempts WHERE operation_id=(SELECT id FROM operations WHERE idempotency_scope='trial.tower.attempt' AND idempotency_key=?)) attempts,(SELECT COUNT(*) FROM trial_tower_rng_samples WHERE operation_id=(SELECT id FROM operations WHERE idempotency_scope='trial.tower.attempt' AND idempotency_key=?)) rng,(SELECT COUNT(*) FROM outbox_messages WHERE operation_id=(SELECT id FROM operations WHERE idempotency_scope='trial.tower.attempt' AND idempotency_key=?)) outboxes,(SELECT COUNT(*) FROM command_audit WHERE operation_id=(SELECT id FROM operations WHERE idempotency_scope='trial.tower.attempt' AND idempotency_key=?)) audits,(SELECT COUNT(*) FROM command_executions WHERE operation_id=(SELECT id FROM operations WHERE idempotency_scope='trial.tower.attempt' AND idempotency_key=?)) executions`, [eventId,eventId,eventId,eventId,eventId,eventId]))[0]!;
  assert.deepEqual(Object.values(counts).map(Number), [1,1,6,1,1,1]);
  assert.equal(await db.verifyRollback(), true);
  console.log(JSON.stringify({ status: first.status, floor: first.floor, counts, rollback: true }, (_key, value) => typeof value === "bigint" ? value.toString() : value));
} finally { await db.close(); }
