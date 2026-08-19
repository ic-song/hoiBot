import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { PointBoxOpenService } from "../src/inventory/point-box-open-service.js";

const config = loadConfig();
if (!config.database.enabled || !/^hoibot_rehearsal_[a-z0-9_]+$/i.test(config.database.name)) throw new Error("synthetic rehearsal database only");
const playerId = 910000113n; const external = "synthetic-point-box"; const event = `point-box-${randomUUID()}`;
const db = createDatabaseClient(config.database);
async function seed(boxes: bigint, point = "9000000000000000") {
  await db.execute("INSERT INTO currency_definitions (code, display_name, scale_digits, active) VALUES ('point','포인트',0,TRUE) ON DUPLICATE KEY UPDATE active=TRUE");
  await db.execute("INSERT INTO players (id,status,version) VALUES (?, 'active', 1) ON DUPLICATE KEY UPDATE status='active'", [playerId]);
  await db.execute("INSERT INTO player_profiles (player_id,current_display_name,tier_code) VALUES (?, '합성포인트회원','starter') ON DUPLICATE KEY UPDATE current_display_name=VALUES(current_display_name)", [playerId]);
  await db.execute("INSERT INTO external_identities (player_id,provider_code,external_user_id,display_name,status) VALUES (?, 'kakao', ?, '합성포인트회원','linked') ON DUPLICATE KEY UPDATE player_id=VALUES(player_id),status='linked'", [playerId, external]);
  await db.execute("INSERT INTO item_definitions (id,code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES (910000113,'point_box_100m','1억포인트상자🪙','item',TRUE,JSON_OBJECT('synthetic',TRUE),TRUE,1) ON DUPLICATE KEY UPDATE active=TRUE", []);
  await db.execute("INSERT INTO inventory_stacks (player_id,item_id,quantity,version) VALUES (?,910000113,?,1) ON DUPLICATE KEY UPDATE quantity=VALUES(quantity),version=1", [playerId, boxes]);
  await db.execute("INSERT INTO currency_accounts (player_id,currency_code,balance,version) VALUES (?,'point',?,1) ON DUPLICATE KEY UPDATE balance=VALUES(balance),version=1", [playerId, point]);
}
async function seedEvent(eventId: string) { await db.execute("INSERT INTO event_inbox (event_id,event_kind,processing_status,payload_hash,received_at,provider_code,provider_event_id) VALUES (?, 'message', 'completed', SHA2(?,256), UTC_TIMESTAMP(3), 'iris', ?) ON DUPLICATE KEY UPDATE event_id=VALUES(event_id)", [eventId,eventId,eventId]); }
function failCurrency(inner: DatabaseClient): DatabaseClient { return { ping:()=>inner.ping(), verifyRollback:()=>inner.verifyRollback(), query:(q,p)=>inner.query(q,p), execute:(q,p)=>inner.execute(q,p), close:()=>inner.close(), withTransaction:<T>(work:(tx:DatabaseTransaction)=>Promise<T>)=>inner.withTransaction((tx)=>work({query:(q,p)=>tx.query(q,p),execute:(q,p)=>{ if(q.includes("INSERT INTO currency_ledger")) throw new Error("synthetic failpoint"); return tx.execute(q,p); }})) }; }
try {
  await seed(3n); await seedEvent(event); const normal = await new PointBoxOpenService(db).handle({externalUserId:external,channelId:"synthetic-room",message:"/포인트상자오픈 99",eventId:event});
  assert.equal(normal.effectiveOpenCount,"3"); assert.equal(normal.rewardTotal,"300000000");
  await db.close(); const replayDb = createDatabaseClient(config.database); const duplicate = await new PointBoxOpenService(replayDb).handle({externalUserId:external,channelId:"synthetic-room",message:"/포인트상자오픈 99",eventId:event}); assert.equal(duplicate.duplicate,true);
  console.log(JSON.stringify({slice:"SL-INVENTORY-POINT-BOX-OPEN",normal:true,duplicateReplay:true,restartReplay:true})); await replayDb.close();
} finally { await db.close().catch(()=>undefined); }
