import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { GuildTerritoryBoosterContributeService, parseGuildTerritoryBoosterContributeCommand } from "../src/guild/guild-territory-booster-contribute-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_guild_territory_booster_contribute(?:_[a-z0-9_]+)?$/i.test(config.database.name)) throw new Error("Synthetic guild booster contribution probe blocked: " + config.database.name);
const db = createDatabaseClient(config.database);
const restart = process.argv.includes("--verify-restart");
const user = "synthetic-guild-booster-user";
const guildless = "synthetic-guild-booster-guildless";
const room = "synthetic-guild-booster-room";
const prefix = process.env.GUILD_BOOSTER_CONTRIBUTE_PROBE_EVENT_ID ?? "guild-booster-contribute-g7-20260829-r1";
const playerId = 996000001;
const guildlessId = 996000002;
const guildId = 996100001;

try {
  const service = new GuildTerritoryBoosterContributeService(db);
  if (!restart) {
    await seed();
    const success = prefix + "-success";
    await event(success, user);
    const command = parseGuildTerritoryBoosterContributeCommand("/길드부스터공헌 4")!;
    const [first, duplicate] = await Promise.all([
      service.contribute({ eventId: success, externalUserId: user, channelId: room, command }),
      service.contribute({ eventId: success, externalUserId: user, channelId: room, command }),
    ]);
    assert.deepEqual(first, duplicate);
    assert.equal(first?.status, "contributed");
    assert.deepEqual(await domainState(), { inventory: 6n, guildBooster: 6n, memberContribution: 7n, dailyCount: 1n, runs: 1n, boosterLedgers: 1n, inventoryLedgers: 1n });

    const unchanged = await domainState();
    for (const [suffix, externalUserId, message, expected] of [
      ["usage", user, "/길드부스터공헌", "usage"],
      ["zero", user, "/길드부스터공헌 0", "invalid_count"],
      ["shortage", user, "/길드부스터공헌 7", "item_shortage"],
      ["guildless", guildless, "/길드부스터공헌 1", "guild_required"],
    ] as const) {
      const id = `${prefix}-${suffix}`;
      await event(id, externalUserId);
      assert.equal((await service.handleIris({ eventId: id, externalUserId, channelId: room, message }))?.status, expected);
      assert.deepEqual(await domainState(), unchanged);
    }

    const rollback = prefix + "-rollback";
    await event(rollback, user);
    await assert.rejects(() => new GuildTerritoryBoosterContributeService(failAudit(db)).handleIris({ eventId: rollback, externalUserId: user, channelId: room, message: "/길드부스터공헌 1" }), /synthetic guild booster audit failure/);
    assert.deepEqual(await domainState(), unchanged);
    const retry = await service.handleIris({ eventId: rollback, externalUserId: user, channelId: room, message: "/길드부스터공헌 1" });
    assert.equal(retry?.status, "contributed");
    assert.deepEqual(await domainState(), { inventory: 5n, guildBooster: 7n, memberContribution: 8n, dailyCount: 2n, runs: 2n, boosterLedgers: 2n, inventoryLedgers: 2n });

    console.log(JSON.stringify({ mode: "probe", scenarios: ["shadow", "exact-guard", "success", "concurrency", "usage", "zero", "shortage", "guild-required", "rollback", "retry", "replay"], state: await domainState(), evidence: await evidenceState(), operationalDataTouched: false }, (_key, value) => typeof value === "bigint" ? Number(value) : value));
  } else {
    const before = await domainState();
    const replay = await service.contribute({ eventId: prefix + "-success", externalUserId: user, channelId: room, command: parseGuildTerritoryBoosterContributeCommand("/길드부스터공헌 4")! });
    assert.equal(replay?.status, "contributed");
    assert.deepEqual(await domainState(), before);
    console.log(JSON.stringify({ mode: "verify-restart", status: replay.status, state: before, additionalMutation: false, operationalDataTouched: false }, (_key, value) => typeof value === "bigint" ? Number(value) : value));
  }
} finally {
  await db.close();
}

