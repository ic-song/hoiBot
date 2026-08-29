import assert from "node:assert/strict";
import { createDatabaseClient } from "../src/database.js";
import { GuildCreateService } from "../src/guild/guild-create-service.js";

const required = (name: string): string => { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; };
const databaseName = required("DATABASE_NAME");
if (!/^hoibot_guild_create_g7(?:_[a-z0-9_]+)?$/i.test(databaseName)) throw new Error("isolated guild-create database is required");
const db = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: process.env.DATABASE_PASSWORD ?? "", name: databaseName, connectionLimit: 8, connectTimeoutMs: 5_000 });
const room = "990000000000358", user = "guild-create-user", startEvent = "guild-create-start", commitEvent = "guild-create-commit", verify = process.argv.includes("--verify-restart");
const service = new GuildCreateService(db);

async function event(id: string, externalUserId = user): Promise<void> { await db.execute("INSERT IGNORE INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('8',64),'processed',UTC_TIMESTAMP(3))", [id,id,room,externalUserId]); }
async function counts(): Promise<Record<string,string>> { const count=async(sql:string)=>(await db.query<Array<{n:bigint}>>(sql))[0]!.n.toString(); return { guilds:await count("SELECT COUNT(*) n FROM guild_creation_runs WHERE action_code='commit'"), memberships:await count("SELECT COUNT(*) n FROM guild_members WHERE player_id IN (358001,358002)"), ledgers:await count("SELECT COUNT(*) n FROM currency_ledger WHERE reason_code='GUILD_CREATE_COST'"), runs:await count("SELECT COUNT(*) n FROM guild_creation_runs"), operations:await count("SELECT COUNT(*) n FROM operations WHERE idempotency_scope IN ('guild.create:358001','guild.create:358002')"), executions:await count("SELECT COUNT(*) n FROM command_executions WHERE command_code LIKE 'GUILD_CREATE_%'"), audits:await count("SELECT COUNT(*) n FROM command_audit WHERE action_code LIKE 'guild.create.%'"), outboxes:await count("SELECT COUNT(*) n FROM outbox_messages WHERE operation_id IN (SELECT operation_id FROM guild_creation_runs)") }; }

try {
  if (!verify) {
    await db.execute("INSERT INTO players(id,status,version) VALUES (358001,'active',1)");
    await db.execute("INSERT INTO player_profiles(player_id,current_display_name,experience,level,version) VALUES (358001,'합성생성자',0,1,1)");
    await db.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (358001,'kakao',?,'합성생성자','linked')", [user]);
    await db.execute("INSERT INTO currency_accounts(player_id,currency_code,balance,version) VALUES (358001,'point',30000000000,1)");
    await db.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) SELECT 358001,id,2,1 FROM item_definitions WHERE code='ITEM-GUILD-CREATE-TICKET'");
    assert.deepEqual(await service.handleIris({ eventId:"guild-create-shadow",externalUserId:user,channelId:room,message:"/길드생성" }), { status:"shadow" });
    assert.deepEqual(await counts(), { guilds:"0",memberships:"0",ledgers:"0",runs:"0",operations:"0",executions:"0",audits:"0",outboxes:"0" });
    await db.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code LIKE 'GUILD_CREATE_%'");
    await event(startEvent); const started=await service.execute({eventId:startEvent,externalUserId:user,channelId:room,message:"/길드생성"}); assert.equal(started.status,"started");
    await event(commitEvent); const created=await service.execute({eventId:commitEvent,externalUserId:user,channelId:room,message:"/길드만들기 합성길드 ⚔"}); assert.equal(created.status,"created");
    const replay=await service.execute({eventId:commitEvent,externalUserId:user,channelId:room,message:"/길드만들기 합성길드 ⚔"}); assert.deepEqual(replay,created);
    const ticket=(await db.query<Array<{quantity:bigint}>>("SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions definition ON definition.id=stack.item_id WHERE stack.player_id=358001 AND definition.code='ITEM-GUILD-CREATE-TICKET'"))[0]!; assert.equal(ticket.quantity,2n);
    const point=(await db.query<Array<{balance:string}>>("SELECT CAST(balance AS CHAR) balance FROM currency_accounts WHERE player_id=358001 AND currency_code='point'"))[0]!; assert.equal(point.balance,"10000000000.000");
    await db.execute("INSERT INTO players(id,status,version) VALUES (358002,'active',1)");
    await db.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (358002,'kakao','guild-create-rollback','롤백','linked')");
    await db.execute("INSERT INTO currency_accounts(player_id,currency_code,balance,version) VALUES (358002,'point',30000000000,1)");
    await db.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) SELECT 358002,id,1,1 FROM item_definitions WHERE code='ITEM-GUILD-CREATE-TICKET'");
    await event("guild-create-rollback-start","guild-create-rollback"); await service.execute({eventId:"guild-create-rollback-start",externalUserId:"guild-create-rollback",channelId:room,message:"/길드생성"});
    await event("guild-create-rollback-commit","guild-create-rollback");
    await db.execute("CREATE TRIGGER fail_guild_create_audit BEFORE INSERT ON command_audit FOR EACH ROW BEGIN IF NEW.action_code='guild.create.commit' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forced guild create audit failure'; END IF; END");
    try { await assert.rejects(() => service.execute({eventId:"guild-create-rollback-commit",externalUserId:"guild-create-rollback",channelId:room,message:"/길드만들기 롤백길드 R"}),/forced guild create audit failure/); } finally { await db.execute("DROP TRIGGER IF EXISTS fail_guild_create_audit"); }
    assert.equal((await db.query<Array<{n:bigint}>>("SELECT COUNT(*) n FROM guild_members WHERE player_id=358002"))[0]!.n,0n);
    const retried=await service.execute({eventId:"guild-create-rollback-commit",externalUserId:"guild-create-rollback",channelId:room,message:"/길드만들기 롤백길드 R"}); assert.equal(retried.status,"created");
    await event("guild-create-cancel"); const cancel=await service.execute({eventId:"guild-create-cancel",externalUserId:user,channelId:room,message:"/길드안만들꼬임"}); assert.equal(cancel.status,"cancelled");
    assert.deepEqual(await counts(),{guilds:"2",memberships:"2",ledgers:"2",runs:"5",operations:"5",executions:"5",audits:"5",outboxes:"5"});
    console.log(JSON.stringify({mode:"probe",migration:"358_guild_create.sql",scenarios:["shadow","start","commit","200억","ticket-possession-only","name-registry","membership","replay","forced-rollback","retry","cancel"],created,state:await counts(),ticket:ticket.quantity.toString(),point:point.balance,operationalDataTouched:false}));
  } else {
    const replay=await service.execute({eventId:commitEvent,externalUserId:user,channelId:room,message:"/길드만들기 합성길드 ⚔"}); assert.equal(replay.status,"created");
    assert.deepEqual(await counts(),{guilds:"2",memberships:"2",ledgers:"2",runs:"5",operations:"5",executions:"5",audits:"5",outboxes:"5"});
    console.log(JSON.stringify({mode:"verify-restart",replay,state:await counts(),additionalMutation:false,operationalDataTouched:false}));
  }
} finally { await db.close(); }
