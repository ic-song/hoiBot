import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { CapableDatabaseClient, ControlledDatabaseTransaction, DatabaseTransaction, DatabaseWriteResult, ReadOnlySnapshotTransaction } from "../src/database.js";
import type { CommandDispatchDecision } from "../src/dispatch/command-dispatcher.js";
import { MariaAppWiringOperationProvider, type AppWiringReadParticipant } from "../src/dispatch/app-wiring-operation-provider.js";
import { ApplicationError } from "../src/shared/application-error.js";
import {
  MariaPetExploreShadowEvaluator,
  PetExploreAppWiringIngress,
  type PetExploreShadowEvaluator,
} from "../src/pet/pet-explore-app-wiring-ingress.js";
import {
  createPetExploreSettlementParticipantSourceHash,
  PET_EXPLORE_SETTLEMENT_POLICY_HASH,
  PET_EXPLORE_SETTLEMENT_POLICY_JSON,
  PET_EXPLORE_SETTLEMENT_POLICY_VERSION,
  previewPetExploreSettlementInput,
  type PetExploreSettlementParticipantSource,
  type PetExploreThresholdComponents,
} from "../src/pet/pet-explore-settlement-input-snapshot-provider.js";
import { createEnvironmentContext, verifyStartupDatabaseIdentity } from "../src/runtime/environment-context.js";
import { settlementCommandEvent } from "./fixtures/pet-explore-settlement-command-consumer.js";

