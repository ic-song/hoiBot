import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import fs from "node:fs";
import { describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult, ReadOnlySnapshotTransaction } from "../src/database.js";
import type { IrisKakaoDatabaseSnapshot } from "../src/integration/iris-kakao-database-inspector.js";
import { createEnvironmentContext, verifyStartupDatabaseIdentity } from "../src/runtime/environment-context.js";
import {projectCanonicalPetSkillSeed,type LegacyPetSkillSeedEntry} from "../src/pet/canonical-pet-skill-read-seed.js";

const token = "wave14b-shadow-token";
const roomId = "990000000000762";
interface PostFreeze{sourceHash:string;rows:Array<LegacyPetSkillSeedEntry&{runtimeSourceIndex:number}>}
const baseline=JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/pet-skill-definitions-v2400.json",import.meta.url),"utf8"))as LegacyPetSkillSeedEntry[];
const additions=JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/pet-skill-post-freeze-v2435.json",import.meta.url),"utf8"))as PostFreeze;
const active93=()=>{const rows=[...baseline];for(const addition of[...additions.rows].sort((a,b)=>a.runtimeSourceIndex-b.runtimeSourceIndex))rows.splice(addition.runtimeSourceIndex,0,addition);return rows;};
const readyProjection=projectCanonicalPetSkillSeed(active93(),{S:10.5,A:18.1,B:20,C:47.7},additions.sourceHash);
const readyIds=new Map(readyProjection.definitions.map((row,index)=>[row.sourceKey,`s${String(index).padStart(7,"0")}`]));
const readyDefinitions=readyProjection.definitions.map(row=>({pet_skill_id:readyIds.get(row.sourceKey)!,pet_skill_name:row.source.name,pet_skill_description:row.source.effect,pet_skill_grade:row.source.grade,legacy_source_key:row.sourceKey,display_order:row.displayOrder,base_draw_rate:String(row.source.rate??0),fixed_draw_rate_flag:row.source.fixedRate===true?1:0,openable_flag:row.source.openable!==false?1:0,pet_skill_grade_emoji:"📙",required_tier_name:row.source.requiredTier??null,tier_exclusive_flag:row.source.tierExclusive===true?1:0,equip_description:row.source.equipComment??null,handler_key:row.handlerKey,options_json:row.options,raid_charm_bonus:String(Number(row.source.raidExp??0)),castle_charm_bonus:String(Number(row.source.castleExp??0)),active_flag:1,source_identifier:row.sourceKey,payload_fingerprint:createHash("sha256").update(JSON.stringify([row.source.name,row.source.effect,row.source.grade,row.handlerKey,row.options,true])).digest("hex")}));
const readyAliases=readyProjection.aliases.map((row,index)=>({pet_skill_alias_id:`a${String(index).padStart(7,"0")}`,pet_skill_id:readyIds.get(row.sourceKey)!,source_identifier:row.sourceKey,alias_type:"legacy_name",alias_value:row.aliasValue,normalized_alias_value:row.normalizedAliasValue,active_flag:1}));
const readyPolicies=readyProjection.gradePolicies.map((row,index)=>({pet_skill_draw_grade_policy_id:`p${String(index).padStart(7,"0")}`,pet_skill_grade:row.grade,grade_probability_total:String(row.probabilityTotal),display_order:row.displayOrder,active_flag:1}));

