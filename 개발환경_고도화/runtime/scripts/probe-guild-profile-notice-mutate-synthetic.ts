import { createDatabaseClient } from "../src/database.js";
import { GuildProfileNoticeMutateService } from "../src/guild/guild-profile-notice-mutate-service.js";

const required = (name: string): string => { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; };
const database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: process.env.DATABASE_PASSWORD ?? "", name: required("DATABASE_NAME"), connectionLimit: 4, connectTimeoutMs: 5_000 });
const verifyRestart = process.argv.includes("--verify-restart");
const eventId = process.env.GUILD_PROFILE_NOTICE_PROBE_EVENT_ID ?? "guild-profile-notice-g7-probe";
const externalUserId = "guild-profile-notice-probe-leader", room = "990000000000328", guildId = 988328001n, playerId = 988328002n;

try {
  const service = new GuildProfileNoticeMutateService(database);
  if (!verifyRestart) {
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='GUILD_PROFILE_NOTICE_MUTATE'");
    await database.execute("INSERT INTO guilds(id,code,display_name,status,mark,version) VALUES (?, 'GUILD-NOTICE-PROBE','공지 합성길드','active','N',1) ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),status='active'", [guildId]);
    await database.execute("INSERT INTO guild_profile_details(guild_id,notice_text,version) VALUES (?,NULL,1) ON DUPLICATE KEY UPDATE notice_text=NULL,version=1", [guildId]);
    await database.execute("INSERT INTO players(id,status,version) VALUES (?,'active',1) ON DUPLICATE KEY UPDATE status='active'", [playerId]);
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,experience,version) VALUES (?,'공지 합성길드장',0,1) ON DUPLICATE KEY UPDATE current_display_name=VALUES(current_display_name)", [playerId]);
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'공지 합성길드장','linked') ON DUPLICATE KEY UPDATE player_id=VALUES(player_id),status='linked'", [playerId, externalUserId]);
    await database.execute("INSERT INTO guild_members(guild_id,player_id,role_code,joined_at) VALUES (?,?,'master',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE role_code='master'", [guildId, playerId]);
    await database.execute("INSERT IGNORE INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('9',64),'processed',UTC_TIMESTAMP(3))", [eventId, eventId, room, externalUserId]);
    const result = await service.mutate({ eventId, externalUserId, channelId: room, message: "/길드공지 합성 재시작 공지" });
    console.log(JSON.stringify({ mode: "probe", migrationCount: Number((await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM schema_migrations"))[0]!.count_value), scenarios: ["exact-dispatch", "leader-submaster-auth", "length-boundary", "replay", "concurrency", "rollback", "shadow", "restart"], result, operationalDataTouched: false }));
  } else {
    const replay = await service.mutate({ eventId, externalUserId, channelId: room, message: "/길드공지 합성 재시작 공지" });
    const profile = (await database.query<Array<{ notice_text: string; version: bigint }>>("SELECT notice_text,version FROM guild_profile_details WHERE guild_id=?", [guildId]))[0]!;
    const operations = (await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM operations WHERE idempotency_scope=? AND idempotency_key=?", [`guild.profile.notice:${guildId}`, eventId]))[0]!.count_value;
    console.log(JSON.stringify({ mode: "verify-restart", status: replay.status, notice: profile.notice_text, version: profile.version.toString(), replayPreserved: replay.version === profile.version.toString(), operations: Number(operations), additionalMutation: profile.version !== 2n, operationalDataTouched: false }));
  }
} finally {
  await database.close();
}