type Row = Record<string, unknown>;
class ClaimDatabase implements CapableDatabaseClient {
  row?: Row;
  typedReceipt?: Row;
  receiptLink?: Row;
  readonly writes: string[] = [];
  readonly reads: string[] = [];
  readOnlySnapshots = 0;
  readHandler?: AppWiringReadParticipant;
  async ping() {} async verifyRollback(){return true;} async close() {}
  async query<T>(sql:string):Promise<T>{if(sql==="SELECT DATABASE() AS database_identity")return[{database_identity:"hoi_bot"}] as T;return[] as T;}
  async execute():Promise<DatabaseWriteResult>{throw new Error("RAW_EXECUTE_FORBIDDEN");}
  async withTransaction<T>(work:(tx:DatabaseTransaction)=>Promise<T>):Promise<T>{return this.withControlledTransaction(work as (tx:ControlledDatabaseTransaction)=>Promise<T>);}
  async withReadOnlySnapshot<T>(work:(tx:ReadOnlySnapshotTransaction)=>Promise<T>):Promise<T>{this.readOnlySnapshots+=1;return work({query:async<R>(sql:string,values?:readonly unknown[])=>{this.reads.push(sql);return this.readHandler===undefined?[] as R:this.readHandler.query<R>(sql,values);}});}
  async withControlledTransaction<T>(work:(tx:ControlledDatabaseTransaction)=>Promise<T>):Promise<T>{
    const before=this.row===undefined?undefined:{...this.row},beforeTyped=this.typedReceipt===undefined?undefined:{...this.typedReceipt},beforeLink=this.receiptLink===undefined?undefined:{...this.receiptLink};
    const tx:ControlledDatabaseTransaction={query:async<R>(sql:string,values:readonly unknown[]=[])=>this.txQuery<R>(sql,values),execute:(sql:string,values:readonly unknown[]=[])=>this.txExecute(sql,values),withSavepoint:async<R>(nested:(transaction:ControlledDatabaseTransaction)=>Promise<R>)=>nested(tx)};
    try{return await work(tx);}catch(error){this.row=before;this.typedReceipt=beforeTyped;this.receiptLink=beforeLink;throw error;}
  }
  private async txQuery<T>(sql:string,values:readonly unknown[]):Promise<T>{
    if(sql.includes("FROM canonical_app_wiring_receipt_links"))return(this.receiptLink?.app_wiring_operation_id===values[0]?[this.receiptLink]:[]) as T;
    if(sql.includes("FROM canonical_app_wiring_operations"))return(this.row?.request_identity_fingerprint===values[0]?[this.row]:[]) as T;
    if(sql.includes("FROM canonical_pet_explore_event_control_operations"))return(this.typedReceipt?.pet_explore_event_control_operation_id===values[0]?[this.typedReceipt]:[]) as T;
    return[] as T;
  }
  private async txExecute(sql:string,v:readonly unknown[]):Promise<DatabaseWriteResult>{
    this.writes.push(sql);
    if(sql.startsWith("INSERT INTO canonical_app_wiring_operations")){this.row={app_wiring_operation_id:v[0],request_identity_fingerprint:v[1],request_namespace:v[2],entrypoint_kind:v[3],external_request_id:v[4],request_key:v[5],payload_fingerprint:v[6],route:v[9],reason_code:v[10],command_code:v[11],handler_key:v[12],claim_state:"CLAIMED",effect_mode:v[13],lease_token:v[14],lease_generation:1n,lease_expires_time:v[15],attempt_count:1n,recovery_status:"NONE",recovery_code:null,result_json:null,error_code:null};return this.ok();}
    if(sql.includes("SET claim_state='MUTATION_STARTED'")){Object.assign(this.row!,{claim_state:"MUTATION_STARTED",recovery_status:"PENDING",recovery_code:"ACTIVE_MUTATION_IN_PROGRESS"});return this.ok();}
    if(sql.startsWith("INSERT INTO canonical_pet_explore_event_control_operations")){this.typedReceipt={pet_explore_event_control_operation_id:v[0],result_fingerprint:v[10],operation_status:"COMPLETED"};return this.ok();}
    if(sql.startsWith("INSERT INTO canonical_app_wiring_receipt_links")){const columns=["daily_prayer_operation_id","home_aggregate_operation_id","market_operation_id","member_title_operation_id","mini_pet_title_operation_id","package_use_operation_id","pet_explore_operation_id","pet_explore_event_control_operation_id","pet_title_operation_id","player_identity_operation_id"];this.receiptLink={canonical_app_wiring_receipt_link_id:v[0],app_wiring_operation_id:v[1],receipt_kind:v[2],result_fingerprint:v[3]};for(let index=0;index<columns.length;index+=1)this.receiptLink[columns[index]!]=v[4+index];return this.ok();}
    if(sql.includes("SET claim_state='COMPLETED'")){Object.assign(this.row!,{claim_state:"COMPLETED",result_json:v[0],lease_token:null,lease_expires_time:null});return this.ok();}
    if(sql.includes("SET claim_state='FAILED'")){Object.assign(this.row!,{claim_state:"FAILED",error_code:v[0],lease_token:null,lease_expires_time:null});return this.ok();}
    return this.no();
  }
  private ok(){return{affectedRows:1n,insertId:0n};}private no(){return{affectedRows:0n,insertId:0n};}
}

async function provider(database:ClaimDatabase):Promise<MariaAppWiringOperationProvider>{
  const environment=await verifyStartupDatabaseIdentity(database,createEnvironmentContext({environmentCode:"dev",databaseIdentity:"hoi_bot"}));
  return new MariaAppWiringOperationProvider(database,environment,()=>"pet00001",1,()=>new Date("2026-09-04T00:00:00Z"),()=>"a".repeat(64));
}
function dispatcher(decision:CommandDispatchDecision,calls:string[]){return{resolveReadOnly:async()=>{calls.push("resolve");return decision;}};}

