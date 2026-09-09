import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { GuildContributionApplyService } from "../src/guild/guild-contribution-apply-service.js";

const config = loadConfig();
if (!config.database.enabled || !/^hoibot_guild_contribution_apply(?:_[a-z0-9_]+)?$/i.test(config.database.name)) throw new Error(`Blocked database: ${config.database.name}`);
const database = createDatabaseClient(config.database);
const base = process.env.GUILD_CONTRIBUTION_EVENT_ID ?? "guild-contribution-v2400-g7-r1";
const restart = process.argv.includes("--verify-restart");
const room = "guild-contribution-origin";
const input = (suffix: string, user: string, message: string) => ({ eventId: `${base}-${suffix}`, externalUserId: user, channelId: room, message });
async function event(suffix: string, user: string): Promise<void> { const eventId = `${base}-${suffix}`; await database.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('9',64),'processed',UTC_TIMESTAMP(3))", [eventId, eventId, room, user]); }

function failAudit(inner: DatabaseClient): DatabaseClient { return { ping: () => inner.ping(), query: (sql, params) => inner.query(sql, params), execute: (sql, params) => inner.execute(sql, params), verifyRollback: () => inner.verifyRollback(), close: async () => undefined, withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => inner.withTransaction(transaction => work({ query: (sql, params) => transaction.query(sql, params), execute: async (sql, params) => { if (sql.includes("INSERT INTO command_audit")) throw new Error("synthetic guild contribution audit failure"); return transaction.execute(sql, params); } })) }; }
async function snapshot() { return (await database.query<Array<{ operations: bigint; executions: bigint; audits: bigint; outboxes: bigint; runs: bigint; ledgers: bigint; medal: bigint; food: bigint; draw: bigint; furniture: bigint; experience: bigint; level_value: bigint }>>(`SELECT (SELECT COUNT(*) FROM operations WHERE idempotency_key LIKE ?) operations,(SELECT COUNT(*) FROM command_executions WHERE event_id LIKE ?) executions,(SELECT COUNT(*) FROM command_audit audit JOIN operations operation ON operation.id=audit.operation_id WHERE operation.idempotency_key LIKE ?) audits,(SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation ON operation.id=outbox.operation_id WHERE operation.idempotency_key LIKE ?) outboxes,(SELECT COUNT(*) FROM guild_contribution_runs run JOIN operations operation ON operation.id=run.operation_id WHERE operation.idempotency_key LIKE ?) runs,(SELECT COUNT(*) FROM guild_contribution_ledger ledger JOIN operations operation ON operation.id=ledger.operation_id WHERE operation.idempotency_key LIKE ?) ledgers,(SELECT quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=989910011 AND item.code='guild_contribution_medal') medal,(SELECT quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=989910011 AND item.code='pet_food') food,(SELECT quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=989910011 AND item.code='mini_pet_draw') draw,(SELECT quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=989910011 AND item.code='furniture_draw') furniture,(SELECT experience FROM guild_progression_states WHERE guild_id=989910001) experience,(SELECT level FROM guild_progression_states WHERE guild_id=989910001) level_value`, Array(6).fill(`${base}-%`)))[0]!; }
const expected = { operations: 1n, executions: 1n, audits: 1n, outboxes: 1n, runs: 1n, ledgers: 1n, medal: 3500n, food: 7500n, draw: 4500n, furniture: 3000n, experience: 1500n, level_value: 2 };

try {
  if (!restart) {
    await database.execute("INSERT INTO guilds(id,code,display_name,status) VALUES (989910001,'synthetic-contribution-guild','공헌 길드','active')");
    await database.execute("INSERT INTO players(id,status) VALUES (989910011,'active'),(989910012,'active')");
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (989910011,'공헌 회원'),(989910012,'동료 회원')");
    await database.execute("INSERT INTO external_identities(provider_code,external_user_id,player_id,status) VALUES ('kakao','guild-contribution-user',989910011,'linked'),('kakao','guild-contribution-peer',989910012,'linked')");
    await database.execute("INSERT INTO guild_members(guild_id,player_id,role_code) VALUES (989910001,989910011,'member'),(989910001,989910012,'member')");
    const medal = (await database.query<Array<{ id: bigint }>>("SELECT id FROM item_definitions WHERE code='guild_contribution_medal'"))[0]!;
    await database.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (989910011,?,5000,1)", [medal.id]);
    await event("dispatch-shadow", "guild-contribution-user");
    await event("contribute", "guild-contribution-user");
    await event("rollback", "guild-contribution-user");
    const service = new GuildContributionApplyService(database, () => 0.5);
    assert.equal((await service.handleDispatchedIris(input("dispatch-shadow", "guild-contribution-user", "/길드공헌 1"))).status, "shadow");
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='GUILD_CONTRIBUTION_APPLY'");
    const result = await service.handle(input("contribute", "guild-contribution-user", "/길드공헌 1500"));
    assert.equal(result!.guildLevelAfter, 2);
    assert.deepEqual(result!.reachedLevels, [2]);
    assert.deepEqual(await service.handle(input("contribute", "guild-contribution-user", "/길드공헌 1500")), result);
    await assert.rejects(() => new GuildContributionApplyService(failAudit(database), () => 0.5).handle(input("rollback", "guild-contribution-user", "/길드공헌 10")), /synthetic guild contribution audit failure/);
    assert.deepEqual(await snapshot(), expected);
    assert.equal(await database.verifyRollback(), true);
  } else {
    const before = await snapshot();
    await new GuildContributionApplyService(database, () => 0.5).handle(input("contribute", "guild-contribution-user", "/길드공헌 1500"));
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(before, expected);
  }
  process.stdout.write(JSON.stringify({ mode: restart ? "verify-restart" : "probe", sourceContract: "v2.400", scenarios: ["exact-guard", "dispatch", "atomic-rewards", "level-policy", "replay", "rollback", "restart"], effects: await snapshot(), operationalDataTouched: false }, (_key, value) => typeof value === "bigint" ? Number(value) : value) + "\n");
} finally { await database.close(); }