async function seed() {
  await db.execute("INSERT INTO players(id,status,version) VALUES (?,'active',1),(?,'active',1)", [playerId, guildlessId]);
  await db.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,'부스터 회원',1),(?,'무길드 회원',1)", [playerId, guildlessId]);
  await db.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'부스터 회원','linked'),(?,'kakao',?,'무길드 회원','linked')", [playerId, user, guildlessId, guildless]);
  await db.execute("INSERT INTO guilds(id,code,display_name,status,version) VALUES (?,'SYN-GUILD-BOOSTER','부스터 합성길드','active',1)", [guildId]);
  await db.execute("INSERT INTO guild_profile_details(guild_id,territory_booster,version) VALUES (?,2,1)", [guildId]);
  await db.execute("INSERT INTO guild_members(guild_id,player_id,role_code,joined_at,territory_booster_contribution,version) VALUES (?,?,'member',UTC_TIMESTAMP(3),3,1)", [guildId, playerId]);
  await db.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) SELECT ?,id,10,1 FROM item_definitions WHERE code='ITEM-GUILD-TERRITORY-BOOSTER'", [playerId]);
  await db.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='GUILD_TERRITORY_BOOSTER_CONTRIBUTE'");
}

async function event(id: string, externalUserId: string) {
  await db.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES(?,?,?,?,'message','incoming',REPEAT('b',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)", [id, id, room, externalUserId]);
}

async function domainState() {
  const row = (await db.query<Array<{ inventory: bigint; guild_booster: bigint; member_contribution: bigint; daily_count: bigint; runs: bigint; booster_ledgers: bigint; inventory_ledgers: bigint }>>(`SELECT
    (SELECT quantity FROM inventory_stacks WHERE player_id=${playerId} AND item_id=(SELECT id FROM item_definitions WHERE code='ITEM-GUILD-TERRITORY-BOOSTER')) inventory,
    (SELECT territory_booster FROM guild_profile_details WHERE guild_id=${guildId}) guild_booster,
    (SELECT territory_booster_contribution FROM guild_members WHERE guild_id=${guildId} AND player_id=${playerId}) member_contribution,
    COALESCE((SELECT SUM(value) FROM player_counters WHERE player_id=${playerId} AND counter_code='guild_territory_booster_contribution_count'),0) daily_count,
    (SELECT COUNT(*) FROM guild_territory_booster_contribution_runs) runs,
    (SELECT COUNT(*) FROM guild_territory_booster_ledger) booster_ledgers,
    (SELECT COUNT(*) FROM inventory_ledger WHERE reason_code='GUILD_TERRITORY_BOOSTER_CONTRIBUTE') inventory_ledgers`))[0]!;
  return { inventory: BigInt(row.inventory), guildBooster: BigInt(row.guild_booster), memberContribution: BigInt(row.member_contribution), dailyCount: BigInt(row.daily_count), runs: BigInt(row.runs), boosterLedgers: BigInt(row.booster_ledgers), inventoryLedgers: BigInt(row.inventory_ledgers) };
}

async function evidenceState() {
  const row = (await db.query<Array<{ operations: bigint; executions: bigint; audits: bigint; outboxes: bigint }>>(`SELECT
    (SELECT COUNT(*) FROM operations WHERE idempotency_scope='guild.territory.booster_contribute') operations,
    (SELECT COUNT(*) FROM command_executions WHERE command_code='GUILD_TERRITORY_BOOSTER_CONTRIBUTE') executions,
    (SELECT COUNT(*) FROM command_audit WHERE action_code='guild.territory.booster_contribute') audits,
    (SELECT COUNT(*) FROM outbox_messages WHERE operation_id IN (SELECT id FROM operations WHERE idempotency_scope='guild.territory.booster_contribute')) outboxes`))[0]!;
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, BigInt(value)]));
}

function failAudit(inner: DatabaseClient): DatabaseClient {
  return { ping: () => inner.ping(), query: (sql, values) => inner.query(sql, values), execute: (sql, values) => inner.execute(sql, values), verifyRollback: () => inner.verifyRollback(), close: async () => undefined, withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => inner.withTransaction((transaction) => work({ query: (sql, values) => transaction.query(sql, values), execute: async (sql, values) => { if (sql.includes("INSERT INTO command_audit")) throw new Error("synthetic guild booster audit failure"); return transaction.execute(sql, values); } })) };
}