describe("Wave14B pet skill info actual HTTP ingress", () => {
  it("routes only the legacy startsWith family through buildApp.inject and keeps the SHADOW read DML-zero", async () => {
    const trace = createTraceDatabase();
    const context = await verifyStartupDatabaseIdentity(trace.database, createEnvironmentContext({
      environmentCode: "dev",
      databaseIdentity: "wave14b_shadow"
    }));
    const config = loadConfig({
      NODE_ENV: "test", HOIBOT_ENVIRONMENT_CODE: "dev", IRIS_SHARED_TOKEN: token,
      USER_VERIFICATION_PEPPER: "wave14b-shadow-pepper", DATABASE_ENABLED: "true",
      DATABASE_HOST: "127.0.0.1", DATABASE_PORT: "3332", DATABASE_USER: "unused",
      DATABASE_PASSWORD: "unused", DATABASE_NAME: "wave14b_shadow"
    });
    process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = "true";
    const app = buildApp(config, {
      database: trace.database,
      environmentContext: context,
      petSkillInfoReadOnlyRecoveryProvider:trace.recovery as never,
      inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed",
        evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }),
      sendIrisTextReply: async () => { throw new Error("SHADOW_MUST_NOT_SEND"); }
    });
    try {
      const first = await send(app, "info-1", "/펫스킬정보청룡언월도");
      assert.equal(first.statusCode, 202, `${first.body}\nroute=${JSON.stringify(trace.routeMessages)}\nwrites=${JSON.stringify(trace.writes.map(({sql})=>sql.slice(0,80)))}\nsnapshot=${JSON.stringify(trace.snapshotSql)}`);
      assert.equal(trace.snapshotCount, 1);
      assert.equal(trace.infoReply, "청룡언월도📙\n등급: S\n확률: 100.0%\n효과: 삼국지 관우의 전설적인 무기입니다.");
      assert.equal(trace.routeMessages.at(-1), "/펫스킬정보 [조회값]");
      assert.ok(trace.writes.some(({ sql }) => sql.includes("command_routing_decisions")));
      assert.equal(trace.atomicHandlerCount,1);
      assert.ok(trace.snapshotSql.every((sql) => sql.startsWith("SELECT ")));
      assert.ok(trace.writes.every(({ sql }) => !/canonical_pet_skill_(?:definitions|aliases|draw_grade_policies)/.test(sql)));
      assert.ok(trace.writes.every(({ sql }) => !/outbox_messages/.test(sql)));

      assert.equal((await send(app, "info-2", "/펫스킬정보   ")).statusCode, 202);
      assert.equal(trace.infoReply, "사용법:\n/펫스킬정보 [펫스킬이름] — 펫스킬 효과 조회\n/펫스킬정보 [유저닉네임] — 유저 펫스킬가방 조회 (관리자 전용)");
      const beforeSibling = trace.snapshotCount;
      assert.equal((await send(app, "sibling-1", "/펫스킬")).statusCode, 202);
      assert.equal(trace.snapshotCount, beforeSibling);

      assert.equal((await send(app, "long-1", "/펫스킬정보 청룡언월도", "다섯글자임")).statusCode, 202);
      assert.equal(trace.snapshotCount, beforeSibling+1);
      assert.equal((await send(app,"info-1","/펫스킬정보없음")).statusCode,500);assert.equal(trace.atomicHandlerCount,3);
      assert.equal((await send(app, "info-1", "/펫스킬정보청룡언월도")).statusCode, 202);
      assert.equal(trace.snapshotCount, beforeSibling+1);assert.equal(trace.atomicReplayCount,1);assert.equal(trace.atomicHandlerCount,3);
      assert.equal((await send(app,"retry-1","/펫스킬정보청룡언월도")).statusCode,500);assert.equal(trace.atomicHandlerCount,3);assert.equal(trace.failedAttemptCount,1);
      assert.equal((await send(app,"retry-1","/펫스킬정보청룡언월도")).statusCode,202);assert.equal(trace.atomicHandlerCount,4);
      assert.equal(trace.snapshotSql.some(sql=>sql.includes("SELECT DATABASE() database_identity")),false,"DEFAULT must never invoke DEV readiness");
    } finally {
      delete process.env.PARTIAL_COMMAND_DISPATCH_ENABLED;
      await app.close();
    }
  });

  it("bypasses the generic deny only for a verified DirectChat pet-skill-info candidate",async()=>{
    const trace=createTraceDatabase(),context=await verifyStartupDatabaseIdentity(trace.database,createEnvironmentContext({environmentCode:"dev",databaseIdentity:"wave14b_shadow"}));
    const config=loadConfig({NODE_ENV:"test",HOIBOT_ENVIRONMENT_CODE:"dev",IRIS_SHARED_TOKEN:token,USER_VERIFICATION_PEPPER:"private-shadow-pepper",DATABASE_ENABLED:"true",DATABASE_HOST:"127.0.0.1",DATABASE_PORT:"3332",DATABASE_USER:"unused",DATABASE_PASSWORD:"unused",DATABASE_NAME:"wave14b_shadow"});
    process.env.PARTIAL_COMMAND_DISPATCH_ENABLED="true";
    const app=buildApp(config,{database:trace.database,environmentContext:context,petSkillInfoReadOnlyRecoveryProvider:trace.recovery as never,
      inspectIrisKakaoDatabase:async()=>privateSnapshot(),inspectIrisChannel:async()=>({mode:"denied",channelClass:"open_direct",reason:"open_direct_unverified",evidence:{roomType:"DirectChat",linkId:"direct-link"}}),
      sendIrisTextReply:async()=>{throw new Error("SHADOW_MUST_NOT_SEND");}});
    try{
      const accepted=await send(app,"private-info-1","/펫스킬정보청룡언월도");
      assert.equal(accepted.statusCode,202,accepted.body);assert.equal(JSON.parse(accepted.body).ignored,false);assert.equal(trace.atomicHandlerCount,1);
      const denied=await send(app,"private-sibling-1","/펫스킬");
      assert.equal(denied.statusCode,202);assert.equal(JSON.parse(denied.body).ignored,true);assert.equal(trace.atomicHandlerCount,1);
    }finally{delete process.env.PARTIAL_COMMAND_DISPATCH_ENABLED;await app.close();}
  });

  it("returns the persisted normal private denial on first delivery and replay",async()=>{
    const trace=createTraceDatabase("pass_missing"),context=await verifyStartupDatabaseIdentity(trace.database,createEnvironmentContext({environmentCode:"dev",databaseIdentity:"wave14b_shadow"}));
    const config=loadConfig({NODE_ENV:"test",HOIBOT_ENVIRONMENT_CODE:"dev",IRIS_SHARED_TOKEN:token,USER_VERIFICATION_PEPPER:"private-denial-pepper",DATABASE_ENABLED:"true",DATABASE_HOST:"127.0.0.1",DATABASE_PORT:"3332",DATABASE_USER:"unused",DATABASE_PASSWORD:"unused",DATABASE_NAME:"wave14b_shadow"});
    process.env.PARTIAL_COMMAND_DISPATCH_ENABLED="true";
    const app=buildApp(config,{database:trace.database,environmentContext:context,petSkillInfoReadOnlyRecoveryProvider:trace.recovery as never,
      inspectIrisKakaoDatabase:async()=>privateSnapshot(),inspectIrisChannel:async()=>({mode:"denied",channelClass:"open_direct",reason:"open_direct_unverified",evidence:{roomType:"DirectChat",linkId:"direct-link"}}),
      sendIrisTextReply:async()=>{throw new Error("SHADOW_MUST_NOT_SEND");}});
    try{
      const first=await send(app,"private-denied-1","/펫스킬정보");const firstBody=JSON.parse(first.body);
      assert.equal(first.statusCode,202,first.body);assert.equal(firstBody.ignored,true);assert.equal(firstBody.ignoreReason,"PET_SKILL_INFO_PRIVATE_PASS_REQUIRED");
      const replay=await send(app,"private-denied-1","/펫스킬정보");const replayBody=JSON.parse(replay.body);
      assert.equal(replay.statusCode,202,replay.body);assert.equal(replayBody.ignored,true);assert.equal(replayBody.ignoreReason,firstBody.ignoreReason);
      assert.equal(trace.atomicHandlerCount,1);assert.equal(trace.atomicReplayCount,1);assert.equal(trace.infoReply,"");assert.ok(trace.snapshotSql.every(sql=>!sql.includes("canonical_pet_skill_definitions")));
    }finally{delete process.env.PARTIAL_COMMAND_DISPATCH_ENABLED;await app.close();}
  });

  it("keeps private authorization integrity faults visible and only unwraps historical normal-denial failures",async()=>{
    const config=loadConfig({NODE_ENV:"test",HOIBOT_ENVIRONMENT_CODE:"dev",IRIS_SHARED_TOKEN:token,USER_VERIFICATION_PEPPER:"private-integrity-pepper",DATABASE_ENABLED:"true",DATABASE_HOST:"127.0.0.1",DATABASE_PORT:"3332",DATABASE_USER:"unused",DATABASE_PASSWORD:"unused",DATABASE_NAME:"wave14b_shadow"});
    process.env.PARTIAL_COMMAND_DISPATCH_ENABLED="true";
    const inspectIrisChannel=async()=>({mode:"denied" as const,channelClass:"open_direct" as const,reason:"open_direct_unverified" as const,evidence:{roomType:"DirectChat" as const,linkId:"direct-link"}});
    const trace=createTraceDatabase("pass_duplicate"),context=await verifyStartupDatabaseIdentity(trace.database,createEnvironmentContext({environmentCode:"dev",databaseIdentity:"wave14b_shadow"}));
    const app=buildApp(config,{database:trace.database,environmentContext:context,petSkillInfoReadOnlyRecoveryProvider:trace.recovery as never,inspectIrisKakaoDatabase:async()=>privateSnapshot(),inspectIrisChannel,sendIrisTextReply:async()=>{throw new Error("SHADOW_MUST_NOT_SEND");}});
    try{const failed=await send(app,"private-integrity-1","/펫스킬정보");assert.equal(failed.statusCode,500,failed.body);assert.equal(trace.atomicHandlerCount,1);}finally{await app.close();}
    const legacyTrace=createTraceDatabase(),legacyContext=await verifyStartupDatabaseIdentity(legacyTrace.database,createEnvironmentContext({environmentCode:"dev",databaseIdentity:"wave14b_shadow"}));
    const legacyRecovery={execute:async()=>{throw new Error("APP_WIRING_READ_ONLY_PREVIOUSLY_FAILED:PET_SKILL_INFO_PRIVATE_PASS_REQUIRED");}};
    const legacyApp=buildApp(config,{database:legacyTrace.database,environmentContext:legacyContext,petSkillInfoReadOnlyRecoveryProvider:legacyRecovery as never,inspectIrisKakaoDatabase:async()=>privateSnapshot(),inspectIrisChannel,sendIrisTextReply:async()=>{throw new Error("SHADOW_MUST_NOT_SEND");}});
    try{const denied=await send(legacyApp,"private-legacy-denied-1","/펫스킬정보");const body=JSON.parse(denied.body);assert.equal(denied.statusCode,202,denied.body);assert.equal(body.ignored,true);assert.equal(body.ignoreReason,"PET_SKILL_INFO_PRIVATE_PASS_REQUIRED");}finally{delete process.env.PARTIAL_COMMAND_DISPATCH_ENABLED;await legacyApp.close();}
  });

  it("restores the generic DirectChat deny when the exact SHADOW route is not enabled",async()=>{
    const trace=createTraceDatabase(),context=await verifyStartupDatabaseIdentity(trace.database,createEnvironmentContext({environmentCode:"prod",databaseIdentity:"wave14b_shadow"}));
    const config=loadConfig({NODE_ENV:"production",HOIBOT_ENVIRONMENT_CODE:"prod",IRIS_SHARED_TOKEN:token,USER_VERIFICATION_PEPPER:"private-shadow-pepper-production-32",DATABASE_ENABLED:"true",DATABASE_HOST:"127.0.0.1",DATABASE_PORT:"3332",DATABASE_USER:"unused",DATABASE_PASSWORD:"unused",DATABASE_NAME:"wave14b_shadow"});
    delete process.env.PARTIAL_COMMAND_DISPATCH_ENABLED;
    const app=buildApp(config,{database:trace.database,environmentContext:context,petSkillInfoReadOnlyRecoveryProvider:trace.recovery as never,
      inspectIrisKakaoDatabase:async()=>privateSnapshot(),inspectIrisChannel:async()=>({mode:"denied",channelClass:"open_direct",reason:"open_direct_unverified",evidence:{roomType:"DirectChat",linkId:"direct-link"}}),
      sendIrisTextReply:async()=>{throw new Error("SHADOW_MUST_NOT_SEND");}});
    try{
      const denied=await send(app,"private-disabled-1","/펫스킬정보청룡언월도");
      assert.equal(denied.statusCode,202,denied.body);assert.equal(JSON.parse(denied.body).ignored,true);assert.equal(JSON.parse(denied.body).ignoreReason,"open_direct_unverified");assert.equal(trace.atomicHandlerCount,0);
    }finally{await app.close();}
  });

  it("rejects a DEV prefix in prod before creating a durable command receipt",async()=>{
    const trace=createTraceDatabase(),context=await verifyStartupDatabaseIdentity(trace.database,createEnvironmentContext({environmentCode:"prod",databaseIdentity:"wave14b_shadow"}));
    const config=loadConfig({NODE_ENV:"test",HOIBOT_ENVIRONMENT_CODE:"prod",IRIS_SHARED_TOKEN:token,USER_VERIFICATION_PEPPER:"private-shadow-pepper",DATABASE_ENABLED:"true",DATABASE_HOST:"127.0.0.1",DATABASE_PORT:"3332",DATABASE_USER:"unused",DATABASE_PASSWORD:"unused",DATABASE_NAME:"wave14b_shadow"});
    process.env.PARTIAL_COMMAND_DISPATCH_ENABLED="true";
    const app=buildApp(config,{database:trace.database,environmentContext:context,petSkillInfoReadOnlyRecoveryProvider:trace.recovery as never,
      inspectIrisChannel:async()=>({mode:"operational",channelClass:"open_group",reason:"allowed",evidence:{roomType:"OM",openLinkActive:true,openLinkExpired:false}}),
      sendIrisTextReply:async()=>{throw new Error("SHADOW_MUST_NOT_SEND");}});
    try{
      const denied=await send(app,"prod-dev-prefix-1","dev/펫스킬정보");
      assert.equal(denied.statusCode,202,denied.body);assert.equal(JSON.parse(denied.body).ignored,true);assert.equal(JSON.parse(denied.body).ignoreReason,"PET_SKILL_INFO_DEV_ENVIRONMENT_REQUIRED");assert.equal(trace.atomicHandlerCount,0);assert.equal(trace.snapshotSql.length,0);assert.ok(trace.writes.every(({sql})=>!/event_inbox|canonical_app_wiring_operations|command_executions|operations|outbox_messages/.test(sql)));
    }finally{delete process.env.PARTIAL_COMMAND_DISPATCH_ENABLED;await app.close();}
  });

  it("stores exact DEV catalog UNREADY and PARTIAL replies with no outbox and replays the receipt",async()=>{
    const run=async(readiness:"unready"|"partial",eventId:string)=>{
      const trace=createTraceDatabase("allowed",readiness),context=await verifyStartupDatabaseIdentity(trace.database,createEnvironmentContext({environmentCode:"dev",databaseIdentity:"wave14b_shadow"}));
      const config=loadConfig({NODE_ENV:"test",HOIBOT_ENVIRONMENT_CODE:"dev",IRIS_SHARED_TOKEN:token,USER_VERIFICATION_PEPPER:"dev-readiness-pepper",DATABASE_ENABLED:"true",DATABASE_HOST:"127.0.0.1",DATABASE_PORT:"3332",DATABASE_USER:"unused",DATABASE_PASSWORD:"unused",DATABASE_NAME:"wave14b_shadow"});
      process.env.PARTIAL_COMMAND_DISPATCH_ENABLED="true";
      const app=buildApp(config,{database:trace.database,environmentContext:context,petSkillInfoReadOnlyRecoveryProvider:trace.recovery as never,inspectIrisChannel:async()=>({mode:"operational",channelClass:"open_group",reason:"allowed",evidence:{roomType:"OM",openLinkActive:true,openLinkExpired:false}}),sendIrisTextReply:async()=>{throw new Error("SHADOW_MUST_NOT_SEND");}});
      try{const first=await send(app,eventId,"dev/펫스킬정보 청룡언월도");assert.equal(first.statusCode,202,first.body);const exact=readiness==="unready"?"[DEV 테스트환경]\n❌ DEV 펫스킬 카탈로그가 준비되지 않았습니다.\n정의: 0/93\n정의 연결: 0/93\n별칭: 0/30\n확률 정책: 0/4":"[DEV 테스트환경]\n⚠️ DEV 펫스킬 카탈로그가 일부만 준비되었습니다.\n정의: 92/93\n정의 연결: 92/93\n별칭: 29/30\n확률 정책: 3/4";assert.equal(trace.infoReply,exact);assert.ok(trace.snapshotSql.every(sql=>sql.startsWith("SELECT ")));assert.ok(trace.writes.every(({sql})=>!/canonical_pet_skill_|outbox_messages/.test(sql)));const before=trace.snapshotSql.length;assert.equal((await send(app,eventId,"dev/펫스킬정보 청룡언월도")).statusCode,202);assert.equal(trace.snapshotSql.length,before);assert.equal(trace.atomicHandlerCount,1);assert.equal(trace.atomicReplayCount,1);}finally{delete process.env.PARTIAL_COMMAND_DISPATCH_ENABLED;await app.close();}
    };
    await run("unready","dev-readiness-empty-1");await run("partial","dev-readiness-partial-1");
  });

  it("executes actual full-93 READY through buildApp, resolves a canonical alias exactly, and replays without a new snapshot",async()=>{
    const trace=createTraceDatabase("allowed","ready"),context=await verifyStartupDatabaseIdentity(trace.database,createEnvironmentContext({environmentCode:"dev",databaseIdentity:"wave14b_shadow"}));
    const config=loadConfig({NODE_ENV:"test",HOIBOT_ENVIRONMENT_CODE:"dev",IRIS_SHARED_TOKEN:token,USER_VERIFICATION_PEPPER:"dev-ready-full-pepper",DATABASE_ENABLED:"true",DATABASE_HOST:"127.0.0.1",DATABASE_PORT:"3332",DATABASE_USER:"unused",DATABASE_PASSWORD:"unused",DATABASE_NAME:"wave14b_shadow"});
    process.env.PARTIAL_COMMAND_DISPATCH_ENABLED="true";
    const app=buildApp(config,{database:trace.database,environmentContext:context,petSkillInfoReadOnlyRecoveryProvider:trace.recovery as never,inspectIrisChannel:async()=>({mode:"operational",channelClass:"open_group",reason:"allowed",evidence:{roomType:"OM",openLinkActive:true,openLinkExpired:false}}),sendIrisTextReply:async()=>{throw new Error("SHADOW_MUST_NOT_SEND");}});
    try{
      const message="dev/펫스킬정보 엠퍼러의 천공 날개",first=await send(app,"dev-readiness-ready-1",message);
      assert.equal(first.statusCode,202,first.body);
      assert.equal(trace.infoReply,"[DEV 테스트환경]\n🪽 엠퍼러의 천공 날개📙\n등급: C\n확률: 1.2%\n효과: 엠퍼러 티어부터 장착할 수 있습니다.\n장착 시 레이드/캐슬 매력 각각 10만 증가합니다.\n종합매력 20만 증가\n티어전용 펫스킬 중복 장착은 불가합니다.\n일반 종합매력 무기 펫스킬과는 중복 장착할 수 있습니다.");
      assert.ok(trace.snapshotSql.every(sql=>sql.startsWith("SELECT ")));assert.ok(trace.writes.every(({sql})=>!/canonical_pet_skill_|outbox_messages/.test(sql)));
      const before=trace.snapshotSql.length;assert.equal((await send(app,"dev-readiness-ready-1",message)).statusCode,202);assert.equal(trace.snapshotSql.length,before);assert.equal(trace.atomicHandlerCount,1);assert.equal(trace.atomicReplayCount,1);
    }finally{delete process.env.PARTIAL_COMMAND_DISPATCH_ENABLED;await app.close();}
  });

  it("fails closed on verified-environment versus snapshot database drift",async()=>{
    const trace=createTraceDatabase("allowed","drift"),context=await verifyStartupDatabaseIdentity(trace.database,createEnvironmentContext({environmentCode:"dev",databaseIdentity:"wave14b_shadow"}));
    const config=loadConfig({NODE_ENV:"test",HOIBOT_ENVIRONMENT_CODE:"dev",IRIS_SHARED_TOKEN:token,USER_VERIFICATION_PEPPER:"dev-ready-drift-pepper",DATABASE_ENABLED:"true",DATABASE_HOST:"127.0.0.1",DATABASE_PORT:"3332",DATABASE_USER:"unused",DATABASE_PASSWORD:"unused",DATABASE_NAME:"wave14b_shadow"});process.env.PARTIAL_COMMAND_DISPATCH_ENABLED="true";
    const app=buildApp(config,{database:trace.database,environmentContext:context,petSkillInfoReadOnlyRecoveryProvider:trace.recovery as never,inspectIrisChannel:async()=>({mode:"operational",channelClass:"open_group",reason:"allowed",evidence:{roomType:"OM",openLinkActive:true,openLinkExpired:false}}),sendIrisTextReply:async()=>{throw new Error("SHADOW_MUST_NOT_SEND");}});
    try{const failed=await send(app,"dev-readiness-drift-1","dev/펫스킬정보 엠퍼러의 천공 날개");assert.equal(failed.statusCode,500,failed.body);assert.equal(trace.infoReply,"");assert.equal(trace.atomicReplayCount,0);assert.ok(trace.writes.every(({sql})=>!/canonical_pet_skill_|outbox_messages/.test(sql)));}finally{delete process.env.PARTIAL_COMMAND_DISPATCH_ENABLED;await app.close();}
  });
});

