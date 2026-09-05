import assert from "node:assert/strict";
import { readdirSync,readFileSync } from "node:fs";
import { describe,it } from "node:test";
import mariadb from "mariadb";

import { dispatchPetTitleCommand } from "../src/app.js";
import { MariaPlayerContextProvider } from "../src/account-platform/player-context-provider.js";
import { createDatabaseClient,type CapableDatabaseClient,type ControlledDatabaseTransaction } from "../src/database.js";
import { CommandDispatcher,MariaCommandRouteReader } from "../src/dispatch/command-dispatcher.js";
import { MariaAppWiringOperationProvider } from "../src/dispatch/app-wiring-operation-provider.js";
import type { NormalizedIrisEvent } from "../src/integration/iris-normalizer.js";
import { PetTitleAppWiringIngress,PetTitleShadowEvaluator,PetTitleShadowReadAuthorityProvider } from "../src/pet/pet-title-app-wiring-ingress.js";
import { PetTitleCanonicalReadProvider } from "../src/pet/pet-title-canonical-read-provider.js";
import { PetTitleCanonicalMutationProvider } from "../src/pet/pet-title-canonical-mutation-provider.js";
import { createEnvironmentContext,verifyStartupDatabaseIdentity } from "../src/runtime/environment-context.js";

const phase=process.env.PET_TITLE_SALE_MARIADB_PHASE;
const enabled=phase==="prepare"||phase==="restart-rollback";
const migrationRoot=new URL("../migrations/",import.meta.url);
const migration471=readFileSync(new URL("471_pet_title_sale_app_wiring.sql",migrationRoot),"utf8");
const rollback471=readFileSync(new URL("rollback/471_pet_title_sale_app_wiring.rollback.sql",migrationRoot),"utf8");
const eventIds=["ptsale-ready","ptsale-pending","ptsale-silent","ptsale-fault","ptsale-lock","ptsale-shadow"];

async function rawConnection(){return mariadb.createConnection({host:process.env.DATABASE_HOST??"127.0.0.1",port:Number(process.env.DATABASE_PORT??"3324"),user:process.env.DATABASE_USER??"root",password:process.env.DATABASE_PASSWORD??"",database:process.env.DATABASE_NAME,charset:"utf8mb4",timezone:"Z",multipleStatements:true,bigIntAsNumber:false});}

async function applyThrough470(db:Awaited<ReturnType<typeof rawConnection>>):Promise<number>{
  const names=readdirSync(migrationRoot).filter(name=>/^\d+_[a-z0-9_]+\.sql$/i.test(name)&&Number(name.slice(0,3))<=470).sort();
  for(const name of names)await db.query(readFileSync(new URL(name,migrationRoot),"utf8"));
  return names.length;
}

function runtimeDatabase(){return createDatabaseClient({enabled:true,host:process.env.DATABASE_HOST??"127.0.0.1",port:Number(process.env.DATABASE_PORT??"3324"),user:process.env.DATABASE_USER??"root",password:process.env.DATABASE_PASSWORD??"",name:process.env.DATABASE_NAME!,connectionLimit:4,connectTimeoutMs:5_000});}

async function provider(database:ReturnType<typeof runtimeDatabase>|CapableDatabaseClient){
  const environment=await verifyStartupDatabaseIdentity(database,createEnvironmentContext({environmentCode:"dev",databaseIdentity:process.env.DATABASE_NAME!}));
  return new MariaAppWiringOperationProvider(database,environment);
}

function failingOutboxDatabase(database:ReturnType<typeof runtimeDatabase>):CapableDatabaseClient{
  let failed=false;
  const wrap=(transaction:ControlledDatabaseTransaction):ControlledDatabaseTransaction=>{
    let wrapped!:ControlledDatabaseTransaction;
    wrapped={
      query:<T>(sql:string,values?:readonly unknown[])=>transaction.query<T>(sql,values),
      execute:(sql:string,values?:readonly unknown[])=>{
        if(!failed&&sql.startsWith("INSERT INTO outbox_messages")){failed=true;throw new Error("PET_TITLE_FORCED_OUTBOX_FAILURE");}
        return transaction.execute(sql,values);
      },
      withSavepoint:<T>(work:(nested:ControlledDatabaseTransaction)=>Promise<T>)=>transaction.withSavepoint(nested=>work(wrap(nested))),
    };
    return wrapped;
  };
  return {ping:()=>database.ping(),verifyRollback:()=>database.verifyRollback(),query:<T>(sql:string,values?:readonly unknown[])=>database.query<T>(sql,values),execute:(sql:string,values?:readonly unknown[])=>database.execute(sql,values),withTransaction:work=>database.withTransaction(work),close:async()=>{},withReadOnlySnapshot:work=>database.withReadOnlySnapshot(work),withControlledTransaction:work=>database.withControlledTransaction(transaction=>work(wrap(transaction)))};
}

