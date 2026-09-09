import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { BagShadowParityProvider } from "../../src/inventory/bag-shadow-parity-provider.js";
import { MariaCanonicalPetSkillReadinessProvider } from "../../src/pet/canonical-pet-skill-readiness-provider.js";
import { projectCanonicalPetSkillSeed } from "../../src/pet/canonical-pet-skill-read-seed.js";
import { PetSkillInfoShadowService } from "../../src/pet/pet-skill-info-shadow-service.js";
import { createEnvironmentContext, verifyStartupDatabaseIdentity } from "../../src/runtime/environment-context.js";

const MODULE_EXECUTION_ID=randomUUID();
const assert=(value,message)=>{if(!value)throw new Error(message);};
const normalize=sql=>String(sql).replace(/\s+/g," ").trim();
const sha=value=>createHash("sha256").update(typeof value==="string"?value:JSON.stringify(value)).digest("hex");
const bagIdentity={legacy_player_id:900000001n,display_name:"합성 테스터🧪",legacy_identity_status:"linked",canonical_player_id:"playeraa",crosswalk_status:"LINKED"};
const bagLegacy=[
  {record_id:1n,display_name:"펫 친밀도🐾 [Lv.2](3/1000)+4💕",quantity:1n,legacy_bag_order:null,stackable_flag:true},
  {record_id:2n,display_name:"합성 물약✨",quantity:9007199254740993n,legacy_bag_order:null,stackable_flag:1},
  {record_id:3n,display_name:"잡템☠️",quantity:20n,legacy_bag_order:"20",stackable_flag:1n},
];
const bagCanonical=[
  {record_id:"stack001",player_id:"playeraa",item_id:"it000001",display_name:"펫 친밀도🐾 [Lv.2](3/1000)+4💕",quantity:"1",legacy_bag_order:null,stackable_flag:true},
  {record_id:"stack002",player_id:"playeraa",item_id:"it000002",display_name:"합성 물약✨",quantity:"9007199254740993",legacy_bag_order:null,stackable_flag:1},
  {record_id:"stack003",player_id:"playeraa",item_id:"it000003",display_name:"잡템☠️",quantity:"20",legacy_bag_order:20n,stackable_flag:1n},
];
const bagDefinitions=bagCanonical.map(row=>({item_id:row.item_id,item_name:row.display_name,item_description:null,item_kind:"fixture",item_grade:null,price_amount:null,price_currency_source_identifier:null,stackable_flag:row.stackable_flag,active_flag:true,definition_options:null}));

function participant(resolver,calls){return{async query(sql,values=[]){const normalizedSql=normalize(sql);assert(/^SELECT\b/i.test(normalizedSql),"Wave18 non-SELECT query");assert(!/\b(?:INSERT|UPDATE|DELETE|REPLACE|CALL|SET|MERGE|TRUNCATE)\b|FOR\s+UPDATE/i.test(normalizedSql),"Wave18 mutating query");const rows=await resolver(normalizedSql,values);calls.push({channel:"query",normalizedSql,values,rowCount:Array.isArray(rows)?rows.length:0});return rows;}};}
function bagParticipant(calls,identityRows=[bagIdentity]){return participant(async(sql,values)=>{
  if(sql.includes("canonical_player_identity_crosswalks")){assert(JSON.stringify(values)===JSON.stringify(["kakao","external-1"]),"bag identity binding drift");return identityRows;}
  if(sql.includes("FROM inventory_stacks"))return bagLegacy;
  if(sql.includes("FROM canonical_owned_item_stacks"))return bagCanonical;
  if(sql.includes("FROM canonical_owned_item_instances"))return[];
  if(sql.includes("FROM canonical_players"))return[{player_id:"playeraa"}];
  if(sql.includes("FROM canonical_item_definitions"))return bagDefinitions;
  if(sql.includes("FROM canonical_owned_pet_instances")||sql.includes("FROM canonical_pet_definitions")||sql.includes("FROM canonical_owned_equipment_instances")||sql.includes("FROM canonical_equipment_definitions"))return[];
  throw new Error(`WAVE18_BAG_SQL_UNEXPECTED:${sql}`);
},calls);}

const skillRows=[{pet_skill_id:"skill001",pet_skill_name:"청룡언월도",pet_skill_description:"효과",pet_skill_grade:"S",legacy_source_key:"skill_000",display_order:1,base_draw_rate:"100",fixed_draw_rate_flag:1,openable_flag:1,pet_skill_grade_emoji:"📙",required_tier_name:null,tier_exclusive_flag:0,equip_description:null,handler_key:"presentation_only",options_json:{},active_flag:1}];
function petParticipant(calls){return participant(async sql=>{
  if(sql.includes("player_profiles profile"))return[];
  if(sql.includes("canonical_pet_skill_aliases")||sql.includes("grade_policies"))return[];
  if(sql.includes("CAST(raid_charm_bonus"))return[{pet_skill_id:"skill001",raid_charm_bonus:"1000000",castle_charm_bonus:"1000000"}];
  if(sql.includes("canonical_pet_skill_definitions"))return skillRows;
  throw new Error(`WAVE18_PET_SQL_UNEXPECTED:${sql}`);
},calls);}
function databaseFor(snapshot,counter){const no=async()=>{throw new Error("WAVE18_MUTABLE_DATABASE_PATH_FORBIDDEN");};return{ping:no,verifyRollback:no,query:no,execute:no,withTransaction:no,withControlledTransaction:no,close:no,withReadOnlySnapshot:async work=>{counter.count+=1;return work(snapshot);}};}

