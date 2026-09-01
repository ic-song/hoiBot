import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { GuildDisbandDeleteService } from "../src/guild/guild-disband-delete-service.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("guild disband delete MariaDB", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const suffix = Date.now().toString();
  const externalId = `guild-disband-${suffix}`;
  const open = () => createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });

  async function createGuild(name: string): Promise<{ guildId: bigint; memberId: bigint }> {
    await database.execute("INSERT INTO guilds(code,display_name,status,version) VALUES (?,?,'active',1)", [`disband-${randomPart(name)}-${suffix}`, name]);
    const guildId = (await database.query<Array<{ id: bigint }>>("SELECT id FROM guilds WHERE display_name=? AND status='active' ORDER BY id DESC LIMIT 1", [name]))[0]!.id;
    await database.execute("INSERT INTO guild_name_registry(guild_id,normalized_name,display_name,version,updated_at) VALUES (?,?,?,1,UTC_TIMESTAMP(3))", [guildId, name, name]);
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const memberId = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!.id;
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,?,1)", [memberId, `${name}회원`]);
    await database.execute("INSERT INTO guild_members(guild_id,player_id,role_code,joined_at) VALUES (?,?,'member',UTC_TIMESTAMP(3))", [guildId, memberId]);
    return { guildId, memberId };
  }

  before(async () => {
    database = open();
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=TRUE WHERE command_code='GUILD_DISBAND_DELETE'");
    await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES (?,?,'synthetic','active')", [`disband-${suffix}`, "합성마스터"]);
    const operatorId = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE login_id=?", [`disband-${suffix}`]))[0]!.id;
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const actorId = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!.id;
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,'합성마스터',1)", [actorId]);
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'합성마스터','linked')", [actorId, externalId]);
    const identityId = (await database.query<Array<{ id: bigint }>>("SELECT id FROM external_identities WHERE external_user_id=?", [externalId]))[0]!.id;
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)", [operatorId, identityId]);
    for (const eventId of ["guild-disband-first", "guild-disband-rollback", "guild-disband-shadow"]) await database.execute("INSERT INTO event_inbox(event_id,event_kind,processing_status,received_at,attempt_count) VALUES (?,'iris','processing',UTC_TIMESTAMP(3),1)", [eventId]);
  });

  after(async () => { if (database !== undefined) await database.close(); });

  it("keeps tombstone, reference cleanup, replay, rollback, reconnect and Shadow atomic", async () => {
    const firstGuild = await createGuild(`해산길드-${suffix}`);
    await database.execute("INSERT INTO guild_territory_wars(war_key,active,rift_event_history_json,rift_event_guild_id) VALUES (?,TRUE,JSON_ARRAY(),?)", [`disband-war-${suffix}`, firstGuild.guildId]);
    const warId = (await database.query<Array<{ id: bigint }>>("SELECT id FROM guild_territory_wars WHERE war_key=?", [`disband-war-${suffix}`]))[0]!.id;
    await database.execute("INSERT INTO guild_territory_ready_guilds(war_id,guild_id,ready) VALUES (?,?,TRUE)", [warId, firstGuild.guildId]);
    await database.execute("INSERT INTO guild_territory_occupations(war_id,territory_no,territory_name,owner_guild_id,owner_player_id,version) VALUES (?,1,'합성영지',?,?,1)", [warId, firstGuild.guildId, firstGuild.memberId]);
    await database.execute("UPDATE castle_state SET lord_guild_name=?,lord_player_id=?,earnings=100,defense_count=2,version=version+1 WHERE state_code='HOI_CASTLE'", [`해산길드-${suffix}`, firstGuild.memberId]);
    const service = new GuildDisbandDeleteService(database);
    const first = await service.handle({ eventId: "guild-disband-first", externalUserId: externalId, channelId: "431-room", message: `/길드해산 해산길드-${suffix}` });
    assert.equal(first?.status, "disbanded");
    assert.equal(first?.memberCount, 1);
    assert.equal(first?.territoryCount, 1);
    assert.equal(first?.castleReleased, true);
    assert.equal((await service.handle({ eventId: "guild-disband-first", externalUserId: externalId, channelId: "431-room", message: `/길드삭제 해산길드-${suffix}` }))?.replayed, true);
    assert.equal((await database.query<Array<{ status: string }>>("SELECT status FROM guilds WHERE id=?", [firstGuild.guildId]))[0]!.status, "disbanded");
    assert.equal((await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM guild_members WHERE guild_id=?", [firstGuild.guildId]))[0]!.count, 0n);

    const rollbackGuild = await createGuild(`롤백길드-${suffix}`);
    await database.execute("CREATE TRIGGER fail_guild_disband_audit BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic guild disband rollback'");
    await assert.rejects(service.handle({ eventId: "guild-disband-rollback", externalUserId: externalId, channelId: "431-room", message: `/길드해지 롤백길드-${suffix}` }));
    await database.execute("DROP TRIGGER fail_guild_disband_audit");
    assert.equal((await database.query<Array<{ status: string }>>("SELECT status FROM guilds WHERE id=?", [rollbackGuild.guildId]))[0]!.status, "active");
    assert.equal((await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM guild_members WHERE guild_id=?", [rollbackGuild.guildId]))[0]!.count, 1n);
    await database.close();
    database = open();
    assert.equal((await new GuildDisbandDeleteService(database).handle({ eventId: "guild-disband-first", externalUserId: externalId, channelId: "431-room", message: `/길드해산 해산길드-${suffix}` }))?.replayed, true);
    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='GUILD_DISBAND_DELETE'");
    assert.equal(await new GuildDisbandDeleteService(database).handle({ eventId: "guild-disband-shadow", externalUserId: externalId, channelId: "431-room", message: `/길드삭제 롤백길드-${suffix}` }), null);
    assert.equal((await database.query<Array<{ status: string }>>("SELECT status FROM guilds WHERE id=?", [rollbackGuild.guildId]))[0]!.status, "active");
  });
});

function randomPart(value: string): string { return createHash(value).slice(0, 12); }
function createHash(value: string): string { let hash = 0; for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0; return Math.abs(hash).toString(36); }
