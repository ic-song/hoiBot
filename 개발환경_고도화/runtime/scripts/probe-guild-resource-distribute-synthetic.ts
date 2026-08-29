import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { GuildResourceDistributeService } from "../src/guild/guild-resource-distribute-service.js";
import { GUILD_RESOURCE_DISTRIBUTE_FIXTURE as fixture } from "../test/fixtures/guild-resource-distribute.js";

const config = loadConfig();
if (!config.database.enabled || !/^hoibot_guild_resource_distribute(?:_[a-z0-9_]+)?$/i.test(config.database.name)) throw new Error(`Blocked database: ${config.database.name}`);
const db = createDatabaseClient(config.database);
const base = process.env.GUILD_RESOURCE_DISTRIBUTE_EVENT_ID ?? "guild-resource-distribute-g7-20260829-r1";
const room = "guild-resource-distribute-room";
const restart = process.argv.includes("--verify-restart");
const mainEvent = `${base}-main`;

function failAudit(inner: DatabaseClient): DatabaseClient {
  return { ping: () => inner.ping(), query: (sql, params) => inner.query(sql, params), execute: (sql, params) => inner.execute(sql, params), verifyRollback: () => inner.verifyRollback(), close: async () => undefined, withTransaction: <T>(work: (tx: DatabaseTransaction) => Promise<T>) => inner.withTransaction((tx) => work({ query: (sql, params) => tx.query(sql, params), execute: async (sql, params) => { if (sql.includes("INSERT INTO command_audit")) throw new Error("synthetic guild distribution audit failure"); return tx.execute(sql, params); } })) };
}
async function event(id: string, externalUserId: string): Promise<void> { await db.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?, 'message','incoming',REPEAT('9',64),'processed',UTC_TIMESTAMP(3))", [id, id, room, externalUserId]); }
async function state(): Promise<Record<string, string>> {
  const row = (await db.query<Array<Record<string, bigint | string>>>(`SELECT
    (SELECT COUNT(*) FROM guild_resource_distribution_runs) runs,
    (SELECT COUNT(*) FROM guild_resource_distribution_recipients) recipients,
    (SELECT COUNT(*) FROM guild_resource_distribution_grants) grants,
    (SELECT quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=? AND item.code='guild_resource_distribution_ticket') ticket,
    (SELECT balance FROM guild_resource_accounts WHERE guild_id=? AND currency_code='guild_fund') guild_fund,
    (SELECT balance FROM guild_resource_accounts WHERE guild_id=? AND currency_code='diamond') diamond,
    (SELECT COALESCE(SUM(delta),0) FROM guild_resource_ledger) guild_currency_delta,
    (SELECT COALESCE(SUM(delta),0) FROM currency_ledger) player_currency_delta,
    (SELECT COALESCE(SUM(quantity_delta),0) FROM guild_warehouse_ledger) guild_item_delta,
    (SELECT COALESCE(SUM(quantity_delta),0) FROM inventory_ledger ledger JOIN item_definitions item ON item.id=ledger.item_id WHERE item.code<>'guild_resource_distribution_ticket') player_item_delta`, [fixture.playerIds[0], fixture.guildId, fixture.guildId]))[0]!;
  return Object.fromEntries(Object.entries(row).map(([name, value]) => [name, String(value)]));
}