const baseline=JSON.parse(readFileSync(new URL("../../../migration-control/fixtures/synthetic-relational/pet-skill-definitions-v2400.json",import.meta.url),"utf8"));
const additions=JSON.parse(readFileSync(new URL("../../../migration-control/fixtures/synthetic-relational/pet-skill-post-freeze-v2435.json",import.meta.url),"utf8"));
const active93=()=>{const rows=[...baseline];for(const addition of[...additions.rows].sort((a,b)=>a.runtimeSourceIndex-b.runtimeSourceIndex))rows.splice(addition.runtimeSourceIndex,0,addition);return rows;};
const projection=projectCanonicalPetSkillSeed(active93(),{S:10.5,A:18.1,B:20,C:47.7},additions.sourceHash);
const policies=[{pet_skill_grade:"S",grade_probability_total:"10.5",display_order:1,active_flag:1},{pet_skill_grade:"A",grade_probability_total:"18.1",display_order:2,active_flag:1},{pet_skill_grade:"B",grade_probability_total:"20",display_order:3,active_flag:1},{pet_skill_grade:"C",grade_probability_total:"47.7",display_order:4,active_flag:1}];
const petSkillIdBySource=new Map(projection.definitions.map((row,index)=>[row.sourceKey,`s${String(index).padStart(7,"0")}`]));
const readinessDefinitions=projection.definitions.map(row=>({pet_skill_id:petSkillIdBySource.get(row.sourceKey),pet_skill_name:row.source.name,pet_skill_description:row.source.effect,pet_skill_grade:row.source.grade,legacy_source_key:row.sourceKey,display_order:row.displayOrder,base_draw_rate:String(row.source.rate??0),fixed_draw_rate_flag:row.source.fixedRate===true?1:0,openable_flag:row.source.openable!==false?1:0,pet_skill_grade_emoji:"📙",required_tier_name:row.source.requiredTier??null,tier_exclusive_flag:row.source.tierExclusive===true?1:0,equip_description:row.source.equipComment??null,handler_key:row.handlerKey,options_json:row.options,raid_charm_bonus:String(Number(row.source.raidExp??0)),castle_charm_bonus:String(Number(row.source.castleExp??0)),active_flag:1,source_identifier:row.sourceKey,payload_fingerprint:sha([row.source.name,row.source.effect,row.source.grade,row.handlerKey,row.options,true])}));
const readinessAliases=projection.aliases.map((row,index)=>({pet_skill_alias_id:`a${String(index).padStart(7,"0")}`,pet_skill_id:petSkillIdBySource.get(row.sourceKey),source_identifier:row.sourceKey,alias_type:"legacy_name",alias_value:row.aliasValue,normalized_alias_value:row.normalizedAliasValue,active_flag:1}));
function readinessParticipant(calls,{databaseIdentity="wave18_read4",counts={definitions:93,imports:93,aliases:30,policies:4},tamper=false}={}){return participant(async sql=>{
  if(sql==="SELECT DATABASE() AS database_identity")return[{database_identity:databaseIdentity}];
  if(sql.includes("SELECT DATABASE() database_identity"))return[{database_identity:databaseIdentity,...counts}];
  if(sql.includes("SELECT definition.pet_skill_id"))return tamper?[{...readinessDefinitions[0],payload_fingerprint:"0".repeat(64)},...readinessDefinitions.slice(1)]:readinessDefinitions;
  if(sql.includes("SELECT import_row.source_identifier,alias_row.alias_type"))return readinessAliases;
  if(sql.startsWith("SELECT pet_skill_grade"))return policies;
  if(sql.includes("FROM canonical_pet_skill_aliases"))return readinessAliases;
  if(sql.includes("FROM canonical_pet_skill_draw_grade_policies"))return policies.map((row,index)=>({...row,pet_skill_draw_grade_policy_id:`p${String(index).padStart(7,"0")}`}));
  if(sql.includes("FROM canonical_pet_skill_definitions"))return readinessDefinitions;
  throw new Error(`WAVE18_READINESS_SQL_UNEXPECTED:${sql}`);
},calls);}

