import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { IrisAdminCommandService } from "../src/admin/iris-admin-command-service.js";
import { GuildProfileNoticeMutateService } from "../src/guild/guild-profile-notice-mutate-service.js";

const enabled = process.env.RUN_MARIADB_INTEGRATION === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("guild profile notice mutation MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient; let guildId = "";
  const room = "990000000000328", leader = "guild-notice-leader", submaster = "guild-notice-submaster", member = "guild-notice-member";
  const prefix = `guild-notice-${Date.now()}`;

  async function event(id: string, externalUserId: string): Promise<void> {
    await database.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('8',64),'processed',UTC_TIMESTAMP(3))", [id, id, room, externalUserId]);
  }
  async function profile(): Promise<{ notice_text: string | null; version: bigint }> {
    return (await database.query<Array<{ notice_text: string | null; version: bigint }>>("SELECT notice_text,version FROM guild_profile_details WHERE guild_id=?", [guildId]))[0]!;
  }

  before(async () => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 6, connectTimeoutMs: 5_000 });
    await database.execute("INSERT INTO guilds(code,display_name,status,mark) VALUES (?,?, 'active','N')", [`GUILD-NOTICE-${Date.now()}`, "합성 공지 길드"]);
    guildId = (await database.query<Array<{ id: bigint }>>("SELECT id FROM guilds ORDER BY id DESC LIMIT 1"))[0]!.id.toString();
    await database.execute("INSERT INTO guild_profile_details(guild_id) VALUES (?)", [guildId]);
    for (const fixture of [{ id: leader, name: "합성 길드장", role: "master" }, { id: submaster, name: "합성 부마스터", role: "sub_master" }, { id: member, name: "합성 길드원", role: "member" }]) {
      await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
      const playerId = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!.id;
      await database.execute("INSERT INTO player_profiles(player_id,current_display_name,experience,version) VALUES (?,?,0,1)", [playerId, fixture.name]);
      await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,?,'linked')", [playerId, fixture.id, fixture.name]);
      await database.execute("INSERT INTO guild_members(guild_id,player_id,role_code,joined_at) VALUES (?,?,?,UTC_TIMESTAMP(3))", [guildId, playerId, fixture.role]);
    }
  });

  after(async () => { if (database) await database.close(); });

  it("preserves auth, replay, concurrency, rollback, Shadow and dispatch wiring", async () => {
    const service = new GuildProfileNoticeMutateService(database);
    const shadow = `${prefix}-shadow`; await event(shadow, leader);
    assert.deepEqual(await service.handleIris({ eventId: shadow, externalUserId: leader, channelId: room, message: "/길드공지 그림자" }), { status: "shadow" });
    assert.deepEqual(await profile(), { notice_text: null, version: 1n });
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='GUILD_PROFILE_NOTICE_MUTATE'");
    const changed = `${prefix}-changed`; await event(changed, leader);
    const dispatch = await new IrisAdminCommandService(database).changePlayerPoint({ eventId: changed, externalUserId: leader, channelId: room, message: "/길드공지 첫 공지" });
    assert.equal(dispatch.status, "changed"); assert.deepEqual(await profile(), { notice_text: "첫 공지", version: 2n });
    assert.equal((await service.mutate({ eventId: changed, externalUserId: leader, channelId: room, message: "/길드공지 첫 공지" })).version, "2");
    const sub = `${prefix}-sub`; await event(sub, submaster);
    assert.equal((await service.mutate({ eventId: sub, externalUserId: submaster, channelId: room, message: "/길드공지 부마 공지" })).status, "changed");
    const denied = `${prefix}-denied`; await event(denied, member);
    await assert.rejects(() => service.mutate({ eventId: denied, externalUserId: member, channelId: room, message: "/길드공지 거부" }), /길드장 또는 부마스터/);
    const c1 = `${prefix}-c1`, c2 = `${prefix}-c2`; await event(c1, leader); await event(c2, leader);
    await Promise.all([
      service.mutate({ eventId: c1, externalUserId: leader, channelId: room, message: "/길드공지 동시 공지 A" }),
      service.mutate({ eventId: c2, externalUserId: leader, channelId: room, message: "/길드공지 동시 공지 B" })
    ]);
    const afterConcurrent = await profile(); assert.equal(afterConcurrent.version, 5n); assert.match(afterConcurrent.notice_text ?? "", /^동시 공지 [AB]$/);
    const rollback = `${prefix}-rollback`; await event(rollback, leader);
    await database.execute("CREATE TRIGGER fail_guild_notice_audit BEFORE INSERT ON command_audit FOR EACH ROW BEGIN IF NEW.action_code='guild.profile.notice.mutate' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forced guild notice audit failure'; END IF; END");
    try { await assert.rejects(() => service.mutate({ eventId: rollback, externalUserId: leader, channelId: room, message: "/길드공지 롤백 공지" }), /forced guild notice audit failure/); }
    finally { await database.execute("DROP TRIGGER IF EXISTS fail_guild_notice_audit"); }
    assert.deepEqual(await profile(), afterConcurrent);
    const rollbackOps = await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM operations WHERE idempotency_scope=? AND idempotency_key=?", [`guild.profile.notice:${guildId}`, rollback]);
    assert.equal(rollbackOps[0]!.count_value, 0n);
  });
});