interface SqlGate{match:(sql:string)=>boolean;reached:Promise<void>;released:Promise<void>;release:()=>void;signal:()=>void;used:boolean;}
function sqlGate(match:(sql:string)=>boolean):SqlGate{let signal!:()=>void,release!:()=>void;const reached=new Promise<void>(resolve=>{signal=resolve;}),released=new Promise<void>(resolve=>{release=resolve;});return {match,reached,released,release,signal,used:false};}

function observingDatabase(database:ReturnType<typeof runtimeDatabase>,statements:string[],gates:SqlGate[]=[]):CapableDatabaseClient{
  const wrap=(transaction:ControlledDatabaseTransaction):ControlledDatabaseTransaction=>({
    query:async<T>(sql:string,values?:readonly unknown[])=>{statements.push(sql);const result=await transaction.query<T>(sql,values);const gate=gates.find(candidate=>!candidate.used&&candidate.match(sql));if(gate!==undefined){gate.used=true;gate.signal();await gate.released;}return result;},
    execute:(sql:string,values?:readonly unknown[])=>{statements.push(sql);return transaction.execute(sql,values);},
    withSavepoint:<T>(work:(nested:ControlledDatabaseTransaction)=>Promise<T>)=>transaction.withSavepoint(nested=>work(wrap(nested))),
  });
  return {ping:()=>database.ping(),verifyRollback:()=>database.verifyRollback(),query:<T>(sql:string,values?:readonly unknown[])=>{statements.push(sql);return database.query<T>(sql,values);},execute:(sql:string,values?:readonly unknown[])=>{statements.push(sql);return database.execute(sql,values);},withTransaction:work=>database.withTransaction(work),close:async()=>{},withReadOnlySnapshot:work=>database.withReadOnlySnapshot(work),withControlledTransaction:work=>database.withControlledTransaction(transaction=>work(wrap(transaction)))};
}

async function mutationCounts(database:ReturnType<typeof runtimeDatabase>){return (await database.query<Array<{claims:bigint;title_operations:bigint;currency_operations:bigint;outbox:bigint;executions:bigint;owned:bigint;balance:bigint}>>(`SELECT
  (SELECT COUNT(*) FROM canonical_app_wiring_operations) claims,
  (SELECT COUNT(*) FROM canonical_pet_title_operations) title_operations,
  (SELECT COUNT(*) FROM canonical_currency_operations) currency_operations,
  (SELECT COUNT(*) FROM outbox_messages) outbox,
  (SELECT COUNT(*) FROM command_executions) executions,
  (SELECT COUNT(*) FROM canonical_owned_pet_title_instances WHERE ownership_status='owned') owned,
  (SELECT balance_minor_amount FROM canonical_player_currency_balances WHERE player_currency_balance_id='ptbal001') balance`))[0]!;}

async function assertStillWaiting(work:Promise<unknown>):Promise<void>{const state=await Promise.race([work.then(()=>"settled",()=>"rejected"),new Promise<string>(resolve=>setTimeout(()=>resolve("waiting"),200))]);assert.equal(state,"waiting");}

function saleEvent(eventId:string,index:number):NormalizedIrisEvent{return {eventId,providerEventId:eventId,providerCode:"iris",eventKind:"1",direction:"incoming",channelId:"ptsale-room",userId:"ptsale-user",displayName:"호이",displayNameSource:"kakao_db",displayNameTrust:"trusted",message:`/펫타이틀판매 ${index}`,eventCode:"message.created",eventCategory:"message",monitoringGroup:"text",eventMetadata:{},payloadHash:"9".repeat(64)};}

