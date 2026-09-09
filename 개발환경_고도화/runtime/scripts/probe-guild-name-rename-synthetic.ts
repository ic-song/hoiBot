import assert from "node:assert/strict";
import { createDatabaseClient } from "../src/database.js";
import { GuildNameRenameService } from "../src/guild/guild-name-rename-service.js";

const required=(name:string):string=>{const value=process.env[name];if(!value)throw new Error(`${name} is required`);return value;};
const databaseName=required("DATABASE_NAME");
if(!/^hoibot_guild_name_rename_g7(?:_[a-z0-9_]+)?$/i.test(databaseName))throw new Error("isolated guild-name-rename database is required");
const db=createDatabaseClient({enabled:true,host:required("DATABASE_HOST"),port:Number(required("DATABASE_PORT")),user:required("DATABASE_USER"),password:process.env.DATABASE_PASSWORD??"",name:databaseName,connectionLimit:8,connectTimeoutMs:5_000});
const verify=process.argv.includes("--verify-restart"),room="990000000000342",ticketCode="ITEM-GUILD-NAME-RENAME-TICKET",normalEvent="guild-name-rename-normal";
const service=new GuildNameRenameService(db);

async function event(eventId:string,externalUserId:string):Promise<void>{await db.execute("INSERT IGNORE INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('3',64),'processed',UTC_TIMESTAMP(3))",[eventId,eventId,room,externalUserId]);}
async function fixture(index:number,name:string,role="master",tickets=1):Promise<{guildId:bigint;playerId:bigint;externalId:string}>{
  const guildId=342000n+BigInt(index),playerId=343000n+BigInt(index),externalId=`guild-rename-user-${index}`;
  await db.execute("INSERT INTO guilds(id,code,display_name,status,mark,version) VALUES (?,?,?,'active','R',1)",[guildId,`GUILD-RENAME-${index}`,name]);
  await db.execute("INSERT INTO guild_name_registry(guild_id,normalized_name,display_name,version) VALUES (?,?,?,1)",[guildId,name.normalize("NFC"),name]);
  await db.execute("INSERT INTO players(id,status,version) VALUES (?,'active',1)",[playerId]);
  await db.execute("INSERT INTO player_profiles(player_id,current_display_name,experience,version) VALUES (?,?,0,1)",[playerId,`합성회원${index}`]);
  await db.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,?,'linked')",[playerId,externalId,`합성회원${index}`]);
  await db.execute("INSERT INTO guild_members(guild_id,player_id,role_code,joined_at) VALUES (?,?,?,UTC_TIMESTAMP(3))",[guildId,playerId,role]);
  if(tickets>0)await db.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) SELECT ?,id,?,1 FROM item_definitions WHERE code=?",[playerId,tickets,ticketCode]);
  return {guildId,playerId,externalId};
}
// 길드 미가입 권한 경계를 검증할 player identity fixture를 만듭니다.
async function identityFixture(index:number):Promise<{playerId:bigint;externalId:string}>{
  const playerId=344000n+BigInt(index),externalId=`guild-rename-no-guild-${index}`;
  await db.execute("INSERT INTO players(id,status,version) VALUES (?,'active',1)",[playerId]);
  await db.execute("INSERT INTO player_profiles(player_id,current_display_name,experience,version) VALUES (?,?,0,1)",[playerId,`미가입회원${index}`]);
  await db.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,?,'linked')",[playerId,externalId,`미가입회원${index}`]);
  return {playerId,externalId};
}
async function state():Promise<Record<string,string>>{
  const one=async(sql:string,params:unknown[]=[])=>(await db.query<Array<{count_value:bigint}>>(sql,params))[0]!.count_value.toString();
  return {renames:await one("SELECT COUNT(*) count_value FROM guild_name_rename_operations"),ledgers:await one("SELECT COUNT(*) count_value FROM inventory_ledger WHERE reason_code='GUILD_NAME_RENAME_TICKET_CONSUME'"),operations:await one("SELECT COUNT(*) count_value FROM operations WHERE idempotency_scope LIKE 'guild.name.rename:%'"),executions:await one("SELECT COUNT(*) count_value FROM command_executions WHERE command_code='GUILD_NAME_RENAME'"),audits:await one("SELECT COUNT(*) count_value FROM command_audit WHERE action_code='guild.name.rename'"),outboxes:await one("SELECT COUNT(*) count_value FROM outbox_messages WHERE operation_id IN (SELECT operation_id FROM guild_name_rename_operations)"),tickets:await one("SELECT COALESCE(SUM(stack.quantity),0) count_value FROM inventory_stacks stack JOIN item_definitions definition ON definition.id=stack.item_id WHERE definition.code=?",[ticketCode])};
}