const expectedBindings={executeWave18BagCompare:"sql-repository-3001ad9fc2f36d01",executeWave18PetEvaluate:"sql-repository-41a1be35f0d83825",executeWave18PetReadinessInspect:"sql-repository-4fdd013faca84a3f",executeWave18PetEvaluateInSnapshot:"sql-repository-55dcd683c5528d65"};
function output(binding,result,calls,assertionCount,extra={}){assert(expectedBindings[binding.exportName]===binding.consumerId,"Wave18 consumer/export binding drift");assert(binding.harnessCaseId===`case:wave18:${binding.consumerId}`,"Wave18 harness case binding drift");const bytes=JSON.stringify(result);assert(sha(bytes)===binding.expectedResultSha256,`Wave18 independent expected drift: ${binding.scenarioKind}:${sha(bytes)}`);return{executedConsumerId:binding.consumerId,executedCaseId:binding.harnessCaseId,moduleExecutionId:MODULE_EXECUTION_ID,assertionCount,reply:"NO_REPLY",result:bytes,databaseEvidence:{calls,sourceDomainDmlCount:0,...extra}};}
export async function executeWave18BagCompare({binding}){const calls=[];let result,assertions=1;
  if(binding.scenarioKind==="NEGATIVE_GUARD"){const errors=[];for(const input of [["","external-1"],["kakao",""],["kakao","external-1"]])try{await new BagShadowParityProvider().compare(bagParticipant(calls,input[0]==="kakao"&&input[1]==="external-1"?[]:[bagIdentity]),input[0],input[1]);}catch(error){errors.push(error.message);}result={errors};assertions=5;}
  else{const value=await new BagShadowParityProvider().compare(bagParticipant(calls),"kakao","external-1");assert(calls.length===10,"Wave18 bag query count drift");result=binding.scenarioKind==="SOURCE_DOMAIN_DML_ZERO"?{value,transaction:"READ_ONLY",sourceDomainDmlCount:0}:value;assertions=8;}
  return output(binding,result,calls,assertions,{queryCount:calls.length});}
async function petEvaluation(binding,outer){const calls=[],counter={count:0},snapshot=petParticipant(calls),database=databaseFor(snapshot,counter),service=new PetSkillInfoShadowService(database);let result;
  if(binding.scenarioKind==="NEGATIVE_GUARD")result=outer?await service.evaluate({externalUserId:"u1",displayName:"다섯글자임",message:"/펫스킬정보 청룡언월도",actorContext:{externalIdentityId:"1"}}):await service.evaluateInSnapshot(snapshot,{externalUserId:"u1",displayName:"다섯글자임",message:"/펫스킬정보 청룡언월도",actorContext:{externalIdentityId:"1"}});
  else result=outer?await service.evaluate({externalUserId:"u1",displayName:"호이 남",message:"/펫스킬정보 청룡언월도",actorContext:{externalIdentityId:"1"}}):await service.evaluateInSnapshot(snapshot,{externalUserId:"u1",displayName:"호이 남",message:"/펫스킬정보 청룡언월도",actorContext:{externalIdentityId:"1"}});
  const value=binding.scenarioKind==="SOURCE_DOMAIN_DML_ZERO"?{value:result,transaction:"READ_ONLY",sourceDomainDmlCount:0,snapshotCount:counter.count}:result,expectedSnapshots=outer&&binding.scenarioKind!=="NEGATIVE_GUARD"?1:0;assert(counter.count===expectedSnapshots,"Wave18 snapshot ownership drift");return output(binding,value,calls,5,{snapshotCount:counter.count});}
export async function executeWave18PetEvaluate({binding}){return petEvaluation(binding,true);}
export async function executeWave18PetEvaluateInSnapshot({binding}){return petEvaluation(binding,false);}
export async function executeWave18PetReadinessInspect({binding}){const calls=[];let result,assertions=4;
  if(binding.scenarioKind==="NEGATIVE_GUARD"){
    const wrong=readinessParticipant(calls,{databaseIdentity:"wrong_db"}),context=await verifyStartupDatabaseIdentity(readinessParticipant(calls),createEnvironmentContext({environmentCode:"dev",databaseIdentity:"wave18_read4"}));let databaseIdentityError="";try{await new MariaCanonicalPetSkillReadinessProvider().inspect(wrong,context);}catch(error){databaseIdentityError=error.message;}
    let forgedContextError="";try{await new MariaCanonicalPetSkillReadinessProvider().inspect(readinessParticipant(calls),Object.freeze({environmentCode:"dev",databaseIdentity:"wave18_read4",requestNamespace:"hoibot:dev:wave18_read4"}));}catch(error){forgedContextError=error.message;}result={databaseIdentityError,forgedContextError};assertions=6;
  }else{const db=readinessParticipant(calls),context=await verifyStartupDatabaseIdentity(db,createEnvironmentContext({environmentCode:"dev",databaseIdentity:"wave18_read4"})),value=await new MariaCanonicalPetSkillReadinessProvider().inspect(db,context);result=binding.scenarioKind==="SOURCE_DOMAIN_DML_ZERO"?{value,transaction:"READ_ONLY",sourceDomainDmlCount:0}:value;}
  return output(binding,result,calls,assertions,{verifiedEnvironment:true,databaseIdentity:"wave18_read4"});}
