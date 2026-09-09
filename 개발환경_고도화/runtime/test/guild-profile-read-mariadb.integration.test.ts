import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { CommandDispatcher, MariaCommandDispatchRepository } from "../src/dispatch/command-dispatcher.js";
import { GuildProfileReadService } from "../src/guild/guild-profile-read-service.js";

const run = process.env.RUN_MARIADB_INTEGRATION === "true" ? test : test.skip;
run("guild profile read repairs defaults and reads one replay-safe snapshot", async () => {
  const db = createDatabaseClient(loadConfig().database);
  const room = "guild-profile-integration-room", user = "guild-profile-member", noGuildUser = "guild-profile-none", rollbackUser = "guild-profile-rollback";
  const event = async (id: string, externalUserId: string) => db.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('d',64),'processed',UTC_TIMESTAMP(3))", [id, id, room, externalUserId]);
  try {
    await db.execute("INSERT INTO players(id,status) VALUES (985000001,'active'),(985000002,'active'),(985000003,'active'),(985000004,'active')");
    await db.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (985000001,'길드장'),(985000002,'길드원'),(985000003,'무길드'),(985000004,'롤백회원')");
    await db.execute("INSERT INTO player_pets(id,player_id,display_name) VALUES (985100001,985000001,'길드장펫')");
    await db.execute("INSERT INTO external_identities(id,provider_code,external_user_id,player_id,status) VALUES (985200001,'kakao',?,985000001,'linked'),(985200003,'kakao',?,985000003,'linked'),(985200004,'kakao',?,985000004,'linked')", [user, noGuildUser, rollbackUser]);
    await db.execute("INSERT INTO guilds(id,code,display_name,status,version) VALUES (985300001,'PROFILE-GUILD','프로필 길드','active',1),(985300002,'ROLLBACK-GUILD','롤백 길드','active',1)");
    await db.execute("INSERT INTO guild_members(guild_id,player_id,role_code,joined_at) VALUES (985300001,985000001,'master','2026-01-01'),(985300001,985000002,'member','2026-01-02'),(985300002,985000004,'master','2026-01-01')");
    const war = await db.execute("INSERT INTO guild_territory_wars(war_key,active,rift_event_history_json) VALUES ('guild-profile-integration',FALSE,'[]')");
    await db.execute("INSERT INTO guild_territory_occupations(war_id,territory_no,territory_name,owner_guild_id,version) VALUES (?,1,'프로필 평원',985300001,1)", [war.insertId]);
    assert.equal((await db.query<Array<{ rollout_state: string }>>("SELECT rollout_state FROM command_registry WHERE command_code='GUILD_PROFILE_READ'"))[0]?.rollout_state, "SHADOW");
    const dispatch = await new CommandDispatcher(new MariaCommandDispatchRepository(db), { enabled: true, allowAllCanaries: true, canaryUserIds: new Set() }).resolve({ eventId: "guild-profile-dispatch", message: "ㄱㄱㄱ", userId: user, hasTrustedDisplayName: true });
    assert.deepEqual([dispatch.route, dispatch.handlerKey], ["SHADOW", "guild_profile_read"]);
    const service = new GuildProfileReadService(db), readEvent = "guild-profile-read"; await event(readEvent, user);
    const result = await service.handle({ eventId: readEvent, externalUserId: user, destinationId: room, message: "/길드정보" });
    assert.equal(result?.status, "detail"); assert.equal(result?.memberCount, 2); assert.equal(result?.territoryCount, 1); assert.equal(result?.repairCount, 5); assert.match(result!.data, /프로필 평원/);
    assert.deepEqual(await service.handle({ eventId: readEvent, externalUserId: user, destinationId: room, message: "ㄱㄱㄱ" }), result);
    const noGuildEvent = "guild-profile-no-guild"; await event(noGuildEvent, noGuildUser); assert.equal((await service.handle({ eventId: noGuildEvent, externalUserId: noGuildUser, destinationId: room, message: "ㄱㄱㄱ" }))?.status, "no_guild");
    const rollbackEvent = "guild-profile-rollback"; await event(rollbackEvent, rollbackUser);
    await assert.rejects(() => new GuildProfileReadService(failRepairAudit(db)).handle({ eventId: rollbackEvent, externalUserId: rollbackUser, destinationId: room, message: "/길드정보" }), /guild profile repair audit failure/);
    assert.equal((await db.query<Array<{ value: bigint }>>("SELECT COUNT(*) value FROM guild_profile_details WHERE guild_id=985300002"))[0]?.value, 0n);
    assert.equal(await db.verifyRollback(), true);
  } finally { await db.close(); }
});

function failRepairAudit(inner: DatabaseClient): DatabaseClient { return { ping: () => inner.ping(), query: (sql, params) => inner.query(sql, params), execute: (sql, params) => inner.execute(sql, params), verifyRollback: () => inner.verifyRollback(), close: async () => undefined, withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => inner.withTransaction((transaction) => work({ query: (sql, params) => transaction.query(sql, params), execute: async (sql, params) => { if (sql.includes("INSERT INTO command_audit") && sql.includes("guild.profile.repair")) throw new Error("guild profile repair audit failure"); return transaction.execute(sql, params); } })) }; }
