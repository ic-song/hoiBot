import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { SpiritAttributeService } from "../src/admin/spirit-attribute-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_spirit_attribute(?:_[a-z0-9_]+)?$/i.test(config.database.name)) throw new Error(`Synthetic spirit attribute probe is blocked for database: ${config.database.name}`);
const base = process.env.SPIRIT_ATTRIBUTE_PROBE_EVENT_ID ?? "spirit-attribute-g7-20260826-r1";
const restart = process.argv.includes("--verify-restart");
const database = createDatabaseClient(config.database);
const service = new SpiritAttributeService(database);

// command_executions와 dispatch 외래 키를 만족하는 비식별 이벤트를 준비합니다.
async function event(id: string, user: string): Promise<void> {
  await database.execute(`INSERT INTO event_inbox
    (event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at)
    VALUES (?,?,'synthetic-spirit-attribute-room',?,'message','incoming',REPEAT('8',64),'processed',UTC_TIMESTAMP(3))
    ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)`, [id,id,user]);
}

// Master, 권한 없는 운영자, 정령 보유 대상의 최소 합성 fixture를 준비합니다.
async function fixtures(): Promise<void> {
  for (const id of [982000001,982000002,982000003]) await database.execute("INSERT INTO players(id,status) VALUES (?,'active')",[id]);
  await database.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (982000001,'속성대상')");
  await database.execute("INSERT INTO player_pets(id,player_id,display_name) VALUES (982000001,982000001,'합성정령펫')");
  await database.execute(`INSERT INTO player_pet_elementals(player_pet_id,display_name,grade_code,grade_display_name,enhancement_level)
    VALUES (982000001,'정령의 알🪺','ELEMENTAL-GRADE-001','수련생',3)`);
  await database.execute(`INSERT INTO external_identities(id,player_id,provider_code,external_user_id,display_name,status) VALUES
    (992000001,982000002,'kakao','spirit-attribute-master','합성 총괄 운영자','linked'),
    (992000002,982000003,'kakao','spirit-attribute-manager','합성 운영자','linked')`);
  await database.execute("INSERT INTO admin_operators(id,login_id,display_name,password_hash,status) VALUES (962000001,'spirit-attribute-master','총괄 운영자','synthetic','active'),(962000002,'spirit-attribute-manager','운영자','synthetic','active')");
  await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (962000001,992000001),(962000002,992000002)");
  await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) SELECT 962000001,id FROM admin_roles WHERE code='super_admin'");
  await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) SELECT 962000002,id FROM admin_roles WHERE code='manager'");
}

// 감사 기록 실패를 주입해 속성 변경 전체 transaction rollback을 검증합니다.
function failAudit(inner: DatabaseClient): DatabaseClient {
  return { ping:()=>inner.ping(),query:(s,p)=>inner.query(s,p),execute:(s,p)=>inner.execute(s,p),verifyRollback:()=>inner.verifyRollback(),close:async()=>undefined,
    withTransaction:<T>(work:(t:DatabaseTransaction)=>Promise<T>)=>inner.withTransaction((t)=>work({query:(s,p)=>t.query(s,p),execute:async(s,p)=>{if(s.includes("INSERT INTO command_audit"))throw new Error("synthetic spirit attribute audit failure");return t.execute(s,p);}})) };
}