try{
  if(!verify){
    const normal=await fixture(1,"기존길드일"),noTicket=await fixture(2,"기존길드이",undefined,0),member=await fixture(3,"기존길드삼","member",1),duplicate=await fixture(4,"중복길드",undefined,1),duplicateOwner=await fixture(5,"기존길드오",undefined,1),concurrentA=await fixture(6,"기존길드육",undefined,1),concurrentB=await fixture(7,"기존길드칠",undefined,1),rollback=await fixture(8,"기존길드팔",undefined,1),noGuild=await identityFixture(9);
    await event("guild-name-rename-shadow",normal.externalId);
    assert.deepEqual(await service.handleIris({eventId:"guild-name-rename-shadow",externalUserId:normal.externalId,channelId:room,message:"/길드이름변경 그림자길드"}),{status:"shadow"});
    await db.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='GUILD_NAME_RENAME'");
    await event(normalEvent,normal.externalId);
    const result=await service.rename({eventId:normalEvent,externalUserId:normal.externalId,channelId:room,message:"/길드이름변경 새길드일"});
    const replay=await service.rename({eventId:normalEvent,externalUserId:normal.externalId,channelId:room,message:"/길드이름변경 새길드일"});
    assert.equal(replay.outboxId,result.outboxId);
    await event("guild-name-rename-no-ticket",noTicket.externalId);await assert.rejects(()=>service.rename({eventId:"guild-name-rename-no-ticket",externalUserId:noTicket.externalId,channelId:room,message:"/길드이름변경 새길드이"}),/변경권/);
    await event("guild-name-rename-no-guild",noGuild.externalId);await assert.rejects(()=>service.rename({eventId:"guild-name-rename-no-guild",externalUserId:noGuild.externalId,channelId:room,message:"/길드이름변경 미가입길드"}),/길드 정보를/);
    await event("guild-name-rename-member",member.externalId);await assert.rejects(()=>service.rename({eventId:"guild-name-rename-member",externalUserId:member.externalId,channelId:room,message:"/길드이름변경 새길드삼"}),/길드장만/);
    await event("guild-name-rename-same",duplicate.externalId);await assert.rejects(()=>service.rename({eventId:"guild-name-rename-same",externalUserId:duplicate.externalId,channelId:room,message:"/길드이름변경 중복길드"}),/현재 길드 이름과 같습니다/);
    await event("guild-name-rename-duplicate",duplicateOwner.externalId);await assert.rejects(()=>service.rename({eventId:"guild-name-rename-duplicate",externalUserId:duplicateOwner.externalId,channelId:room,message:"/길드이름변경 중복길드"}),/사용 중/);
    await event("guild-name-rename-concurrent-a",concurrentA.externalId);await event("guild-name-rename-concurrent-b",concurrentB.externalId);
    const concurrent=await Promise.allSettled([service.rename({eventId:"guild-name-rename-concurrent-a",externalUserId:concurrentA.externalId,channelId:room,message:"/길드이름변경 동시길드"}),service.rename({eventId:"guild-name-rename-concurrent-b",externalUserId:concurrentB.externalId,channelId:room,message:"/길드이름변경 동시길드"})]);
    assert.equal(concurrent.filter(value=>value.status==="fulfilled").length,1);
    await event("guild-name-rename-rollback",rollback.externalId);
    await db.execute("CREATE TRIGGER fail_guild_name_rename_audit BEFORE INSERT ON command_audit FOR EACH ROW BEGIN IF NEW.action_code='guild.name.rename' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forced guild name rename audit failure'; END IF; END");
    try{await assert.rejects(()=>service.rename({eventId:"guild-name-rename-rollback",externalUserId:rollback.externalId,channelId:room,message:"/길드이름변경 재시도길드"}),/forced guild name rename audit failure/);}finally{await db.execute("DROP TRIGGER IF EXISTS fail_guild_name_rename_audit");}
    const rollbackGuild=(await db.query<Array<{display_name:string}>>("SELECT display_name FROM guilds WHERE id=?",[rollback.guildId]))[0]!;assert.equal(rollbackGuild.display_name,"기존길드팔");
    await service.rename({eventId:"guild-name-rename-rollback",externalUserId:rollback.externalId,channelId:room,message:"/길드이름변경 재시도길드"});
    const snapshot=await state();assert.deepEqual(snapshot,{renames:"3",ledgers:"3",operations:"3",executions:"3",audits:"3",outboxes:"3",tickets:"4"});
    console.log(JSON.stringify({mode:"probe",migration:"342_guild_name_rename.sql",scenarios:["shadow","broad-boundary","leader-only","ticket-required","normalized-unique","duplicate","concurrent-single-winner","registry-swap","ticket-ledger","idempotent-replay","rollback","retry"],result,state:snapshot,operationalDataTouched:false}));
  }else{
    const replay=await service.rename({eventId:normalEvent,externalUserId:"guild-rename-user-1",channelId:room,message:"/길드이름변경 새길드일"});
    const snapshot=await state();assert.deepEqual(snapshot,{renames:"3",ledgers:"3",operations:"3",executions:"3",audits:"3",outboxes:"3",tickets:"4"});
    console.log(JSON.stringify({mode:"verify-restart",replay,state:snapshot,additionalMutation:false,operationalDataTouched:false}));
  }
}finally{await db.close();}
