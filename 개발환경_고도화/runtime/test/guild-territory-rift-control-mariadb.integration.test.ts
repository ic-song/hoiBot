import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { CommandDispatcher, MariaCommandDispatchRepository } from "../src/dispatch/command-dispatcher.js";
import { GuildTerritoryRiftControlService, parseGuildTerritoryRiftControlCommand } from "../src/guild/guild-territory-rift-control-service.js";

const integration = process.env.RUN_MARIADB_INTEGRATION === "true" ? describe : describe.skip;

integration("guild territory rift control MariaDB integration", () => {
  let db: DatabaseClient;
  const user = "integration-guild-rift-user";
  const deniedUser = "integration-guild-rift-denied";
  const room = "integration-guild-rift-room";
  const prefix = "integration-guild-rift-" + Date.now();
  const actorId = 989300001;
  const deniedId = 989300002;
  const guildId = 989310001;
  const warId = 989320001;

  before(async () => {
    db = createDatabaseClient(loadConfig().database);
    await db.execute("INSERT INTO players(id,status,version) VALUES (?,'active',1),(?,'active',1)", [actorId, deniedId]);
    await db.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,'균열 사용자',1),(?,'균열 미권한',1)", [actorId, deniedId]);
    await db.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'균열 사용자','linked'),(?,'kakao',?,'균열 미권한','linked')", [actorId, user, deniedId, deniedUser]);
    await db.execute("INSERT INTO guilds(id,code,display_name,status,version) VALUES (?,'SYN-RIFT-GUILD','균열 길드','active',1)", [guildId]);
    await db.execute("INSERT INTO guild_members(guild_id,player_id,role_code,joined_at) VALUES (?,?,'member',UTC_TIMESTAMP(3)),(?,?,'member',UTC_TIMESTAMP(3))", [guildId, actorId, guildId, deniedId]);
    await db.execute("INSERT INTO guild_territory_rift_authorizations(guild_id,player_id,authority_code,active) VALUES (?,?,'sword_master',TRUE)", [guildId, actorId]);
    await db.execute("INSERT INTO guild_territory_wars(id,war_key,active,instability_adjust,rift_bias,rift_event_history_json,version) VALUES (?,'integration-rift-war',TRUE,0,0,JSON_ARRAY(),1)", [warId]);
    await db.execute("INSERT INTO guild_territory_ready_guilds(war_id,guild_id,ready) VALUES (?,?,TRUE)", [warId, guildId]);
    await db.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) SELECT ?,id,100,1 FROM item_definitions WHERE code IN ('guild_rift_guide','guild_instability_up','guild_instability_down','guild_great_rift_guide')", [actorId]);
  });

  after(async () => db.close());

  it("applies all four policies atomically with authorization, replay, concurrency, rollback and Shadow", async () => {
    const service = new GuildTerritoryRiftControlService(db);
    const shadowId = prefix + "-shadow";
    await event(shadowId, user);
    const shadow = await new CommandDispatcher(new MariaCommandDispatchRepository(db), { enabled: true, allowAllCanaries: true, canaryUserIds: new Set() }).resolve({ eventId: shadowId, message: "/균열", userId: user, hasTrustedDisplayName: true });
    assert.deepEqual([shadow.route, shadow.handlerKey], ["SHADOW", "guild_territory_rift_control"]);
    assert.equal(await count("SELECT COUNT(*) value FROM operations WHERE idempotency_key=?", [shadowId]), 0n);

    const concurrentId = prefix + "-concurrent";
    await event(concurrentId, user);
    const command = parseGuildTerritoryRiftControlCommand("/균열 5")!;
    const [left, right] = await Promise.all([
      service.execute({ eventId: concurrentId, externalUserId: user, destinationId: room, command }),
      service.execute({ eventId: concurrentId, externalUserId: user, destinationId: room, command }),
    ]);
    assert.deepEqual(left, right);
    assert.equal(left?.status, "changed");
    assert.equal(left?.appliedCount, "3");
    assert.equal(await scalar("SELECT CAST(rift_bias AS CHAR) value FROM guild_territory_wars WHERE id=?", [warId]), "30.000");
    assert.equal(await itemQuantity("guild_rift_guide"), 97n);
    assert.equal(await count("SELECT COUNT(*) value FROM guild_territory_rift_command_uses WHERE war_id=? AND guild_id=? AND command_type='rift_guide'", [warId, guildId]), 1n);

    const duplicateId = prefix + "-duplicate";
    await event(duplicateId, user);
    const duplicate = await service.handleIris({ eventId: duplicateId, externalUserId: user, channelId: room, message: "/균열" });
    assert.equal(duplicate?.status, "already_used");
    assert.equal(await itemQuantity("guild_rift_guide"), 97n);

    const upId = prefix + "-up";
    await event(upId, user);
    const up = await service.handleIris({ eventId: upId, externalUserId: user, channelId: room, message: "/불안정 100" });
    assert.equal(up?.appliedCount, "20");
    assert.equal(await scalar("SELECT CAST(instability_adjust AS CHAR) value FROM guild_territory_wars WHERE id=?", [warId]), "10.000");

    const downId = prefix + "-down";
    await event(downId, user);
    const down = await service.handleIris({ eventId: downId, externalUserId: user, channelId: room, message: "/안정 100" });
    assert.equal(down?.appliedCount, "40");
    assert.equal(await scalar("SELECT CAST(instability_adjust AS CHAR) value FROM guild_territory_wars WHERE id=?", [warId]), "-10.000");

    const greatId = prefix + "-great";
    await event(greatId, user);
    const great = await service.handleIris({ eventId: greatId, externalUserId: user, channelId: room, message: "/대균열" });
    assert.equal(great?.appliedCount, "1");
    assert.equal(await scalar("SELECT CAST(rift_bias AS CHAR) value FROM guild_territory_wars WHERE id=?", [warId]), "20.000");

    const deniedEvent = prefix + "-denied";
    await event(deniedEvent, deniedUser);
    const denied = await service.handleIris({ eventId: deniedEvent, externalUserId: deniedUser, channelId: room, message: "/불안정" });
    assert.equal(denied?.status, "authority_required");

    await db.execute("UPDATE guild_territory_wars SET active=FALSE WHERE id=?", [warId]);
    const rollbackWar = 989320002;
    await db.execute("INSERT INTO guild_territory_wars(id,war_key,active,instability_adjust,rift_bias,rift_event_history_json,version) VALUES (?,'integration-rift-rollback',TRUE,0,0,JSON_ARRAY(),1)", [rollbackWar]);
    await db.execute("INSERT INTO guild_territory_ready_guilds(war_id,guild_id,ready) VALUES (?,?,TRUE)", [rollbackWar, guildId]);
    const rollbackId = prefix + "-rollback";
    await event(rollbackId, user);
    const beforeItem = await itemQuantity("guild_rift_guide");
    await assert.rejects(
      () => new GuildTerritoryRiftControlService(failAudit(db)).handleIris({ eventId: rollbackId, externalUserId: user, channelId: room, message: "/균열 2" }),
      /integration guild rift audit failure/,
    );
    assert.equal(await itemQuantity("guild_rift_guide"), beforeItem);
    assert.equal(await scalar("SELECT CAST(rift_bias AS CHAR) value FROM guild_territory_wars WHERE id=?", [rollbackWar]), "0.000");
    assert.equal(await count("SELECT COUNT(*) value FROM operations WHERE idempotency_key=?", [rollbackId]), 0n);
    assert.equal(await count("SELECT COUNT(*) value FROM guild_territory_rift_command_uses WHERE war_id=?", [rollbackWar]), 0n);
  });

  async function event(id: string, external: string) {
    await db.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES(?,?,?,?,'message','incoming',REPEAT('d',64),'processed',UTC_TIMESTAMP(3))", [id, id, room, external]);
  }

  async function count(sql: string, values: readonly unknown[] = []) {
    return BigInt((await db.query<Array<{ value: bigint | string }>>(sql, values))[0]?.value ?? 0);
  }

  async function scalar(sql: string, values: readonly unknown[] = []) {
    return String((await db.query<Array<{ value: string }>>(sql, values))[0]?.value ?? "");
  }

  async function itemQuantity(code: string) {
    return count("SELECT stack.quantity value FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=? AND item.code=?", [actorId, code]);
  }
});

function failAudit(inner: DatabaseClient): DatabaseClient {
  return {
    ping: () => inner.ping(),
    query: (sql, values) => inner.query(sql, values),
    execute: (sql, values) => inner.execute(sql, values),
    verifyRollback: () => inner.verifyRollback(),
    close: async () => undefined,
    withTransaction: <T>(work: (tx: DatabaseTransaction) => Promise<T>) =>
      inner.withTransaction((tx) =>
        work({
          query: (sql, values) => tx.query(sql, values),
          execute: async (sql, values) => {
            if (sql.includes("INSERT INTO command_audit")) throw new Error("integration guild rift audit failure");
            return tx.execute(sql, values);
          },
        }),
      ),
  };
}
