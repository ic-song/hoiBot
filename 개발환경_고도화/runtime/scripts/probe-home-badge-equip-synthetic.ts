import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { HomeBadgeEquipService } from "../src/home/home-badge-equip-service.js";

const config = loadConfig();
if (!config.database.enabled || !/^hoibot_home_badge_equip(?:_[a-z0-9_]+)?$/i.test(config.database.name)) {
  throw new Error("isolated home badge equip database required");
}
const database = createDatabaseClient(config.database);
try {
  const playerId = 990000130n, externalUserId = `badge-equip-probe-${Date.now()}`, room = "badge-equip-probe";
  await database.execute("INSERT INTO players(id,status) VALUES (?,'active')", [playerId]);
  await database.execute("INSERT INTO player_profiles(player_id,current_display_name,tier_code) VALUES (?,'Probe 장착자','king')", [playerId]);
  await database.execute("INSERT INTO external_identities(id,player_id,provider_code,external_user_id,display_name,status) VALUES (?,?,'kakao',?,?,'linked')", [playerId, playerId, externalUserId, "Probe 장착자"]);
  const version = (await database.query<Array<{ id: bigint }>>("SELECT id FROM home_badge_definition_versions WHERE status='shadow' ORDER BY id DESC LIMIT 1"))[0]!.id;
  const badge = (await database.query<Array<{ badge_code: string }>>("SELECT badge_code FROM home_badge_definitions WHERE definition_version_id=? ORDER BY ordinal LIMIT 1", [version]))[0]!.badge_code;
  await database.execute("INSERT INTO player_badge_assignments(player_id,badge_code,display_value,priority) VALUES (?,?,?,1)", [playerId, badge, badge]);
  await database.execute("INSERT INTO player_home_badges(player_id,badge_code,owned,equipped) VALUES (?,?,TRUE,FALSE)", [playerId, badge]);
  const eventId = `probe-${Date.now()}`;
  await database.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('5',64),'processed',UTC_TIMESTAMP(3))", [eventId, eventId, room, externalUserId]);
  const result = await new HomeBadgeEquipService(database).execute({ eventId, externalUserId, destinationId: room, message: "/홈뱃지장착 1" });
  const replay = await new HomeBadgeEquipService(database).execute({ eventId, externalUserId, destinationId: room, message: "/홈뱃지장착 1" });
  assert.equal(result.badgeCode, badge);
  assert.equal(replay.replayed, true);
  assert.equal((await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM home_badge_equipment_mutations WHERE player_id=?", [playerId]))[0]!.count_value, 1n);
  process.stdout.write(JSON.stringify({ badge, resultCode: result.resultCode, replayed: replay.replayed }) + "\n");
} finally {
  await database.close();
}