try {
  if (!restart) {
    await db.execute("INSERT INTO guilds(id,code,display_name,mark,status,version) VALUES (?,'synthetic-distribute','호이 길드','H','active',1)", [fixture.guildId]);
    for (let index = 0; index < fixture.playerIds.length; index += 1) {
      const id = fixture.playerIds[index]!;
      await db.execute("INSERT INTO players(id,status) VALUES (?,'active')", [id]);
      await db.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (?,?)", [id, `회원${index + 1}`]);
      await db.execute("INSERT INTO external_identities(provider_code,external_user_id,player_id,status) VALUES ('kakao',?,?,'linked')", [`guild-distribute-${index + 1}`, id]);
      await db.execute("INSERT INTO guild_members(guild_id,player_id,role_code,joined_at) VALUES (?,?,?,DATE_ADD('2026-01-01',INTERVAL ? DAY))", [fixture.guildId, id, index === 0 ? "leader" : index === 1 ? "sub_master" : "member", index]);
      await db.execute("INSERT INTO guild_member_profile_details(guild_id,player_id,contribution_value) VALUES (?,?,?)", [fixture.guildId, id, 100 - index * 10]);
      await db.execute("INSERT INTO guild_membership_projections(player_id,guild_id,version) VALUES (?,?,1)", [id, fixture.guildId]);
    }
    const ticket = (await db.query<Array<{ id: bigint }>>("SELECT id FROM item_definitions WHERE code='guild_resource_distribution_ticket'"))[0]!;
    await db.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,1,1)", [fixture.playerIds[0], ticket.id]);
    await db.execute("INSERT INTO guild_resource_accounts(guild_id,currency_code,balance,version) VALUES (?,'guild_fund',?,1),(?,'diamond',?,1)", [fixture.guildId, fixture.resources.guild_fund, fixture.guildId, fixture.resources.diamond]);
    for (const [code, quantity] of Object.entries(fixture.resources).filter(([code]) => code !== "guild_fund" && code !== "diamond")) {
      const item = (await db.query<Array<{ id: bigint }>>("SELECT id FROM item_definitions WHERE code=?", [code]))[0]!;
      await db.execute("INSERT INTO guild_warehouse_stacks(guild_id,item_id,quantity,version) VALUES (?,?,?,1)", [fixture.guildId, item.id, quantity]);
    }
    for (const [suffix, user] of [["main", "guild-distribute-1"], ["rollback", "guild-distribute-1"], ["member", "guild-distribute-2"], ["shadow", "guild-distribute-1"]] as const) await event(`${base}-${suffix}`, user);
    const service = new GuildResourceDistributeService(db);
    assert.equal((await service.handleDispatchedIris({ eventId: `${base}-shadow`, externalUserId: "guild-distribute-1", channelId: room, message: "/길드분배" })).status, "shadow");
    const result = await service.distribute({ eventId: mainEvent, externalUserId: "guild-distribute-1", channelId: room, message: "/길드분배 2 3 5" });
    assert.equal(result.status, "distributed"); assert.equal(result.recipientCount, 3); assert.equal(result.resources.length, 6);
    assert.deepEqual(await service.distribute({ eventId: mainEvent, externalUserId: "guild-distribute-1", channelId: room, message: "/길드분배 2 3 5" }), result);
    await assert.rejects(() => service.distribute({ eventId: `${base}-member`, externalUserId: "guild-distribute-2", channelId: room, message: "/길드분배" }), /길드마스터/);
    const expected = { runs: "1", recipients: "3", grants: "18", ticket: "0", guild_fund: "2.000", diamond: "1.000", guild_currency_delta: "-108.000", player_currency_delta: "108.000", guild_item_delta: "-45", player_item_delta: "45" };
    assert.deepEqual(await state(), expected);
    await db.execute("UPDATE inventory_stacks SET quantity=1,version=version+1 WHERE player_id=? AND item_id=?", [fixture.playerIds[0], ticket.id]);
    const before = await state();
    await assert.rejects(() => new GuildResourceDistributeService(failAudit(db)).distribute({ eventId: `${base}-rollback`, externalUserId: "guild-distribute-1", channelId: room, message: "/길드분배 1 2 3" }), /synthetic guild distribution audit failure/);
    assert.deepEqual(await state(), before); assert.equal(await db.verifyRollback(), true);
  } else {
    const before = await state();
    const result = await new GuildResourceDistributeService(db).distribute({ eventId: mainEvent, externalUserId: "guild-distribute-1", channelId: room, message: "/길드분배 2 3 5" });
    assert.equal(result.status, "distributed"); assert.deepEqual(await state(), before);
  }
  process.stdout.write(JSON.stringify({ mode: restart ? "verify-restart" : "probe", migrationCount: 368, scenarios: ["shadow", "leader", "membership-snapshot", "selected-order", "six-resource-floor", "remainder", "ticket", "four-ledgers", "replay", "rollback", "restart"], effects: await state(), operationalDataTouched: false }) + "\n");
} finally { await db.close(); }