function send(app: ReturnType<typeof buildApp>, id: string, message: string, sender = "호이 남") {
  return app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`,
    payload: { msg: message, room: "Wave14B 펫스킬방", sender,
      json: { _id: id, chat_id: roomId, user_id: "wave14b-user" } } });
}

function privateSnapshot():IrisKakaoDatabaseSnapshot{return{nickname:"호이 남",nicknameSource:"open_chat_member",subjectUserId:"wave14b-user",roomName:"Wave14B 펫스킬방",roomNameSource:"chat_room_meta",db2IdentityTables:{rows:[]},chatLog:{rows:[]},targetChatLog:{rows:[]},chatRoom:{rows:[]},openChatMember:{rows:[]},friend:{rows:[]},openLink:{rows:[]}};}

function createTraceDatabase(privateAccess:"allowed"|"identity_missing"|"pass_missing"|"pass_duplicate"="allowed",readiness?:"unready"|"partial"|"ready"|"drift") {
  let nextId = 1n;
  const events = new Set<string>();
  const writes: Array<{ sql: string; values: readonly unknown[] }> = [];
  const routeMessages: string[] = [];
  const snapshotSql: string[] = [];
  let snapshotCount = 0;
  let infoReply = "";
  let atomicHandlerCount=0,atomicReplayCount=0;
  const atomicReceipts=new Map<string,{message:string;projection:unknown}>();const failedOnce=new Set<string>();
  const write = async (sql: string, values: readonly unknown[] = []): Promise<DatabaseWriteResult> => {
    writes.push({ sql, values });
    if (sql.includes("INSERT INTO event_inbox")) {
      const eventId = String(values[0]);
      if (events.has(eventId)) throw Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" });
      events.add(eventId);
    }
    return { affectedRows: 1n, insertId: nextId++ };
  };
  const transaction: DatabaseTransaction = {
    execute: write,
    query: async <T>(sql: string): Promise<T> => {
      if (sql.includes("SELECT id FROM channels")) return [{ id: 11n }] as T;
      if (sql.includes("SELECT id FROM external_identities")) return [{ id: 12n }] as T;
      return [] as T;
    }
  };
  const snapshot: ReadOnlySnapshotTransaction = { query: async <T>(sql: string): Promise<T> => {
    snapshotSql.push(sql);
    if(sql.includes("SELECT DATABASE() database_identity")){if(readiness===undefined)throw new Error("UNEXPECTED_READINESS_QUERY");const counts=readiness==="unready"?{definitions:0n,imports:0n,aliases:0n,policies:0n}:readiness==="partial"?{definitions:92n,imports:92n,aliases:29n,policies:3n}:{definitions:93n,imports:93n,aliases:30n,policies:4n};return[{database_identity:readiness==="drift"?"another_database":"wave14b_shadow",...counts}]as T;}
    if (sql.includes("identity.status identity_status")) return (privateAccess==="identity_missing"?[]:[{identity_id:12n,player_id:21n,identity_status:"linked",player_status:"active"}]) as T;
    if (sql.includes("SELECT DATE_FORMAT(UTC_TIMESTAMP")) return [{kst_today:"2026-09-07"}] as T;
    if (sql.includes("FROM player_support_passes pass")) return (privateAccess==="pass_missing"?[]:privateAccess==="pass_duplicate"?[{pass_id:31n,pass_code:"hoi",entitlement_kind:"permanent",end_date:null,pass_status:"active",definition_active:1},{pass_id:32n,pass_code:"hoi",entitlement_kind:"permanent",end_date:null,pass_status:"active",definition_active:1}]:[{pass_id:31n,pass_code:"hoi",entitlement_kind:"permanent",end_date:null,pass_status:"active",definition_active:1}]) as T;
    if (sql.includes("SELECT id external_identity_id FROM external_identities")) return [{external_identity_id:12n}] as T;
    if (sql.includes("FROM private_chat_denial_notification_channels")) return [] as T;
    if (sql.includes("FROM external_identities identity")) return [{ player_status: "active", identity_id:12n }] as T;
    if (sql.includes("FROM player_profiles profile")) return [] as T;
    if(readiness==="ready"&&sql.includes("SELECT definition.pet_skill_id"))return readyDefinitions as T;
    if(readiness==="ready"&&sql.includes("SELECT import_row.source_identifier,alias_row.alias_type"))return readyAliases as T;
    if(readiness==="ready"&&sql.startsWith("SELECT pet_skill_grade"))return readyPolicies as T;
    if (sql.includes("FROM canonical_pet_skill_aliases")) return (readiness==="ready"?readyAliases:[]) as T;
    if (sql.includes("FROM canonical_pet_skill_draw_grade_policies")) return (readiness==="ready"?readyPolicies:[]) as T;
    if (sql.includes("CAST(raid_charm_bonus")) return (readiness==="ready"?readyDefinitions.map(row=>({pet_skill_id:row.pet_skill_id,raid_charm_bonus:row.raid_charm_bonus,castle_charm_bonus:row.castle_charm_bonus})):[{ pet_skill_id: "skill001", raid_charm_bonus: "0", castle_charm_bonus: "0" }]) as T;
    if(readiness==="ready"&&sql.includes("FROM canonical_pet_skill_definitions"))return readyDefinitions as T;
    if (sql.includes("FROM canonical_pet_skill_definitions")) return [{
      pet_skill_id: "skill001", pet_skill_name: "청룡언월도", pet_skill_description: "삼국지 관우의 전설적인 무기입니다.",
      pet_skill_grade: "S", legacy_source_key: "skill_000", display_order: 1, base_draw_rate: "100",
      fixed_draw_rate_flag: 1, openable_flag: 1, pet_skill_grade_emoji: "📙", required_tier_name: null,
      tier_exclusive_flag: 0, equip_description: null, handler_key: "presentation_only", options_json: {}, active_flag: 1
    }] as T;
    throw new Error(`UNEXPECTED_SNAPSHOT_SQL:${sql}`);
  }};
  const recovery={execute:async(input:any)=>{const prior=atomicReceipts.get(input.event.eventId);if(prior!==undefined){if(prior.message!==input.replyIdentity.message)throw new Error("APP_WIRING_READ_ONLY_PAYLOAD_MISMATCH");input.validateReceiptProjection?.(prior.projection);atomicReplayCount+=1;const denied=(prior.projection as {version?:string}).version==="PET_SKILL_INFO_PRIVATE_DENIAL_RECEIPT_V1";return{status:"completed",replayed:true,terminalStatus:denied?"SHADOW_DENIED":"SHADOW_EVALUATED",resultFingerprint:"f".repeat(64),receiptProjection:prior.projection,processing:{duplicate:true,replies:[]}};}if(input.event.eventId==="iris:retry-1"&&!failedOnce.has("iris:retry-1")){failedOnce.add("iris:retry-1");throw new Error("SYNTHETIC_FAILED_RECEIPT");}snapshotCount+=1;atomicHandlerCount+=1;const evaluated=await input.evaluateInSnapshot(snapshot);input.validateReceiptProjection?.(evaluated.receiptProjection);if(evaluated.value&&typeof evaluated.value==="object"&&"reply" in evaluated.value)infoReply=String(evaluated.value.reply);atomicReceipts.set(input.event.eventId,{message:input.replyIdentity.message,projection:evaluated.receiptProjection});return{status:"completed",replayed:false,terminalStatus:evaluated.terminalStatus??"SHADOW_EVALUATED",resultFingerprint:"f".repeat(64),receiptProjection:evaluated.receiptProjection,value:evaluated.value,processing:{duplicate:false,replies:[]}};}};
  const database: DatabaseClient = {
    ping: async () => undefined,
    verifyRollback: async () => true,
    close: async () => undefined,
    execute: write,
    query: async <T>(sql: string, values: readonly unknown[] = []): Promise<T> => {
      if (sql === "SELECT DATABASE() AS database_identity") return [{ database_identity: "wave14b_shadow" }] as T;
      if (sql.includes("FROM command_aliases a")) {
        routeMessages.push(String(values[0]));
        if (String(values[0]).startsWith("/펫스킬정보")) return [{ command_code: "PET_SKILL_INFO", handler_key: "pet_skill_info", auth_scope: "VERIFIED_USER", rollout_state: "SHADOW" }] as T;
        return [] as T;
      }
      return [] as T;
    },
    withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(transaction),
    withReadOnlySnapshot: async <T>(work: (value: ReadOnlySnapshotTransaction) => Promise<T>) => {
      snapshotCount += 1;
      const result = await work(snapshot);
      if (result && typeof result === "object" && "reply" in result) infoReply = String((result as { reply: unknown }).reply);
      return result;
    },
    withControlledTransaction: async <T>(work: (value: DatabaseTransaction & { withSavepoint<R>(nested: (value: DatabaseTransaction) => Promise<R>): Promise<R> }) => Promise<T>) => {
      const controlled = { ...transaction, withSavepoint: async <R>(nested: (value: DatabaseTransaction) => Promise<R>) => nested(transaction) };
      return work(controlled);
    }
  } as DatabaseClient;
  return { database,recovery, writes, routeMessages, snapshotSql,
    get snapshotCount() { return snapshotCount; }, get infoReply() { return infoReply; },get atomicHandlerCount(){return atomicHandlerCount;},get atomicReplayCount(){return atomicReplayCount;},get failedAttemptCount(){return failedOnce.size;} };
}
