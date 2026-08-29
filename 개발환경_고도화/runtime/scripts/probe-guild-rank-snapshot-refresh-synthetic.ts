import assert from "node:assert/strict";
import { createDatabaseClient } from "../src/database.js";
import { GuildRankSnapshotRefreshService } from "../src/guild/guild-rank-snapshot-refresh-service.js";

const required = (name: string): string => { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; };
const databaseName = required("DATABASE_NAME");
if (!/^hoibot_guild_rank_snapshot_g7(?:_[a-z0-9_]+)?$/i.test(databaseName)) throw new Error("isolated guild-rank-snapshot database is required");
const db = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: process.env.DATABASE_PASSWORD ?? "", name: databaseName, connectionLimit: 8, connectTimeoutMs: 5_000 });
const room = "990000000000354", normalEvent = "guild-rank-snapshot-normal", verify = process.argv.includes("--verify-restart");
const service = new GuildRankSnapshotRefreshService(db);

async function event(eventId: string, externalUserId: string): Promise<void> { await db.execute("INSERT IGNORE INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('4',64),'processed',UTC_TIMESTAMP(3))", [eventId, eventId, room, externalUserId]); }
async function fixture(index: number, guildName: string, guildLevel: number, petExperience: number): Promise<{ externalId: string }> {
  const guildId = 354000n + BigInt(index), playerId = 355000n + BigInt(index), externalId = `guild-rank-user-${index}`;
  await db.execute("INSERT INTO guilds(id,code,display_name,status,mark,level,version) VALUES (?,?,?,'active','R',?,1)", [guildId, `GUILD-RANK-${index}`, guildName, guildLevel]);
  await db.execute("INSERT INTO guild_profile_details(guild_id,level_value) VALUES (?,?)", [guildId, guildLevel]);
  await db.execute("INSERT INTO players(id,status,version) VALUES (?,'active',1)", [playerId]);
  await db.execute("INSERT INTO player_profiles(player_id,current_display_name,experience,level,version) VALUES (?,?,0,1,1)", [playerId, `합성회원${index}`]);
  await db.execute("INSERT INTO player_pets(player_id,display_name,experience,enhancement_level,version) VALUES (?,?,?,0,1)", [playerId, `합성펫${index}`, petExperience]);
  await db.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,?,'linked')", [playerId, externalId, `합성회원${index}`]);
  await db.execute("INSERT INTO guild_members(guild_id,player_id,role_code,joined_at) VALUES (?,?,'member',UTC_TIMESTAMP(3))", [guildId, playerId]);
  return { externalId };
}
async function state(): Promise<Record<string, string>> {
  const one = async (sql: string) => (await db.query<Array<{ count_value: bigint }>>(sql))[0]!.count_value.toString();
  return { snapshots: await one("SELECT COUNT(*) count_value FROM guild_rank_snapshots"), rows: await one("SELECT COUNT(*) count_value FROM guild_rank_snapshot_rows"), inputs: await one("SELECT COUNT(*) count_value FROM guild_rank_snapshot_inputs"), runs: await one("SELECT COUNT(*) count_value FROM guild_rank_snapshot_refresh_runs"), audits: await one("SELECT COUNT(*) count_value FROM command_audit WHERE action_code='guild.rank.snapshot.refresh'"), outboxes: await one("SELECT COUNT(*) count_value FROM outbox_messages WHERE operation_id IN (SELECT operation_id FROM guild_rank_snapshot_refresh_runs)") };
}

try {
  if (!verify) {
    const viewer = await fixture(1, "나길드", 9, 100); await fixture(2, "가길드", 9, 100); await fixture(3, "다길드", 8, 100);
    assert.deepEqual(await service.handleIris({ eventId: "guild-rank-shadow", externalUserId: viewer.externalId, channelId: room, message: "/길드순위" }), { status: "shadow" });
    assert.deepEqual(await state(), { snapshots: "0", rows: "0", inputs: "0", runs: "0", audits: "0", outboxes: "0" });
    await db.execute("INSERT INTO guild_rank_title_definitions(definition_version,title_code,display_name,minimum_rank,maximum_rank,active) VALUES (1,'rank-1','최상위',1,1,TRUE),(1,'rank-rest','일반',2,NULL,TRUE)");
    await db.execute("UPDATE guild_rank_snapshot_policies SET title_definition_version=1,enabled=TRUE WHERE policy_key='default'");
    await db.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=TRUE WHERE command_code='GUILD_RANK_SNAPSHOT_REFRESH'");
    await event(normalEvent, viewer.externalId);
    const result = await service.handleIris({ eventId: normalEvent, externalUserId: viewer.externalId, channelId: room, message: "/길드순위" });
    assert.equal(result?.status, "published"); if (result?.status !== "published") throw new Error("published result required");
    assert.equal(result.rowCount, 3); assert.equal(result.memberCount, 3); assert.ok(result.data.includes("1위 최상위 가길드"));
    const replay = await service.handleIris({ eventId: normalEvent, externalUserId: viewer.externalId, channelId: room, message: "/길드순위" }); assert.deepEqual(replay, result);
    await event("guild-rank-rollback", viewer.externalId);
    await db.execute("CREATE TRIGGER fail_guild_rank_audit BEFORE INSERT ON command_audit FOR EACH ROW BEGIN IF NEW.action_code='guild.rank.snapshot.refresh' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forced guild rank audit failure'; END IF; END");
    try { await assert.rejects(() => service.handleIris({ eventId: "guild-rank-rollback", externalUserId: viewer.externalId, channelId: room, message: "/길드순위" }), /forced guild rank audit failure/); } finally { await db.execute("DROP TRIGGER IF EXISTS fail_guild_rank_audit"); }
    assert.deepEqual(await state(), { snapshots: "1", rows: "3", inputs: "3", runs: "1", audits: "1", outboxes: "1" });
    const retry = await service.handleIris({ eventId: "guild-rank-rollback", externalUserId: viewer.externalId, channelId: room, message: "/길드순위" }); assert.equal(retry?.status, "published");
    console.log(JSON.stringify({ mode: "probe", migration: "354_guild_rank_snapshot_refresh.sql", scenarios: ["shadow-mutation-zero", "exact-command", "consistent-input", "charm-level-ko-name-order", "versioned-title", "immutable-snapshot", "duplicate-replay", "forced-rollback", "retry"], result, state: await state(), operationalDataTouched: false }));
  } else {
    const replay = await service.handleIris({ eventId: normalEvent, externalUserId: "guild-rank-user-1", channelId: room, message: "/길드순위" }); assert.equal(replay?.status, "published");
    assert.deepEqual(await state(), { snapshots: "2", rows: "6", inputs: "6", runs: "2", audits: "2", outboxes: "2" });
    console.log(JSON.stringify({ mode: "verify-restart", replay, state: await state(), additionalMutation: false, operationalDataTouched: false }));
  }
} finally { await db.close(); }