try {
  const successEvent=`${base}-success`;
  if (restart) {
    const before=await database.query<Array<{level:bigint;ops:bigint}>>("SELECT enhancement_level level,(SELECT COUNT(*) FROM operations WHERE idempotency_scope='admin.spirit_attribute:962000001' AND idempotency_key=?) ops FROM player_pet_elementals WHERE player_pet_id=982000001",[successEvent]);
    const replay=await service.handleIris({externalUserId:"spirit-attribute-master",channelId:"synthetic-spirit-attribute-room",message:"/정령속성 속성대상 42",eventId:successEvent});
    const after=await database.query<Array<{level:bigint;ops:bigint}>>("SELECT enhancement_level level,(SELECT COUNT(*) FROM operations WHERE idempotency_scope='admin.spirit_attribute:962000001' AND idempotency_key=?) ops FROM player_pet_elementals WHERE player_pet_id=982000001",[successEvent]);
    assert.equal(replay.status,"handled_no_reply"); assert.deepEqual(after,before); assert.deepEqual(after[0],{level:42n,ops:1n});
    process.stdout.write(JSON.stringify({mode:"verify-restart",level:42,operationCount:1,additionalMutation:false,additionalReply:false,operationalDataTouched:false})+"\n");
  } else {
    await fixtures();
    for(const [suffix,user] of [["shadow","spirit-attribute-master"],["usage","spirit-attribute-master"],["success","spirit-attribute-master"],["denied","spirit-attribute-manager"],["missing","spirit-attribute-master"],["rollback","spirit-attribute-master"]]) await event(`${base}-${suffix}`,user);
    const shadow=await service.handleIris({externalUserId:"spirit-attribute-master",channelId:"synthetic-spirit-attribute-room",message:"/정령속성 속성대상 42",eventId:`${base}-shadow`}); assert.equal(shadow.status,"shadow");
    let level=(await database.query<Array<{level:bigint}>>("SELECT enhancement_level level FROM player_pet_elementals WHERE player_pet_id=982000001"))[0]!.level; assert.equal(level,3n);
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='SPIRIT_ATTRIBUTE_EDIT'");
    const usage=await service.handleIris({externalUserId:"spirit-attribute-master",channelId:"synthetic-spirit-attribute-room",message:"/정령속성 속성대상",eventId:`${base}-usage`}); assert.equal(usage.status,"changed"); if(usage.status==="changed") assert.equal(usage.data,"올바른 명령어 형식을 사용해주세요. 예: /정령속성 [유저명] [강화수]");
    const success=await service.handleIris({externalUserId:"spirit-attribute-master",channelId:"synthetic-spirit-attribute-room",message:"/정령속성 속성대상 42",eventId:successEvent}); assert.equal(success.status,"handled_no_reply");
    const replay=await service.handleIris({externalUserId:"spirit-attribute-master",channelId:"synthetic-spirit-attribute-room",message:"/정령속성 속성대상 42",eventId:successEvent}); assert.deepEqual(replay,success);
    const denied=await service.handleIris({externalUserId:"spirit-attribute-manager",channelId:"synthetic-spirit-attribute-room",message:"/정령속성 속성대상 99",eventId:`${base}-denied`}); assert.equal(denied.status,"handled_no_reply");
    const missing=await service.handleIris({externalUserId:"spirit-attribute-master",channelId:"synthetic-spirit-attribute-room",message:"/정령속성 없는대상 7",eventId:`${base}-missing`}); assert.equal(missing.status,"handled_no_reply");
    await assert.rejects(()=>new SpiritAttributeService(failAudit(database)).setLevel({operatorId:"962000001",identityId:"992000001",sourceEventId:`${base}-rollback`,idempotencyKey:`${base}-rollback`,targetName:"속성대상",level:77n}),/synthetic spirit attribute audit failure/);
    const effects=await database.query<Array<{level:bigint;successOps:bigint;successExecutions:bigint;successOutboxes:bigint;deniedOps:bigint;missingOps:bigint;rollbackOps:bigint}>>(`SELECT
      (SELECT enhancement_level FROM player_pet_elementals WHERE player_pet_id=982000001) level,
      (SELECT COUNT(*) FROM operations WHERE idempotency_scope='admin.spirit_attribute:962000001' AND idempotency_key=?) successOps,
      (SELECT COUNT(*) FROM command_executions WHERE event_id=?) successExecutions,
      (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_key=?) successOutboxes,
      (SELECT COUNT(*) FROM operations WHERE idempotency_key=?) deniedOps,
      (SELECT COUNT(*) FROM operations WHERE idempotency_key=?) missingOps,
      (SELECT COUNT(*) FROM operations WHERE idempotency_key=?) rollbackOps`,[successEvent,successEvent,successEvent,`${base}-denied`,`${base}-missing`,`${base}-rollback`]);
    assert.deepEqual(effects[0],{level:42n,successOps:1n,successExecutions:1n,successOutboxes:0n,deniedOps:0n,missingOps:1n,rollbackOps:0n}); assert.equal(await database.verifyRollback(),true);
    process.stdout.write(JSON.stringify({mode:"probe",migrationCount:112,scenarios:["shadow","usage","success-silent","replay","role-denied-silent","missing-target-silent","rollback"],effects:{level:42,successOperation:1,successExecution:1,successOutbox:0,deniedOperation:0,missingOperation:1,rollbackOperation:0},operationalDataTouched:false})+"\n");
  }
} finally { await database.close(); }