async function runSale(database:ReturnType<typeof runtimeDatabase>|CapableDatabaseClient,eventId:string,index:number,handlerCalls:{value:number}){
  const contexts=new MariaPlayerContextProvider(),mutation=new PetTitleCanonicalMutationProvider();
  const ingress=new PetTitleAppWiringIngress(
    await provider(database),
    new CommandDispatcher(new MariaCommandRouteReader(database),{enabled:true,allowAllCanaries:true,canaryUserIds:new Set()}),
    new PetTitleShadowEvaluator(contexts,new PetTitleShadowReadAuthorityProvider(),new PetTitleCanonicalReadProvider()),
    contexts,
    {create:(participant,claim,input)=>mutation.create(participant,claim,input),sell:async(participant,claim,input)=>{handlerCalls.value+=1;return mutation.sell(participant,claim,input);}},
  );
  const replies:Array<{outboxId:string;room:string;data:string}>=[];
  const disposition=await dispatchPetTitleCommand(ingress,true,false,saleEvent(eventId,index),replies);
  return {disposition,replies};
}

async function seedFixture(database:ReturnType<typeof runtimeDatabase>):Promise<void>{
  const audit=["test:pet-title-sale","2026-09-05 10:00:00","test:pet-title-sale","2026-09-05 10:00:00"];
  const legacyPlayer=await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
  const account=await database.execute("INSERT INTO user_accounts(login_id,password_hash,system_account_name,gender_code,status) VALUES ('ptsale-login','synthetic','PET TITLE SALE','unspecified','active')");
  await database.execute("INSERT INTO player_profiles(player_id,current_display_name,terms_agreed,version) VALUES (?,'호이',TRUE,1)",[legacyPlayer.insertId]);
  await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao','ptsale-user','호이','linked')",[legacyPlayer.insertId]);
  await database.execute("INSERT INTO canonical_players(player_id,source_system,source_identifier,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('ptplayer','LEGACY_DB',?, ?,?,?,?)",[legacyPlayer.insertId.toString(),...audit]);
  await database.execute("INSERT INTO canonical_player_identity_crosswalks(canonical_player_identity_crosswalk_id,provider_code,external_user_id,player_id,crosswalk_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('ptcross1','kakao','ptsale-user','ptplayer','LINKED',?,?,?,?)",audit);
  await database.execute("INSERT INTO canonical_portal_accounts(portal_account_id,legacy_user_account_id,portal_account_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('ptportal',?,'ACTIVE',?,?,?,?)",[account.insertId,...audit]);
  await database.execute("INSERT INTO portal_game_account_links(portal_game_account_link_id,portal_account_id,player_id,player_role,registration_sequence,link_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('ptlink01','ptportal',?,'REPRESENTATIVE',1,'ACTIVE',?,?,?,?)",[legacyPlayer.insertId,...audit]);
  await database.execute("INSERT INTO account_platform_identities(platform_identity_id,portal_account_id,platform_code,identity_scope_key,external_user_key,identity_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('ptident1','ptportal','KAKAO','ptsale-room','ptsale-user','ACTIVE',?,?,?,?)",audit);
  await database.execute("INSERT INTO account_platform_contexts(platform_context_id,platform_code,context_type,external_context_key,context_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('ptroom01','KAKAO','ROOM','ptsale-room','ACTIVE',?,?,?,?)",audit);
  await database.execute("INSERT INTO account_platform_context_memberships(platform_context_membership_id,platform_identity_id,platform_context_id,membership_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('ptmembr1','ptident1','ptroom01','ACTIVE',?,?,?,?)",audit);
  await database.execute("INSERT INTO account_platform_active_player_selections(active_player_selection_id,platform_context_membership_id,portal_game_account_link_id,active_player_id,selection_status,selection_version,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('ptselec1','ptmembr1','ptlink01',?,'ACTIVE',1,?,?,?,?)",[legacyPlayer.insertId,...audit]);
  await database.execute("INSERT INTO canonical_currency_definitions(currency_id,currency_name,decimal_places,active_flag,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('ptpoint1','포인트',3,TRUE,?,?,?,?)",audit);
  await database.execute("INSERT INTO canonical_currency_definition_imports(currency_definition_import_id,currency_id,source_system,source_namespace,source_identifier,payload_fingerprint,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('ptcurimp','ptpoint1','LEGACY_JSON','member.point','point',REPEAT('a',64),?,?,?,?)",audit);
  await database.execute("INSERT INTO canonical_player_currency_balances(player_currency_balance_id,player_id,currency_id,balance_minor_amount,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('ptbal001','ptplayer','ptpoint1',1000,?,?,?,?)",audit);
  for(let index=1;index<=4;index+=1){await database.execute("INSERT INTO canonical_pet_title_definitions(pet_title_id,title_name,base_sale_price,active_flag,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?, ?,100000000,TRUE,?,?,?,?)",[`pttitle${index}`,`타이틀${index}`,...audit]);await database.execute("INSERT INTO canonical_owned_pet_title_instances(owned_pet_title_id,player_id,pet_title_id,acquisition_sequence,acquired_time,acquisition_price,ownership_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,'ptplayer',?,?, '2026-09-05 10:00:00',100000000,'owned',?,?,?,?)",[`ptown00${index}`,`pttitle${index}`,index,...audit]);}
  const war=await database.execute("INSERT INTO guild_territory_wars(war_key,active,lifecycle_state,rift_event_history_json) VALUES ('ptsale-world',FALSE,'READY',JSON_ARRAY())");
  await database.execute("INSERT INTO guild_territory_start_scopes(scope_code,war_id) VALUES ('world',?) ON DUPLICATE KEY UPDATE war_id=VALUES(war_id)",[war.insertId]);
  for(const eventId of eventIds)await database.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?, 'ptsale-room','ptsale-user','message','incoming',REPEAT('9',64),'processed',UTC_TIMESTAMP(3))",[eventId,eventId]);
  await database.execute("CREATE TABLE IF NOT EXISTS pet_title_sale_rehearsal_evidence(evidence_key VARCHAR(64) PRIMARY KEY,evidence_value VARCHAR(191) NOT NULL)");
}

