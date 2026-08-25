import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { MariaGuildJoinRepository } from "../src/guild/maria-guild-join-repository.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("guild recruitment toggle MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient; let guildId = "";
  const token = "guild-recruitment-token", roomId = "990000000000256";
  const leaderExternalId = "guild-recruitment-leader", memberExternalId = "guild-recruitment-member";

  before(async () => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE handler_key='guild_recruitment_toggle'");
    await database.execute("INSERT INTO guilds(code,display_name,status,mark) VALUES ('GUILD-RECRUITMENT-SYNTHETIC','합성 모집 길드','active','G')");
    guildId = (await database.query<Array<{ id: bigint }>>("SELECT id FROM guilds WHERE code='GUILD-RECRUITMENT-SYNTHETIC'"))[0]!.id.toString();
    await database.execute("INSERT INTO guild_join_policies(guild_id,member_join_closed,version) VALUES (?,0,1)", [guildId]);
    for (const fixture of [{ externalId: leaderExternalId, name: "합성 길드장", role: "leader" }, { externalId: memberExternalId, name: "합성 길드원", role: "member" }]) {
      await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
      const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
      await database.execute("INSERT INTO player_profiles(player_id,current_display_name,experience,version) VALUES (?,?,1000,1)", [player.id, fixture.name]);
      await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,?,'linked')", [player.id, fixture.externalId, fixture.name]);
      await database.execute("INSERT INTO guild_members(guild_id,player_id,role_code,joined_at) VALUES (?,?,?,UTC_TIMESTAMP(3))", [guildId, player.id, fixture.role]);
    }
  });

  after(async () => { if (!database) return; try { await database.close(); } catch (error) { const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined; if (code !== "ER_POOL_ALREADY_CLOSED") throw error; } });

  it("shares one policy with join consumers and preserves replay, auth, shadow and rollback", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "guild-recruitment-pepper", PARTIAL_COMMAND_DISPATCH_ENABLED: "true", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    const app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply) => { replies.push(reply); } });
    const send = async (externalId: string, eventId: string, msg: string) => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg, room: "고도화팻테스트방", sender: externalId, json: { _id: eventId, chat_id: roomId, user_id: externalId } } });
    const closeEvent = `guild-close-${Date.now()}`;
    assert.equal((await send(leaderExternalId, closeEvent, "/길드인원마감")).statusCode, 202);
    await send(leaderExternalId, closeEvent, "/길드인원마감");
    assert.equal((await send(leaderExternalId, `guild-close-again-${Date.now()}`, "/길드인원마감")).statusCode, 202);
    let policy = (await database.query<Array<{ member_join_closed: number; version: bigint }>>("SELECT member_join_closed,version FROM guild_join_policies WHERE guild_id=?", [guildId]))[0]!;
    assert.equal(policy.member_join_closed, 1); assert.equal(policy.version, 2n);
    const closedCandidate = await new MariaGuildJoinRepository(database).runInTransaction(async (tx) => (await tx.listJoinableGuilds()).find((item) => item.guildId === guildId));
    assert.equal(closedCandidate?.memberJoinClosed, true);
    assert.equal((await send(leaderExternalId, `guild-open-${Date.now()}`, "/길드인원마감해제")).statusCode, 202);
    policy = (await database.query<Array<{ member_join_closed: number; version: bigint }>>("SELECT member_join_closed,version FROM guild_join_policies WHERE guild_id=?", [guildId]))[0]!;
    assert.equal(policy.member_join_closed, 0); assert.equal(policy.version, 3n);
    const openCandidate = await new MariaGuildJoinRepository(database).runInTransaction(async (tx) => (await tx.listJoinableGuilds()).find((item) => item.guildId === guildId));
    assert.equal(openCandidate?.memberJoinClosed, false);
    assert.equal((await send(memberExternalId, `guild-denied-${Date.now()}`, "/길드인원마감")).statusCode, 202);
    policy = (await database.query<Array<{ member_join_closed: number; version: bigint }>>("SELECT member_join_closed,version FROM guild_join_policies WHERE guild_id=?", [guildId]))[0]!;
    assert.equal(policy.member_join_closed, 0); assert.equal(policy.version, 3n);
    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='GUILD_RECRUITMENT_CLOSE'");
    await send(leaderExternalId, `guild-shadow-${Date.now()}`, "/길드인원마감");
    policy = (await database.query<Array<{ member_join_closed: number; version: bigint }>>("SELECT member_join_closed,version FROM guild_join_policies WHERE guild_id=?", [guildId]))[0]!;
    assert.equal(policy.member_join_closed, 0); assert.equal(policy.version, 3n);
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='GUILD_RECRUITMENT_CLOSE'");
    await database.execute("CREATE TRIGGER fail_guild_recruitment_audit BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic rollback'");
    const rollbackEvent = `guild-rollback-${Date.now()}`;
    assert.equal((await send(leaderExternalId, rollbackEvent, "/길드인원마감")).statusCode, 500);
    await database.execute("DROP TRIGGER fail_guild_recruitment_audit");
    policy = (await database.query<Array<{ member_join_closed: number; version: bigint }>>("SELECT member_join_closed,version FROM guild_join_policies WHERE guild_id=?", [guildId]))[0]!;
    assert.equal(policy.member_join_closed, 0); assert.equal(policy.version, 3n);
    const compatibility = (await database.query<Array<{ member_join_closed: number }>>("SELECT member_join_closed FROM guilds WHERE id=?", [guildId]))[0]!;
    assert.equal(compatibility.member_join_closed, 0);
    const rollbackOps = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM operations WHERE idempotency_key=?", [`iris:${rollbackEvent}`]);
    assert.equal(Number(rollbackOps[0]!.count), 0);
    assert.match(replies[0]?.data ?? "", /마감했습니다/);
    await app.close();
  });
});