const threshold:PetExploreThresholdComponents={base:500,tier:500,experience:0,lord:0,trait:0,pendant:0,homeBadge:0,upItem:0,penalty:0,premium:0};
const destinationCodes=["diamond_mine_event","pet_enhancement_mine","intimacy_mine","luck_mine","jeondor_dungeon","chicken_farm_dungeon","land_document_dungeon","shop_open_dungeon","belcar_maze","archmage_ruins","guild_raid_event"]as const;
function destinationRows(){const success=["ITEM-DIAMOND-MINE-BOX","enhance_dungeon_box","pet_food_dungeon_box","reward_lucky_box","ITEM-DUNGEON-JEONDOR-BOX","ITEM-DUNGEON-CHICKEN-BOX","ITEM-PACKAGE-LAND-DOCUMENT-DUNGEON-BOX","ITEM-DUNGEON-SHOP-OPEN-BOX","ITEM-DUNGEON-PENDANT-MAZE-BOX",null,"guild_raid_dungeon_box"]as const,gaps=[null,null,null,null,null,null,null,null,"maze_ticket_canonical_binding","archmage_random_reward","guild_membership_recheck"]as const;return destinationCodes.map((destination_code,index)=>({destination_code,source_slot:String(index),ticket_policy:index>=4&&index<=7?"consume_or_regular_fallback":index>=8?"consume_or_fail":"none",ticket_item_code:index>=4&&index<=7||index===10?"ITEM-PET-DUNGEON-ENTRY-TICKET":null,fallback_destinations_json:index>=4&&index<=7?["pet_enhancement_mine","intimacy_mine","luck_mine"]:null,success_rewards_json:success[index]===null?[]:[{itemCode:success[index],quantity:"1"}],failure_rewards_json:[{itemCode:"pet_food",quantity:"2"}],source_gap_code:gaps[index]}));}
function sourceRow(overrides:Record<string,unknown>={}){const source:PetExploreSettlementParticipantSource={roundKey:"round-1",participationId:"31",playerId:"41",destinationCode:"luck_mine",expectedVersion:"2",sourceRevision:PET_EXPLORE_SETTLEMENT_POLICY_VERSION,threshold,sourceGapCodes:[]};return{id:31n,player_id:41n,destination_code:"luck_mine",version:2n,source_revision:source.sourceRevision,source_hash:createPetExploreSettlementParticipantSourceHash(source),threshold_components_json:threshold,source_gap_codes_json:[],...overrides};}
function strictSettlementParticipant(options:{authorized?:boolean;rounds?:Row[];policy?:Row;destinations?:Row[];source?:Row;configs?:Row[];nextExisting?:Row[]}={}):{participant:AppWiringReadParticipant;statements:string[]}{const statements:string[]=[];const participant:AppWiringReadParticipant={query:async<T>(sql:string)=>{statements.push(sql);if(sql.includes("mapping.operator_id"))return(options.authorized===false?[]:[{operator_id:7n,display_name:"관리자",role_code:"super_admin",channel_allowed:0}])as T;if(sql.includes("FROM pet_explore_auto_fixed_configs"))return(options.configs??[])as T;if(sql.includes("FROM pet_explore_rounds WHERE state_code='open'"))return(options.rounds??[{id:11n,round_key:"round-1",version:3n,state_code:"open"}])as T;if(sql.includes("FROM pet_explore_settlement_policy_versions"))return[options.policy??{policy_version:PET_EXPLORE_SETTLEMENT_POLICY_VERSION,policy_hash:PET_EXPLORE_SETTLEMENT_POLICY_HASH,policy_document_json:PET_EXPLORE_SETTLEMENT_POLICY_JSON}]as T;if(sql.includes("FROM pet_explore_settlement_destination_policies"))return(options.destinations??destinationRows())as T;if(sql.includes("LEFT JOIN pet_explore_settlement_participant_source_projections"))return[options.source??sourceRow()]as T;if(sql.includes("FROM pet_explore_participations WHERE round_id="))return(options.nextExisting??[])as T;throw new Error(`UNEXPECTED_SQL:${sql}`);}};return{participant,statements};}

