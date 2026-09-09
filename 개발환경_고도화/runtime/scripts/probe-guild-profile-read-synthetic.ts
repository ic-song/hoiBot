import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { GuildProfileReadService } from "../src/guild/guild-profile-read-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_guild_profile(?:_[a-z0-9_]+)?$/i.test(config.database.name)) throw new Error(`Synthetic guild profile probe blocked: ${config.database.name}`);
const db = createDatabaseClient(config.database), restart = process.argv.includes("--verify-restart"), room = "synthetic-guild-profile-room", user = "synthetic-guild-profile-member", eventId = process.env.GUILD_PROFILE_PROBE_EVENT_ID ?? "guild-profile-g7-20260828-r1";
try {
  const service = new GuildProfileReadService(db);
  if (!restart) {
    await db.execute("INSERT INTO players(id,status) VALUES (986000001,'active'),(986000002,'active')");
    await db.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (986000001,'합성길드장'),(986000002,'합성길드원')");
    await db.execute("INSERT INTO external_identities(id,provider_code,external_user_id,player_id,status) VALUES (986100001,'kakao',?,986000001,'linked')", [user]);
    await db.execute("INSERT INTO guilds(id,code,display_name,status,version) VALUES (986200001,'SYNTHETIC-PROFILE','합성 프로필 길드','active',1)");
    await db.execute("INSERT INTO guild_members(guild_id,player_id,role_code,joined_at) VALUES (986200001,986000001,'master','2026-01-01'),(986200001,986000002,'member','2026-01-02')");
    await db.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('e',64),'processed',UTC_TIMESTAMP(3))", [eventId, eventId, room, user]);
    const result = await service.handle({ eventId, externalUserId: user, destinationId: room, message: "/길드정보" });
    assert.equal(result?.status, "detail"); assert.equal(result?.memberCount, 2); assert.equal(result?.repairCount, 5);
    assert.deepEqual(await service.handle({ eventId, externalUserId: user, destinationId: room, message: "ㄱㄱㄱ" }), result);
    process.stdout.write(JSON.stringify({ mode: "probe", migrationCount: 274, commands: 2, repairCount: result.repairCount, replayPreserved: true, operationalDataTouched: false }) + "\n");
  } else {
    const before = (await db.query<Array<{ value: bigint }>>("SELECT COUNT(*) value FROM operations WHERE idempotency_scope IN ('guild.profile.repair','guild.profile.read')"))[0]!.value;
    const result = await service.handle({ eventId, externalUserId: user, destinationId: room, message: "ㄱㄱㄱ" });
    const after = (await db.query<Array<{ value: bigint }>>("SELECT COUNT(*) value FROM operations WHERE idempotency_scope IN ('guild.profile.repair','guild.profile.read')"))[0]!.value;
    assert.equal(result?.status, "detail"); assert.equal(after, before);
    process.stdout.write(JSON.stringify({ mode: "verify-restart", operations: Number(after), additionalMutation: false, operationalDataTouched: false }) + "\n");
  }
} finally { await db.close(); }