async function balance(database:ReturnType<typeof runtimeDatabase>):Promise<bigint>{return BigInt((await database.query<Array<{value:bigint}>>("SELECT balance_minor_amount value FROM canonical_player_currency_balances WHERE player_currency_balance_id='ptbal001'"))[0]!.value);}

describe("PET-TITLE sale app-wiring isolated MariaDB",{skip:!enabled},()=>{
  it("proves migration 471, atomic sale/no-reply, rollback, restart replay, and re-forward",async()=>{
    const raw=await rawConnection();
    try{
      if(phase==="prepare"){
        assert.ok(await applyThrough470(raw)>400);
        await raw.query(migration471);await raw.query(migration471);
        const database=runtimeDatabase();
        try{
          await seedFixture(database);
          const registry=(await database.query<Array<{rollout_state:string}>>("SELECT rollout_state FROM command_registry WHERE command_code='PET_TITLE_SELL'"))[0];assert.equal(registry?.rollout_state,"SHADOW");
          const shape=(await database.query<Array<{value:bigint}>>("SELECT COUNT(*) value FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='canonical_pet_title_operations' AND column_name='currency_operation_id'"))[0];assert.equal(shape?.value,1n);

          const shadowBefore=await mutationCounts(database),shadowCalls={value:0};
          const shadow=await runSale(database,"ptsale-shadow",1,shadowCalls);
          assert.deepEqual(shadow,{disposition:"legacy_fallback",replies:[]});assert.equal(shadowCalls.value,0);assert.deepEqual(await mutationCounts(database),shadowBefore);
          await database.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='PET_TITLE_SELL'");

          const readyCalls={value:0},statements:string[]=[];const ready=await runSale(observingDatabase(database,statements),"ptsale-ready",1,readyCalls);assert.equal(ready.disposition,"claimed");assert.equal(ready.replies.length,1);assert.match(ready.replies[0]!.data,/타이틀1.*30,000,000 포인트/s);assert.equal(readyCalls.value,1);assert.equal(await balance(database),30_000_001_000n);
          const lockOrder=[
            statements.findIndex(sql=>sql.includes("FROM account_platform_identities platform_identity")&&sql.includes("FOR UPDATE")),
            statements.findIndex(sql=>sql.includes("FROM guild_territory_start_scopes WHERE scope_code=? FOR UPDATE")),
            statements.findIndex(sql=>sql.includes("FROM guild_territory_wars WHERE id=? FOR UPDATE")),
            statements.findIndex(sql=>sql.includes("FROM canonical_players WHERE player_id=? FOR UPDATE")),
            statements.findIndex(sql=>sql.includes("FROM canonical_owned_pet_title_instances owned")&&sql.includes("FOR UPDATE")),
            statements.findIndex(sql=>sql.includes("FROM canonical_currency_definition_imports")&&sql.includes("FOR UPDATE")),
          ];
          assert.ok(lockOrder.every(index=>index>=0));assert.deepEqual([...lockOrder].sort((left,right)=>left-right),lockOrder);
          const readyAfterFirst=await mutationCounts(database);
          const readyReplay=await runSale(database,"ptsale-ready",1,readyCalls);assert.equal(readyReplay.disposition,"claimed");assert.equal(readyCalls.value,1);assert.equal(readyReplay.replies[0]!.outboxId,ready.replies[0]!.outboxId);assert.equal(await balance(database),30_000_001_000n);assert.deepEqual(await mutationCounts(database),readyAfterFirst);

          await database.execute("UPDATE guild_territory_wars war JOIN guild_territory_start_scopes scope_row ON scope_row.war_id=war.id SET war.active=FALSE,war.lifecycle_state='PENDING_START' WHERE scope_row.scope_code='world'");
          const pendingCalls={value:0};await runSale(database,"ptsale-pending",1,pendingCalls);assert.equal(pendingCalls.value,1);assert.equal(await balance(database),60_000_001_000n);

          await database.execute("UPDATE guild_territory_wars war JOIN guild_territory_start_scopes scope_row ON scope_row.war_id=war.id SET war.active=TRUE,war.lifecycle_state='ACTIVE_OPENING' WHERE scope_row.scope_code='world'");
          const silentBefore=await balance(database),silentCalls={value:0};const silent=await runSale(database,"ptsale-silent",1,silentCalls);assert.deepEqual(silent,{disposition:"claimed",replies:[]});assert.equal(silentCalls.value,1);assert.equal(await balance(database),silentBefore);
          const silentLink=(await database.query<Array<{pet_title_operation_id:string;result_fingerprint:string}>>("SELECT link.pet_title_operation_id,link.result_fingerprint FROM canonical_app_wiring_receipt_links link JOIN canonical_app_wiring_operations claim ON claim.app_wiring_operation_id=link.app_wiring_operation_id WHERE claim.external_request_id='ptsale-silent' AND link.receipt_kind='PET_TITLE'"))[0]!;
          const silentAfterFirst=await mutationCounts(database);
          const silentReplay=await runSale(database,"ptsale-silent",1,silentCalls);assert.deepEqual(silentReplay,{disposition:"claimed",replies:[]});assert.equal(silentCalls.value,1);
          assert.deepEqual(await mutationCounts(database),silentAfterFirst);
          const silentCounts=(await database.query<Array<{outbox_count:bigint;execution_count:bigint;owned_count:bigint;link_count:bigint}>>("SELECT (SELECT COUNT(*) FROM outbox_messages message JOIN operations operation ON operation.id=message.operation_id WHERE operation.idempotency_key='ptsale-silent') outbox_count,(SELECT COUNT(*) FROM command_executions WHERE event_id='ptsale-silent' AND result_code='no_reply') execution_count,(SELECT COUNT(*) FROM canonical_owned_pet_title_instances WHERE owned_pet_title_id='ptown003' AND ownership_status='owned') owned_count,(SELECT COUNT(*) FROM canonical_app_wiring_receipt_links link JOIN canonical_app_wiring_operations claim ON claim.app_wiring_operation_id=link.app_wiring_operation_id WHERE claim.external_request_id='ptsale-silent' AND link.pet_title_operation_id=? AND link.result_fingerprint=?) link_count",[silentLink.pet_title_operation_id,silentLink.result_fingerprint]))[0]!;assert.deepEqual([silentCounts.outbox_count,silentCounts.execution_count,silentCounts.owned_count,silentCounts.link_count],[0n,1n,1n,1n]);

          await database.execute("UPDATE guild_territory_wars war JOIN guild_territory_start_scopes scope_row ON scope_row.war_id=war.id SET war.active=FALSE,war.lifecycle_state='READY' WHERE scope_row.scope_code='world'");
          const beforeFault=await balance(database),faultCalls={value:0};const faultDatabase=failingOutboxDatabase(database);
          await assert.rejects(runSale(faultDatabase,"ptsale-fault",1,faultCalls),/PET_TITLE_FORCED_OUTBOX_FAILURE/);assert.equal(faultCalls.value,1);assert.equal(await balance(database),beforeFault);
          const fault=(await database.query<Array<{claim_state:string;owned_status:string;typed_count:bigint;currency_count:bigint}>>("SELECT claim.claim_state,(SELECT ownership_status FROM canonical_owned_pet_title_instances WHERE owned_pet_title_id='ptown003') owned_status,(SELECT COUNT(*) FROM canonical_pet_title_operations operation_row WHERE operation_row.request_key='IRIS:ptsale-fault') typed_count,(SELECT COUNT(*) FROM canonical_currency_operations operation_row WHERE operation_row.request_key='IRIS:ptsale-fault') currency_count FROM canonical_app_wiring_operations claim WHERE claim.external_request_id='ptsale-fault'"))[0]!;assert.deepEqual([fault.claim_state,fault.owned_status,fault.typed_count,fault.currency_count],["FAILED","owned",0n,0n]);

          const selectionGate=sqlGate(sql=>sql.includes("FROM account_platform_identities platform_identity")&&sql.includes("FOR UPDATE"));
          const warGate=sqlGate(sql=>sql.includes("FROM guild_territory_wars WHERE id=? FOR UPDATE"));
          const lockCalls={value:0},lockRun=runSale(observingDatabase(database,[],[selectionGate,warGate]),"ptsale-lock",1,lockCalls);
          const selectionCompetitor=await rawConnection(),warCompetitor=await rawConnection();
          try{
            await selectionCompetitor.query("SET SESSION innodb_lock_wait_timeout=5");await warCompetitor.query("SET SESSION innodb_lock_wait_timeout=5");
            await selectionGate.reached;
            const selectionUpdate=selectionCompetitor.query("UPDATE account_platform_active_player_selections SET selection_version=selection_version+1 WHERE active_player_selection_id='ptselec1'");
            await assertStillWaiting(selectionUpdate);selectionGate.release();
            await warGate.reached;
            const warUpdate=warCompetitor.query("UPDATE guild_territory_wars war JOIN guild_territory_start_scopes scope_row ON scope_row.war_id=war.id SET war.lifecycle_state=war.lifecycle_state WHERE scope_row.scope_code='world'");
            await assertStillWaiting(warUpdate);warGate.release();
            const lockResult=await lockRun;assert.equal(lockResult.disposition,"claimed");assert.equal(lockCalls.value,1);await selectionUpdate;await warUpdate;
          }finally{selectionGate.release();warGate.release();await selectionCompetitor.end();await warCompetitor.end();}
          await database.execute("INSERT INTO pet_title_sale_rehearsal_evidence(evidence_key,evidence_value) VALUES ('prepare_complete','true'),('ready_balance',?),('silent_operation_id',?),('silent_result_fingerprint',?) ON DUPLICATE KEY UPDATE evidence_value=VALUES(evidence_value)",[(await balance(database)).toString(),silentLink.pet_title_operation_id,silentLink.result_fingerprint]);
        }finally{await database.close();}
        return;
      }

      const database=runtimeDatabase();
      try{
        const evidenceRows=await database.query<Array<{evidence_key:string;evidence_value:string}>>("SELECT evidence_key,evidence_value FROM pet_title_sale_rehearsal_evidence WHERE evidence_key IN ('ready_balance','silent_operation_id','silent_result_fingerprint')");const evidence=new Map(evidenceRows.map(row=>[row.evidence_key,row.evidence_value]));const expected=evidence.get("ready_balance")!;
        const replayCalls={value:0};const replay=await runSale(database,"ptsale-ready",1,replayCalls);assert.equal(replay.disposition,"claimed");assert.equal(replay.replies.length,1);assert.equal(replayCalls.value,0);assert.equal((await balance(database)).toString(),expected);
        const silentBeforeRestartReplay=await mutationCounts(database),silentReplayCalls={value:0};const silentReplay=await runSale(database,"ptsale-silent",1,silentReplayCalls);assert.deepEqual(silentReplay,{disposition:"claimed",replies:[]});assert.equal(silentReplayCalls.value,0);assert.deepEqual(await mutationCounts(database),silentBeforeRestartReplay);
        const silentRestartLink=(await database.query<Array<{pet_title_operation_id:string;result_fingerprint:string}>>("SELECT link.pet_title_operation_id,link.result_fingerprint FROM canonical_app_wiring_receipt_links link JOIN canonical_app_wiring_operations claim ON claim.app_wiring_operation_id=link.app_wiring_operation_id WHERE claim.external_request_id='ptsale-silent' AND link.receipt_kind='PET_TITLE'"))[0]!;assert.deepEqual(silentRestartLink,{pet_title_operation_id:evidence.get("silent_operation_id"),result_fingerprint:evidence.get("silent_result_fingerprint")});
        const silentRestartCounts=(await database.query<Array<{outbox_count:bigint;link_count:bigint;typed_count:bigint}>>("SELECT (SELECT COUNT(*) FROM outbox_messages message JOIN operations operation ON operation.id=message.operation_id WHERE operation.idempotency_key='ptsale-silent') outbox_count,(SELECT COUNT(*) FROM canonical_app_wiring_receipt_links link JOIN canonical_app_wiring_operations claim ON claim.app_wiring_operation_id=link.app_wiring_operation_id WHERE claim.external_request_id='ptsale-silent' AND link.receipt_kind='PET_TITLE') link_count,(SELECT COUNT(*) FROM canonical_pet_title_operations operation_row WHERE operation_row.request_key='IRIS:ptsale-silent') typed_count"))[0]!;assert.deepEqual([silentRestartCounts.outbox_count,silentRestartCounts.link_count,silentRestartCounts.typed_count],[0n,1n,1n]);
        await assert.rejects(()=>raw.query(rollback471),/Subquery returns more than 1 row|ER_SUBQUERY_NO_1_ROW/i);
        const columnStillPresent=(await database.query<Array<{value:bigint}>>("SELECT COUNT(*) value FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='canonical_pet_title_operations' AND column_name='currency_operation_id'"))[0]!.value;assert.equal(columnStillPresent,1n);
        await database.execute("DELETE link FROM canonical_app_wiring_receipt_links link WHERE link.receipt_kind='PET_TITLE'");
        await database.execute("DELETE FROM canonical_pet_title_operation_participants");
        await database.execute("DELETE FROM canonical_pet_title_operations");
        await database.execute("DELETE FROM canonical_currency_ledger_entries");
        await database.execute("DELETE FROM canonical_currency_operations");
        await raw.query(rollback471);
        const removed=(await database.query<Array<{value:bigint}>>("SELECT COUNT(*) value FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='canonical_pet_title_operations' AND column_name='currency_operation_id'"))[0]!.value;assert.equal(removed,0n);
        const reforwardDatabase=`${process.env.DATABASE_NAME!}_reforward`;
        await raw.query(`CREATE DATABASE ${reforwardDatabase} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
        try{
          await raw.query(`USE ${reforwardDatabase}`);assert.ok(await applyThrough470(raw)>400);await raw.query(migration471);await raw.query(migration471);
          const restored=(await raw.query<Array<{value:bigint}>>("SELECT COUNT(*) value FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='canonical_pet_title_operations' AND column_name='currency_operation_id'"))[0]!.value;assert.equal(restored,1n);
        }finally{await raw.query(`USE ${process.env.DATABASE_NAME!}`);await raw.query(`DROP DATABASE IF EXISTS ${reforwardDatabase}`);}
      }finally{await database.close();}
    }finally{await raw.end();}
  });
});