describe("PetExploreAppWiringIngress",()=>{
  it("resolves before claim, evaluates SHADOW once and replays without evaluator work",async()=>{
    const database=new ClaimDatabase(),calls:string[]=[];let evaluations=0;
    const evaluator:PetExploreShadowEvaluator={preview:async()=>{calls.push("evaluate");evaluations+=1;return{family:"SETTLEMENT",authorized:true,resultFingerprint:"b".repeat(64),summary:{participantCount:"1"}};}};
    const ingress=new PetExploreAppWiringIngress(await provider(database),dispatcher({route:"SHADOW",reasonCode:"ROLLOUT_SHADOW",commandCode:"ADMIN_PET_EXPLORE_SETTLEMENT",handlerKey:"pet_explore_settlement"},calls),evaluator);
    assert.equal((await ingress.handle(settlementCommandEvent())).status,"shadow");
    assert.deepEqual(calls,["resolve","evaluate"]);assert.equal(database.row?.claim_state,"COMPLETED");assert.equal(database.readOnlySnapshots,1);
    assert.equal((await ingress.handle(settlementCommandEvent())).status,"shadow");
    assert.equal(evaluations,1);assert.deepEqual(calls,["resolve","evaluate","resolve"]);
    assert.equal(database.writes.some(sql=>/command_routing_decisions|outbox_messages|pet_explore_(?:rounds|participations|runtime_config)/i.test(sql)),false);
  });

  it("rejects payload drift and records evaluator faults as FAILED",async()=>{
    const driftDb=new ClaimDatabase(),calls:string[]=[];const evaluator:PetExploreShadowEvaluator={preview:async()=>({family:"SETTLEMENT",authorized:true,resultFingerprint:"c".repeat(64),summary:{}})};
    const ingress=new PetExploreAppWiringIngress(await provider(driftDb),dispatcher({route:"SHADOW",reasonCode:"ROLLOUT_SHADOW",handlerKey:"settlement"},calls),evaluator);
    await ingress.handle(settlementCommandEvent());
    await assert.rejects(()=>ingress.handle(settlementCommandEvent({channelId:"changed-room"})),/APP_WIRING_PAYLOAD_DRIFT/);
    const failedDb=new ClaimDatabase(),faulting:PetExploreShadowEvaluator={preview:async()=>{throw new Error("preview fault");}},failed=new PetExploreAppWiringIngress(await provider(failedDb),dispatcher({route:"SHADOW",reasonCode:"ROLLOUT_SHADOW",handlerKey:"settlement"},[]),faulting);
    await assert.rejects(()=>failed.handle(settlementCommandEvent({eventId:"fault-event"})),/preview fault/);assert.equal(failedDb.row?.claim_state,"FAILED");assert.equal(failedDb.row?.error_code,"PET_EXPLORE_SHADOW_EVALUATION_FAILED");
  });

  it("runs REJECT without a DB evaluator and leaves LEGACY outside claims while MODERN fails closed",async()=>{
    const rejectedDb=new ClaimDatabase();let evaluations=0;const evaluator:PetExploreShadowEvaluator={preview:async()=>{evaluations+=1;throw new Error("must not run");}};
    const rejected=new PetExploreAppWiringIngress(await provider(rejectedDb),dispatcher({route:"REJECT",reasonCode:"AUTH_SCOPE_NOT_SATISFIED"},[]),evaluator);
    assert.equal((await rejected.handle(settlementCommandEvent())).status,"rejected");assert.equal(evaluations,0);assert.equal(rejectedDb.readOnlySnapshots,0);assert.equal(rejectedDb.row?.claim_state,"COMPLETED");
    const legacyDb=new ClaimDatabase(),legacy=new PetExploreAppWiringIngress(await provider(legacyDb),dispatcher({route:"LEGACY_FALLBACK",reasonCode:"ROLLOUT_LEGACY_ONLY",handlerKey:"settlement"},[]),evaluator);
    assert.deepEqual(await legacy.handle(settlementCommandEvent({eventId:"legacy"})),{status:"legacy_fallback"});assert.equal(legacyDb.row,undefined);
    const modernDb=new ClaimDatabase(),modern=new PetExploreAppWiringIngress(await provider(modernDb),dispatcher({route:"MODERN",reasonCode:"MODERN_ROUTE_ALLOWED",handlerKey:"settlement"},[]),evaluator);
    await assert.rejects(()=>modern.handle(settlementCommandEvent({eventId:"modern"})),(error:unknown)=>error instanceof Error&&"code" in error&&error.code==="PET_EXPLORE_MODERN_MUTATION_NOT_ADOPTED");assert.equal(modernDb.row,undefined);
  });

  it("runs only EVENT_CONTROL MODERN as one typed mutation and replays without domain work",async()=>{
    const database=new ClaimDatabase(),calls:string[]=[];let executions=0;
    const modernProvider={execute:async(db:import("../src/dispatch/app-wiring-operation-provider.js").AppWiringMutationParticipant)=>{
      executions+=1;
      assert.equal(database.row?.claim_state,"CLAIMED");
      await db.execute("INSERT INTO canonical_pet_explore_event_control_operations VALUES (?)",["event001"]);
      assert.equal(database.row?.claim_state,"MUTATION_STARTED");
      database.typedReceipt={pet_explore_event_control_operation_id:"event001",result_fingerprint:"d".repeat(64),operation_status:"COMPLETED"};
      return{status:"changed" as const,data:"ok",operationId:"event001",resultFingerprint:"d".repeat(64),replayed:false as const};
    }};
    const ingress=new PetExploreAppWiringIngress(await provider(database),dispatcher({route:"MODERN",reasonCode:"MODERN_ROUTE_ALLOWED",commandCode:"PET_EXPLORE_EVENT_CONTROL",handlerKey:"pet_explore_event_control"},calls),undefined,modernProvider);
    const event=settlementCommandEvent({eventId:"modern-event-control",message:"/펫탐험이벤트활성화"});
    const first=await ingress.handle(event);
    assert.deepEqual(first,{status:"modern",replayed:false,operationId:"event001",resultFingerprint:"d".repeat(64)});
    assert.equal(database.row?.claim_state,"COMPLETED");assert.equal(executions,1);
    const replay=await ingress.handle(event);
    assert.deepEqual(replay,{status:"modern",replayed:true,operationId:"event001",resultFingerprint:"d".repeat(64)});
    assert.equal(executions,1);
  });

  it("enforces the claim-bound read-only SQL policy for shadow evaluators",async()=>{
    for(const[index,sql]of["SELECT 1 FOR UPDATE","UPDATE pet_explore_rounds SET state_code='closed'","SELECT LAST_INSERT_ID()"].entries()){
      const database=new ClaimDatabase(),bad:PetExploreShadowEvaluator={preview:async(db)=>{await db.query(sql);throw new Error("unreachable");}},ingress=new PetExploreAppWiringIngress(await provider(database),dispatcher({route:"SHADOW",reasonCode:"ROLLOUT_SHADOW",handlerKey:"settlement"},[]),bad);
      await assert.rejects(()=>ingress.handle(settlementCommandEvent({eventId:`bad-sql-${index}`})),/APP_WIRING_(?:LOCKING_QUERY_FORBIDDEN|QUERY_NOT_READ_ONLY)/);assert.equal(database.row?.claim_state,"FAILED");assert.deepEqual(database.reads,[]);
    }
  });

  it("runs the authorized settlement plan preview inside the claimed read-only snapshot without domain or outbox writes",async()=>{const database=new ClaimDatabase(),strict=strictSettlementParticipant();database.readHandler=strict.participant;const ingress=new PetExploreAppWiringIngress(await provider(database),dispatcher({route:"SHADOW",reasonCode:"ROLLOUT_SHADOW",commandCode:"ADMIN_PET_EXPLORE_SETTLEMENT",handlerKey:"pet_explore_settlement"},[]));const result=await ingress.handle(settlementCommandEvent());assert.equal(result.status,"shadow");assert.equal(database.readOnlySnapshots,1);assert.equal(strict.statements.some(sql=>sql.includes("pet_explore_settlement_destination_policies")),true);assert.equal(database.writes.some(sql=>/outbox_messages|pet_explore_(?:settlements|rounds|participations|settlement_input_snapshots)/i.test(sql)),false);assert.equal([...database.reads,...strict.statements].some(sql=>/FOR UPDATE|\b(?:INSERT|UPDATE|DELETE)\b/i.test(sql)),false);});

  it("reaches fail-closed settlement parity validation through the actual ingress and persists only FAILED claims",async()=>{const cases=[{name:"policy",strict:strictSettlementParticipant({policy:{policy_version:PET_EXPLORE_SETTLEMENT_POLICY_VERSION,policy_hash:PET_EXPLORE_SETTLEMENT_POLICY_HASH,policy_document_json:"{}"}}),code:"PET_EXPLORE_SNAPSHOT_POLICY_HASH_MISMATCH"},{name:"destination",strict:strictSettlementParticipant({destinations:destinationRows().map((row,index)=>index===0?{...row,destination_code:"regular_mine"}:row)}),code:"PET_EXPLORE_SNAPSHOT_POLICY_INCOMPLETE"},{name:"reward",strict:strictSettlementParticipant({destinations:destinationRows().map((row,index)=>index===3?{...row,success_rewards_json:[{itemCode:"wrong",quantity:"1"}]}:row)}),code:"PET_EXPLORE_SNAPSHOT_DESTINATION_POLICY_MISMATCH"},{name:"premium",strict:strictSettlementParticipant({source:sourceRow({threshold_components_json:{...threshold,premium:1}})}),code:"PET_EXPLORE_PREMIUM_POLICY_CONFLICT"},{name:"up-item",strict:strictSettlementParticipant({source:sourceRow({threshold_components_json:{...threshold,upItem:1}})}),code:"PET_EXPLORE_SNAPSHOT_SOURCE_GAP"},{name:"over-100",strict:strictSettlementParticipant({source:sourceRow({threshold_components_json:{...threshold,tier:10000}})}),code:"PET_EXPLORE_SNAPSHOT_SOURCE_GAP"},{name:"source-hash",strict:strictSettlementParticipant({source:sourceRow({source_hash:"0".repeat(64)})}),code:"PET_EXPLORE_SNAPSHOT_SOURCE_HASH_MISMATCH"}];for(const testCase of cases){const database=new ClaimDatabase();database.readHandler=testCase.strict.participant;const ingress=new PetExploreAppWiringIngress(await provider(database),dispatcher({route:"SHADOW",reasonCode:"ROLLOUT_SHADOW",commandCode:"ADMIN_PET_EXPLORE_SETTLEMENT",handlerKey:"pet_explore_settlement"},[]));await assert.rejects(()=>ingress.handle(settlementCommandEvent({eventId:`validation-${testCase.name}`})),(error:unknown)=>error instanceof Error&&"code"in error&&error.code===testCase.code);assert.equal(database.row?.claim_state,"FAILED");assert.equal(database.writes.some(sql=>/outbox_messages|pet_explore_(?:settlements|rounds|participations|settlement_input_snapshots)/i.test(sql)),false);}});
});

