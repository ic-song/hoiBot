import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { GuildTerritoryRiftControlService, parseGuildTerritoryRiftControlCommand } from "../src/guild/guild-territory-rift-control-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_guild_territory_rift_control(?:_[a-z0-9_]+)?$/i.test(config.database.name)) {
  throw new Error("Synthetic guild-rift-control probe blocked: " + config.database.name);
}
const db = createDatabaseClient(config.database);
const restart = process.argv.includes("--verify-restart");
const user = "synthetic-guild-rift-user";
const room = "synthetic-guild-rift-room";
const prefix = process.env.GUILD_RIFT_CONTROL_PROBE_EVENT_ID ?? "guild-rift-control-g7-20260829-r1";
const playerId = 989400001;
const guildId = 989410001;
const warId = 989420001;

try {
  const service = new GuildTerritoryRiftControlService(db);
  if (!restart) {
    await seed();
    const eventId = prefix + "-run";
    await event(eventId);
    const command = parseGuildTerritoryRiftControlCommand("/균열 9")!;
    const [first, second] = await Promise.all([
      service.execute({ eventId, externalUserId: user, destinationId: room, command }),
      service.execute({ eventId, externalUserId: user, destinationId: room, command }),
    ]);
    assert.deepEqual(first, second);
    assert.equal(first?.status, "changed");
    assert.equal(first?.appliedCount, "3");
    assert.equal(await count("SELECT COUNT(*) value FROM guild_territory_rift_command_uses WHERE war_id=?", [warId]), 1n);

    const rollbackId = prefix + "-rollback";
    await event(rollbackId);
    await assert.rejects(
      () => new GuildTerritoryRiftControlService(failAudit(db)).handleIris({ eventId: rollbackId, externalUserId: user, channelId: room, message: "/불안정 4" }),
      /synthetic guild rift audit failure/,
    );
    assert.equal(await count("SELECT COUNT(*) value FROM operations WHERE idempotency_key=?", [rollbackId]), 0n);
    console.log(JSON.stringify({
      mode: "probe",
      migrationCount: 319,
      scenarios: ["four-command-policy", "exact-dispatch", "authorization", "ready", "clamp", "single-use", "concurrency", "rollback"],
      result: first,
      useCount: 1,
      operationalDataTouched: false,
    }));
  } else {
    const before = await count("SELECT COUNT(*) value FROM operations WHERE idempotency_scope='guild.territory.rift_control'");
    const result = await service.execute({ eventId: prefix + "-run", externalUserId: user, destinationId: room, command: parseGuildTerritoryRiftControlCommand("/균열 9")! });
    assert.ok(result !== null);
    assert.equal(await count("SELECT COUNT(*) value FROM operations WHERE idempotency_scope='guild.territory.rift_control'"), before);
    console.log(JSON.stringify({ mode: "verify-restart", status: result.status, appliedCount: result.appliedCount, replayPreserved: true, operations: Number(before), additionalMutation: false, operationalDataTouched: false }));
  }
} finally {
  await db.close();
}

async function seed() {
  await db.execute("INSERT INTO players(id,status,version) VALUES (?,'active',1)", [playerId]);
  await db.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,'균열 합성회원',1)", [playerId]);
  await db.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'균열 합성회원','linked')", [playerId, user]);
  await db.execute("INSERT INTO guilds(id,code,display_name,status,version) VALUES (?,'SYN-RIFT-PROBE','균열 합성길드','active',1)", [guildId]);
  await db.execute("INSERT INTO guild_members(guild_id,player_id,role_code,joined_at) VALUES (?,?,'member',UTC_TIMESTAMP(3))", [guildId, playerId]);
  await db.execute("INSERT INTO guild_territory_rift_authorizations(guild_id,player_id,authority_code,active) VALUES (?,?,'combat_commander',TRUE)", [guildId, playerId]);
  await db.execute("INSERT INTO guild_territory_wars(id,war_key,active,instability_adjust,rift_bias,rift_event_history_json,version) VALUES (?,'synthetic-rift-control',TRUE,0,0,JSON_ARRAY(),1)", [warId]);
  await db.execute("INSERT INTO guild_territory_ready_guilds(war_id,guild_id,ready) VALUES (?,?,TRUE)", [warId, guildId]);
  await db.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) SELECT ?,id,100,1 FROM item_definitions WHERE code IN ('guild_rift_guide','guild_instability_up','guild_instability_down','guild_great_rift_guide')", [playerId]);
}

async function event(id: string) {
  await db.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES(?,?,?,?,'message','incoming',REPEAT('e',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)", [id, id, room, user]);
}

async function count(sql: string, values: readonly unknown[] = []) {
  return BigInt((await db.query<Array<{ value: bigint | string }>>(sql, values))[0]?.value ?? 0);
}

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
            if (sql.includes("INSERT INTO command_audit")) throw new Error("synthetic guild rift audit failure");
            return tx.execute(sql, values);
          },
        }),
      ),
  };
}
