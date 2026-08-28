import assert from "node:assert/strict";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { loadConfig } from "../src/config.js";
import { ApplicationError } from "../src/shared/application-error.js";
import { GuildJoinService } from "../src/guild/guild-join-service.js";
import { GuildJoinableListReadService } from "../src/guild/guild-joinable-list-read-service.js";
import { MariaGuildJoinRepository } from "../src/guild/maria-guild-join-repository.js";

const config = loadConfig();
if (!config.database.enabled || !/^hoibot_guild_joinable_list(?:_[a-z0-9_]+)?$/i.test(config.database.name)) throw new Error("Guild list probe requires an isolated database.");
const database = createDatabaseClient(config.database);
const viewer = "synthetic-guild-list-viewer";
const room = "synthetic-guild-list-room";
const base = "guild-list-g7-r1";

async function event(id: string): Promise<void> {
  await database.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES(?,?,?,?,'message','incoming',REPEAT('8',64),'processed',UTC_TIMESTAMP(3))", [id, id, room, viewer]);
}

function failAudit(inner: DatabaseClient): DatabaseClient {
  return { ping: () => inner.ping(), query: (sql, params) => inner.query(sql, params), execute: (sql, params) => inner.execute(sql, params),
    verifyRollback: () => inner.verifyRollback(), close: async () => undefined,
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => inner.withTransaction((transaction) => work({
      query: (sql, params) => transaction.query(sql, params), execute: async (sql, params) => {
        if (sql.includes("INSERT INTO command_audit")) throw new Error("synthetic guild list audit failure");
        return transaction.execute(sql, params);
      }
    })) };
}

async function effects(): Promise<Array<{ snapshots: bigint; entries: bigint; operations: bigint; outboxes: bigint; audits: bigint }>> {
  return database.query("SELECT (SELECT COUNT(*) FROM guild_joinable_list_snapshots) snapshots,(SELECT COUNT(*) FROM guild_joinable_list_entries) entries,(SELECT COUNT(*) FROM operations WHERE idempotency_scope IN ('guild.joinable_list.read','guild.join:guild_join_request:990000001')) operations,(SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation ON operation.id=outbox.operation_id WHERE operation.idempotency_scope IN ('guild.joinable_list.read','guild.join:guild_join_request:990000001')) outboxes,(SELECT COUNT(*) FROM command_audit WHERE action_code IN ('guild.joinable_list.read','guild.join.requested')) audits");
}

async function seed(): Promise<void> {
  await database.execute("INSERT INTO players(id,status,version) VALUES(990000001,'active',1),(990000002,'active',1),(990000003,'active',1)");
  await database.execute("INSERT INTO player_profiles(player_id,current_display_name,experience) VALUES(990000001,'목록회원',1000),(990000002,'길드장A',0),(990000003,'길드장B',0)");
  await database.execute("INSERT INTO external_identities(id,player_id,provider_code,external_user_id,display_name,status) VALUES(990200001,990000001,'kakao',?,'목록회원','linked')", [viewer]);
  await database.execute("INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,active,version) VALUES('legacy-guild-join-ticket','길드가입권🍭','consumable',TRUE,TRUE,1) ON DUPLICATE KEY UPDATE active=TRUE,stackable=TRUE");
  await database.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) SELECT 990000001,id,1,1 FROM item_definitions WHERE code='legacy-guild-join-ticket'");
  await database.execute("INSERT INTO guilds(id,code,display_name,status,version,mark,level,join_requirement_experience,max_members,recruitment_bonus) VALUES(990400001,'G-A','동률길드','active',1,'A',10,100,5,0),(990400002,'G-B','동률길드','active',1,'B',10,100,5,0),(990400003,'G-C','마감길드','active',1,'C',99,0,5,0)");
  await database.execute("INSERT INTO guild_join_policies(guild_id,member_join_closed,version) VALUES(990400001,FALSE,1),(990400002,FALSE,1),(990400003,TRUE,1)");
  await database.execute("INSERT INTO guild_members(guild_id,player_id,role_code,joined_at) VALUES(990400001,990000002,'master',UTC_TIMESTAMP(3)),(990400002,990000003,'master',UTC_TIMESTAMP(3))");
}

async function probe(): Promise<void> {
  await seed();
  assert.equal((await database.query<Array<{ rollout_state: string }>>("SELECT rollout_state FROM command_registry WHERE command_code='GUILD_JOINABLE_LIST_READ'"))[0]?.rollout_state, "SHADOW");
  const listEvent = `${base}-list`;
  await event(listEvent);
  const service = new GuildJoinableListReadService(database);
  const listed = await service.handle({ eventId: listEvent, externalUserId: viewer, destinationId: room, message: "/길드목록" });
  assert.equal(listed?.rowCount, 2);
  assert.ok(listed!.data.indexOf("1. 동률길드(A)") < listed!.data.indexOf("2. 동률길드(B)"));
  assert.deepEqual(await service.handle({ eventId: listEvent, externalUserId: viewer, destinationId: room, message: "/길드목록" }), listed);
  await database.execute("UPDATE guilds SET level=99,version=version+1 WHERE id=990400002");
  const joinEvent = `${base}-join`;
  await event(joinEvent);
  const joined = await new GuildJoinService(new MariaGuildJoinRepository(database)).handle({ eventId: joinEvent, externalUserId: viewer, channelId: room, message: "/길드가입 1" });
  assert.equal(joined.guildId, "990400001");
  await database.execute("UPDATE guild_join_policies SET member_join_closed=TRUE,version=version+1 WHERE guild_id=990400001");
  const closedEvent = `${base}-closed`;
  await event(closedEvent);
  await assert.rejects(
    () => new GuildJoinService(new MariaGuildJoinRepository(database)).handle({ eventId: closedEvent, externalUserId: viewer, channelId: room, message: "/길드가입 1" }),
    (error: unknown) => error instanceof ApplicationError && error.code === "GUILD_JOIN_CLOSED"
  );
  await database.execute("UPDATE guild_join_policies SET member_join_closed=FALSE,version=version+1 WHERE guild_id=990400001");
  const rollbackEvent = `${base}-rollback`;
  await event(rollbackEvent);
  const before = await effects();
  await assert.rejects(() => new GuildJoinableListReadService(failAudit(database)).handle({ eventId: rollbackEvent, externalUserId: viewer, destinationId: room, message: "/길드목록" }), /synthetic guild list audit failure/);
  assert.deepEqual(await effects(), before);
  assert.equal(await database.verifyRollback(), true);
  assert.deepEqual((await effects())[0], { snapshots: 1n, entries: 2n, operations: 2n, outboxes: 2n, audits: 2n });
  process.stdout.write(JSON.stringify({ mode: "probe", migrationCount: 275, scenarios: ["shadow","exact","closed-full-filter","stable-gid-tie","master-projection","snapshot-version","list-to-join-pin","live-recheck","replay","rollback"], effects: { snapshots: 1, entries: 2, operations: 2, outboxes: 2, audits: 2 }, operationalDataTouched: false }) + "\n");
}

async function restart(): Promise<void> {
  const before = await effects();
  const result = await new GuildJoinableListReadService(database).handle({ eventId: `${base}-list`, externalUserId: viewer, destinationId: room, message: "/길드목록" });
  assert.equal(result?.rowCount, 2);
  assert.deepEqual(await effects(), before);
  process.stdout.write(JSON.stringify({ mode: "verify-restart", replayStable: true, additionalMutation: false, operationalDataTouched: false }) + "\n");
}

try { if (process.argv.includes("--verify-restart")) await restart(); else await probe(); } finally { await database.close(); }