describe("MariaPetExploreShadowEvaluator",()=>{
  it("builds deterministic event-control and the fixed settlement-plan fingerprint from real preview projections",async()=>{
    const statements:string[]=[];
    const settlement=strictSettlementParticipant();
    const participant:AppWiringReadParticipant={query:async<T>(sql:string,values?:readonly unknown[])=>{if(sql.includes("operator.id operator_id")){statements.push(sql);return[{operator_id:7n}]as T}if(sql.includes("pet_explore_runtime_config")){statements.push(sql);return[{event_mine_active:1,guild_raid_active:0,version:4n}]as T}if(sql.includes("COUNT(*) participant_count")){statements.push(sql);return[{participant_count:3n}]as T}return settlement.participant.query<T>(sql,values);}};
    const evaluator=new MariaPetExploreShadowEvaluator();
    const control=await evaluator.preview(participant,"EVENT_CONTROL",settlementCommandEvent({message:"/펫탐험이벤트비활성화"}));assert.equal(control.summary.relocatedParticipantCount,"3");assert.equal(control.authorized,true);
    const first=await evaluator.preview(participant,"SETTLEMENT",settlementCommandEvent()),second=await evaluator.preview(participant,"SETTLEMENT",settlementCommandEvent());assert.equal(first.resultFingerprint,second.resultFingerprint);assert.equal(first.resultFingerprint,"a31d8f1de1458225195fa4afd461794da2e309619f2275258c3d53cab439195b");assert.deepEqual(first.summary,{roundKey:"round-1",participantCount:"1",nextAutoCount:"0",requestFingerprint:"75e9f50e505d4449f98e6a631949d9a71fbdc7d40d4f60ceaa91c7884d0dd613"});
    assert.equal([...statements,...settlement.statements].some(sql=>/FOR UPDATE|\b(?:INSERT|UPDATE|DELETE)\b/i.test(sql)),false);
  });

  it("stops unauthorized settlement before every plan query",async()=>{const strict=strictSettlementParticipant({authorized:false}),result=await new MariaPetExploreShadowEvaluator().preview(strict.participant,"SETTLEMENT",settlementCommandEvent());assert.equal(result.authorized,false);assert.equal(strict.statements.length,1);assert.match(strict.statements[0]!,/mapping\.operator_id/);});

  it("stops unauthorized event control after its sole authority SQL",async()=>{const run=async()=>{const statements:string[]=[],participant:AppWiringReadParticipant={query:async<T>(sql:string)=>{statements.push(sql);if(sql.includes("operator.id operator_id"))return[]as T;throw new Error(`UNEXPECTED_SQL:${sql}`);}},result=await new MariaPetExploreShadowEvaluator().preview(participant,"EVENT_CONTROL",settlementCommandEvent({message:"/펫탐험이벤트비활성화"}));assert.equal(result.authorized,false);assert.deepEqual(result.summary,{eventCode:"diamond_mine",requestedActive:false,authorized:false});assert.equal(statements.length,1);assert.match(statements[0]!,/operator\.id operator_id/);return result.resultFingerprint;};assert.equal(await run(),await run());});

  it("validates exact destination slots, complete thresholds, source evidence and next-auto binding",async()=>{
    const direct=await previewPetExploreSettlementInput(strictSettlementParticipant().participant,{eventId:"settlement-event",operatorId:"7",destinationId:"room"});assert.equal(direct.input.plans[0]?.successThresholdBasisPoints,1000);
    const badDest:Row[]=destinationRows();badDest[0]={...badDest[0]!,destination_code:"regular_mine"};await assert.rejects(()=>previewPetExploreSettlementInput(strictSettlementParticipant({destinations:badDest}).participant,{eventId:"bad-dest",operatorId:"7",destinationId:"room"}),/destination identity\/source slot mapping is invalid/);
    for(const badThreshold of [{...threshold,tier:Number.NaN},Object.fromEntries(Object.entries(threshold).filter(([key])=>key!=="lord")),{...threshold,extra:0}]){const badSource=sourceRow({threshold_components_json:badThreshold});await assert.rejects(()=>previewPetExploreSettlementInput(strictSettlementParticipant({source:badSource}).participant,{eventId:"bad-threshold",operatorId:"7",destinationId:"room"}),(error:unknown)=>error instanceof Error&&"code"in error&&error.code==="PET_EXPLORE_SNAPSHOT_THRESHOLD_COMPONENT_INVALID");}
    for(const gaps of [[""],["unknown_gap"],["treasure_map_reward","treasure_map_reward"]]){const badSource=sourceRow({source_gap_codes_json:gaps});await assert.rejects(()=>previewPetExploreSettlementInput(strictSettlementParticipant({source:badSource}).participant,{eventId:"bad-gap",operatorId:"7",destinationId:"room"}),/participant_source_gap_codes_invalid/);}
    const auto=await previewPetExploreSettlementInput(strictSettlementParticipant({configs:[{player_id:51n,destination_code:"3"}],rounds:[{id:11n,round_key:"round-1",version:3n,state_code:"open"},{id:12n,round_key:"round-2",version:5n,state_code:"open"}],nextExisting:[{player_id:51n,version:4n}]}).participant,{eventId:"auto",operatorId:"7",destinationId:"room"});assert.deepEqual(auto.input.nextAutoReservations,[{mode:"auto",roundKey:"round-2",playerId:"51",destinationCode:"luck_mine",expectedRoundVersion:"5",expectedParticipationVersion:"4",idempotencyKey:"auto:next-auto:51",reason:"pet explore settlement next automatic reservation",sourceCode:"scheduler"}]);
    await assert.rejects(()=>previewPetExploreSettlementInput(strictSettlementParticipant({configs:[{player_id:51n,destination_code:"3"}],rounds:[{id:11n,round_key:"round-1",version:3n,state_code:"open"}]}).participant,{eventId:"missing-next",operatorId:"7",destinationId:"room"}),/exactly one current and one next-auto open round/);
    await assert.rejects(()=>previewPetExploreSettlementInput(strictSettlementParticipant({configs:[{player_id:51n,destination_code:"unknown"}],rounds:[{id:11n,round_key:"round-1",version:3n,state_code:"open"},{id:12n,round_key:"round-2",version:5n,state_code:"open"}]}).participant,{eventId:"bad-auto-destination",operatorId:"7",destinationId:"room"}),(error:unknown)=>error instanceof ApplicationError&&error.details?.gapCode==="auto_destination_binding");
    await assert.rejects(()=>previewPetExploreSettlementInput(strictSettlementParticipant({configs:[{player_id:51n,destination_code:"3"}],rounds:[{id:11n,round_key:"round-1",version:3n,state_code:"open"},{id:12n,round_key:"round-2",version:0n,state_code:"open"}]}).participant,{eventId:"bad-next-version",operatorId:"7",destinationId:"room"}),/nextAuto\.expectedRoundVersion/);
    await assert.rejects(()=>previewPetExploreSettlementInput(strictSettlementParticipant({configs:[{player_id:51n,destination_code:"3"}],rounds:[{id:11n,round_key:"round-1",version:3n,state_code:"open"},{id:12n,round_key:"round-2",version:5n,state_code:"open"},{id:13n,round_key:"round-3",version:1n,state_code:"open"}]}).participant,{eventId:"extra-next",operatorId:"7",destinationId:"room"}),/exactly one current and one next-auto open round/);
  });
});

describe("PET_EXPLORE app composition",()=>{
  it("constructs one verified capable provider and preserves both manifest-visible wrapper seams",()=>{
    const app=readFileSync(new URL("../src/app.ts",import.meta.url),"utf8"),ingress=readFileSync(new URL("../src/pet/pet-explore-app-wiring-ingress.ts",import.meta.url),"utf8");
    assert.match(app,/database !== undefined && dependencies\.environmentContext !== undefined && hasDatabaseTransactionCapabilities\(database\)/);
    assert.match(app,/new MariaAppWiringOperationProvider\(database, dependencies\.environmentContext\)/);
    assert.match(app,/dispatchPetExploreSettlementCommand\(ingress,isOperationalChannel,duplicate,event\)/);
    assert.match(app,/dispatchPetExploreEventControlCommand\(ingress,isOperationalChannel,duplicate,event\)/);
    assert.doesNotMatch(app,/new PetExplore(?:SettlementCommandConsumer|EventControlCommandService)\(/);
    assert.equal(ingress.match(/executeAppWiringEntrypoint<PetExploreAppWiringIngressResult>\(/g)?.length,1);
  });
});
