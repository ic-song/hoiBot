import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { LegacyRankLabelSideEffectReadinessProvider } from "../src/inventory/legacy-rank-label-side-effect-readiness-provider.js";
import { classifyLegacyGuildPointer } from "../src/data-migration/legacy-rank-label-side-effect-certificate-projector.js";
import { LEGACY_RANK_LABEL_BAG_COMMAND_ANCHOR_SHA256, LEGACY_RANK_LABEL_RUNTIME_SOURCE_SHA256, LEGACY_RANK_LABEL_RUNTIME_SYMBOL_HASHES } from "../src/inventory/legacy-rank-label-runtime-source-contract.js";
import { calculateLegacyRankLabelCertificateFingerprint, calculateLegacyRankLabelCertificateSetSha256, calculateLegacyRankLabelMembershipSemanticSha256, calculateLegacyRankLabelValidationFingerprint } from "../src/inventory/legacy-rank-label-side-effect-certificate-contract.js";

const hash="a".repeat(64);
const context={canonicalPlayerId:"p0000001",legacyPlayerId:"1",externalIdentityId:"1",displayName:"Alice",rankEmoji:"🌟",platformCode:"kakao",externalContextId:"room",selectionSource:"ACTIVE_CONTEXT" as const};
const current={sourcePlayerKeySha256:createHash("sha256").update("Alice").digest("hex"),playerId:"p0000001",memberPresenceState:"PRESENT",guildPointerState:"VALID",sideEffectDecision:"NO_WRITE",guildPointerFingerprint:hash,membershipEvidenceFingerprint:hash};
const castle={sourcePlayerKeySha256:createHash("sha256").update("Lord").digest("hex"),playerId:"p0000002",memberPresenceState:"PRESENT",guildPointerState:"NONE",sideEffectDecision:"NO_WRITE",guildPointerFingerprint:hash,membershipEvidenceFingerprint:hash};
const certificates=[current,castle].map(value=>({...value,certificateFingerprint:calculateLegacyRankLabelCertificateFingerprint(value)})).sort((left,right)=>left.sourcePlayerKeySha256.localeCompare(right.sourcePlayerKeySha256));
const certificateSetSha256=calculateLegacyRankLabelCertificateSetSha256(certificates),membershipSemanticSha256=calculateLegacyRankLabelMembershipSemanticSha256(certificates);
const allCertificateRows=certificates.map(value=>[value.sourcePlayerKeySha256,value.playerId,value.memberPresenceState,value.guildPointerState,value.sideEffectDecision,value.guildPointerFingerprint,value.membershipEvidenceFingerprint,value.certificateFingerprint,"1","1"].join("|")).join("\n");
const validationFields={rawLandingRunId:"r0000001",commonStagingRunId:"s0000001",objectDomainImportRunId:"i0000001",memberSourcePathSha256:"b".repeat(64),memberSourceContentSha256:hash,guildSourcePathSha256:"c".repeat(64),guildSourceContentSha256:hash,rankMarkerSourceFingerprint:hash,legacyRuntimeSourceSha256:LEGACY_RANK_LABEL_RUNTIME_SOURCE_SHA256,membershipSemanticSha256,certificateSetSha256,counts:{noWrite:2,wouldDelete:0,unmapped:0},status:"COMPLETE",projectionVersion:"LEGACY_RANK_LABEL_SIDE_EFFECT_V1"};
const readyRow={legacy_rank_label_validation_run_id:"v0000001",raw_landing_run_id:validationFields.rawLandingRunId,common_staging_run_id:validationFields.commonStagingRunId,object_domain_import_run_id:validationFields.objectDomainImportRunId,member_source_path_sha256:validationFields.memberSourcePathSha256,member_source_content_sha256:hash,guild_source_path_sha256:validationFields.guildSourcePathSha256,guild_source_content_sha256:hash,rank_marker_source_fingerprint:hash,membership_semantic_sha256:membershipSemanticSha256,projection_version:validationFields.projectionVersion,run_status:validationFields.status,expected_subject_count:2,no_write_count:2,would_delete_count:0,unmapped_count:0,actual_certificate_count:2,actual_no_write_count:2,actual_would_delete_count:0,actual_unmapped_count:0,validation_fingerprint:calculateLegacyRankLabelValidationFingerprint(validationFields),certificate_set_sha256:certificateSetSha256,actual_certificate_set_sha256:certificateSetSha256,all_certificate_rows:allCertificateRows,legacy_runtime_source_sha256:LEGACY_RANK_LABEL_RUNTIME_SOURCE_SHA256,current_decision:current.sideEffectDecision,current_presence:current.memberPresenceState,current_certificate_fingerprint:certificates.find(value=>value.playerId===current.playerId)!.certificateFingerprint,current_source_player_key_sha256:current.sourcePlayerKeySha256,current_player_id:current.playerId,current_guild_pointer_state:current.guildPointerState,current_guild_pointer_fingerprint:current.guildPointerFingerprint,current_membership_evidence_fingerprint:current.membershipEvidenceFingerprint,castle_assignment_status:"ASSIGNED",castle_player_id:"p0000002",castle_marker_fingerprint:hash,castle_decision:castle.sideEffectDecision,castle_certificate_fingerprint:certificates.find(value=>value.playerId===castle.playerId)!.certificateFingerprint,castle_source_player_key_sha256:castle.sourcePlayerKeySha256,castle_certificate_player_id:castle.playerId,castle_presence:castle.memberPresenceState,castle_guild_pointer_state:castle.guildPointerState,castle_guild_pointer_fingerprint:castle.guildPointerFingerprint,castle_membership_evidence_fingerprint:castle.membershipEvidenceFingerprint,completeness_projection_version:"OBJECT_DOMAIN_IMPORT_RELEVANT_V3",completeness_revision:1,completeness_fingerprint:hash,raw_member_content_match:1,raw_guild_content_match:1};

test("readiness verifies current player, castle lord, snapshot freshness and WBS777 using SELECT only",async()=>{
  let sql="";let values:readonly unknown[]=[];
  const result=await new LegacyRankLabelSideEffectReadinessProvider().resolve({query:async<T>(statement:string,parameters:readonly unknown[]=[])=>{sql=statement;values=parameters;return [readyRow] as T;}},context);
  assert.deepEqual(result,{ready:true,reasonCode:"READY",validationRunId:"v0000001"});
  assert.deepEqual(values,["p0000001","p0000001"]);
  assert.match(sql,/player_item_bag_import_completeness_projections/);
  assert.match(sql,/marker\.marker_kind='CASTLE_LORD'/);
  assert.match(sql,/SHA2\(member_file\.payload,256\)/);
  assert.match(sql,/data_migration_object_domain_import_records binding_receipt/);
  assert.match(sql,/catalog\.common_staging_run_id=validation\.common_staging_run_id/);
  assert.match(sql,/binding_projection\.catalog_projection_run_id=import_run\.catalog_projection_run_id/);
  assert.match(sql,/binding_decision\.catalog_projection_run_id=binding_projection\.catalog_projection_run_id/);
  assert.match(sql,/binding_staging\.common_staging_run_id=validation\.common_staging_run_id/);
  assert.match(sql,/binding_staging\.source_path_sha256=validation\.member_source_path_sha256/);
  assert.doesNotMatch(sql,/current_display_name/);
  assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/i);
});

test("readiness fails closed for missing, stale, malformed, or query-error evidence",async()=>{
  const provider=new LegacyRankLabelSideEffectReadinessProvider();
  const query=async<T>()=>[] as T;
  assert.deepEqual(await provider.resolve({query},context),{ready:false,reasonCode:"LEGACY_SIDE_EFFECT_PARITY_UNPROVEN"});
  assert.deepEqual(await provider.resolve({query:async<T>()=>[{...readyRow,raw_guild_content_match:0}] as T},context),{ready:false,reasonCode:"LEGACY_SIDE_EFFECT_PARITY_UNPROVEN"});
  assert.deepEqual(await provider.resolve({query:async<T>()=>[{...readyRow,current_decision:"WOULD_DELETE"}] as T},context),{ready:false,reasonCode:"LEGACY_SIDE_EFFECT_PARITY_UNPROVEN"});
  assert.deepEqual(await provider.resolve({query:async<T>()=>[{...readyRow,current_certificate_fingerprint:"f".repeat(64)}] as T},context),{ready:false,reasonCode:"LEGACY_SIDE_EFFECT_PARITY_UNPROVEN"});
  assert.deepEqual(await provider.resolve({query:async<T>()=>[{...readyRow,actual_certificate_count:1}] as T},context),{ready:false,reasonCode:"LEGACY_SIDE_EFFECT_PARITY_UNPROVEN"});
  assert.deepEqual(await provider.resolve({query:async<T>()=>[{...readyRow,actual_certificate_set_sha256:"f".repeat(64)}] as T},context),{ready:false,reasonCode:"LEGACY_SIDE_EFFECT_PARITY_UNPROVEN"});
  assert.deepEqual(await provider.resolve({query:async<T>()=>[{...readyRow,validation_fingerprint:"f".repeat(64)}] as T},context),{ready:false,reasonCode:"LEGACY_SIDE_EFFECT_PARITY_UNPROVEN"});
  assert.deepEqual(await provider.resolve({query:async<T>()=>[{...readyRow,common_staging_run_id:"s0000002"}] as T},context),{ready:false,reasonCode:"LEGACY_SIDE_EFFECT_PARITY_UNPROVEN"});
  assert.deepEqual(await provider.resolve({query:async<T>()=>[{...readyRow,member_source_path_sha256:"d".repeat(64)}] as T},context),{ready:false,reasonCode:"LEGACY_SIDE_EFFECT_PARITY_UNPROVEN"});
  assert.deepEqual(await provider.resolve({query:async<T>()=>[{...readyRow,guild_source_path_sha256:"e".repeat(64)}] as T},context),{ready:false,reasonCode:"LEGACY_SIDE_EFFECT_PARITY_UNPROVEN"});
  const tamperedOther=readyRow.all_certificate_rows.split("\n").map(line=>line.startsWith(castle.sourcePlayerKeySha256)?line.replace("|NONE|","|VALID|"):line).join("\n");
  assert.deepEqual(await provider.resolve({query:async<T>()=>[{...readyRow,all_certificate_rows:tamperedOther}] as T},context),{ready:false,reasonCode:"LEGACY_SIDE_EFFECT_PARITY_UNPROVEN"});
  const ambiguousIdentity=readyRow.all_certificate_rows.split("\n").map(line=>{const columns=line.split("|");if(line.startsWith(castle.sourcePlayerKeySha256))columns[8]="2";return columns.join("|");}).join("\n");
  assert.deepEqual(await provider.resolve({query:async<T>()=>[{...readyRow,all_certificate_rows:ambiguousIdentity}] as T},context),{ready:false,reasonCode:"LEGACY_SIDE_EFFECT_PARITY_UNPROVEN"});
  const duplicateProvenance=readyRow.all_certificate_rows.split("\n").map(line=>{const columns=line.split("|");if(line.startsWith(castle.sourcePlayerKeySha256))columns[9]="2";return columns.join("|");}).join("\n");
  assert.deepEqual(await provider.resolve({query:async<T>()=>[{...readyRow,all_certificate_rows:duplicateProvenance}] as T},context),{ready:false,reasonCode:"LEGACY_SIDE_EFFECT_PARITY_UNPROVEN"});
  assert.deepEqual(await provider.resolve({query:async<T>()=>[readyRow] as T},{...context,displayName:"Renamed"}),{ready:true,reasonCode:"READY",validationRunId:"v0000001"});
  assert.deepEqual(await provider.resolve({query:async<T>()=>[readyRow] as T},{...context,canonicalPlayerId:"p0000009"}),{ready:false,reasonCode:"LEGACY_SIDE_EFFECT_PARITY_UNPROVEN"});
  assert.deepEqual(await provider.resolve({query:async<T>()=>[{...readyRow,legacy_runtime_source_sha256:"f".repeat(64)}] as T},context),{ready:false,reasonCode:"LEGACY_SIDE_EFFECT_PARITY_UNPROVEN"});
  assert.deepEqual(await provider.resolve({query:async<T>()=>{throw new Error("offline");}},context),{ready:false,reasonCode:"LEGACY_SIDE_EFFECT_PARITY_UNPROVEN"});
});

test("unassigned castle lord is a valid empty case only when no lord certificate exists",async()=>{
  const provider=new LegacyRankLabelSideEffectReadinessProvider();
  const row={...readyRow,castle_assignment_status:"UNASSIGNED",castle_player_id:null,castle_decision:null,castle_certificate_fingerprint:null,castle_source_player_key_sha256:null,castle_certificate_player_id:null,castle_presence:null,castle_guild_pointer_state:null,castle_guild_pointer_fingerprint:null,castle_membership_evidence_fingerprint:null};
  assert.equal((await provider.resolve({query:async<T>()=>[row] as T},context)).ready,true);
  assert.equal((await provider.resolve({query:async<T>()=>[{...row,castle_decision:"NO_WRITE"}] as T},context)).ready,false);
});

test("migration 489 pins named PK/FK/audit and rollback refuses populated evidence",async()=>{
  const migration=await readFile(new URL("../migrations/489_legacy_rank_label_side_effect_certificate.sql",import.meta.url),"utf8");
  const rollback=await readFile(new URL("../migrations/rollback/489_legacy_rank_label_side_effect_certificate.rollback.sql",import.meta.url),"utf8");
  assert.match(migration,/legacy_rank_label_validation_run_id CHAR\(8\).*ascii_bin/);
  assert.match(migration,/FOREIGN KEY\(raw_landing_run_id\) REFERENCES data_migration_raw_runs\(raw_landing_run_id\)/);
  assert.match(migration,/FOREIGN KEY\(common_staging_run_id\) REFERENCES data_migration_common_staging_runs\(common_staging_run_id\)/);
  assert.match(migration,/FOREIGN KEY\(object_domain_import_run_id\) REFERENCES data_migration_object_domain_import_runs\(object_domain_import_run_id\)/);
  assert.match(migration,/INSERT_TIME CHAR\(19\)/);
  assert.match(rollback,/ROLLBACK_489_DATA_PRESENT/);
});

test("legacy getMyGuildInfo truthiness is certified for valid, no-guild, stale, and member-mismatch cases",()=>{
  assert.equal(classifyLegacyGuildPointer({}, {}, "Alice").sideEffectDecision,"NO_WRITE");
  assert.equal(classifyLegacyGuildPointer({guild:{id:"g1"}},{g1:{members:{Alice:{role:"master"}}}},"Alice").guildPointerState,"VALID");
  assert.equal(classifyLegacyGuildPointer({guild:{id:"missing"}},{},"Alice").guildPointerState,"STALE_GUILD");
  assert.equal(classifyLegacyGuildPointer({guild:{id:"g1"}},{g1:{members:{Bob:true}}},"Alice").guildPointerState,"MEMBER_MISMATCH");
  assert.equal(classifyLegacyGuildPointer({guild:{id:0}},{},"Alice").sideEffectDecision,"NO_WRITE");
});

function extractFunction(source:string,symbol:string):string{
  const start=source.indexOf(`function ${symbol}(`);if(start<0)throw new Error(`SYMBOL_NOT_FOUND:${symbol}`);
  const open=source.indexOf("{",start);let depth=0,state:"normal"|"single"|"double"|"template"|"line"|"block"="normal",escaped=false;
  for(let index=open;index<source.length;index+=1){const ch=source[index]!,next=source[index+1];if(state==="line"){if(ch==="\n")state="normal";continue;}if(state==="block"){if(ch==="*"&&next==="/"){state="normal";index+=1;}continue;}if(state!=="normal"){if(escaped){escaped=false;continue;}if(ch==="\\"){escaped=true;continue;}if((state==="single"&&ch==="'")||(state==="double"&&ch==='"')||(state==="template"&&ch==="`"))state="normal";continue;}if(ch==="/"&&next==="/"){state="line";index+=1;continue;}if(ch==="/"&&next==="*"){state="block";index+=1;continue;}if(ch==="'"){state="single";continue;}if(ch==='"'){state="double";continue;}if(ch==="`"){state="template";continue;}if(ch==="{")depth+=1;else if(ch==="}"&&--depth===0)return source.slice(start,index+1).replace(/\r\n/g,"\n");}
  throw new Error(`SYMBOL_UNTERMINATED:${symbol}`);
}

function extractBraceBlock(source:string,marker:string):string{
  const start=source.indexOf(marker);if(start<0)throw new Error(`ANCHOR_NOT_FOUND:${marker}`);
  const open=source.indexOf("{",start);let depth=0,state:"normal"|"single"|"double"|"template"|"line"|"block"="normal",escaped=false;
  for(let index=open;index<source.length;index+=1){const ch=source[index]!,next=source[index+1];if(state==="line"){if(ch==="\n")state="normal";continue;}if(state==="block"){if(ch==="*"&&next==="/"){state="normal";index+=1;}continue;}if(state!=="normal"){if(escaped){escaped=false;continue;}if(ch==="\\"){escaped=true;continue;}if((state==="single"&&ch==="'")||(state==="double"&&ch==='"')||(state==="template"&&ch==="`"))state="normal";continue;}if(ch==="/"&&next==="/"){state="line";index+=1;continue;}if(ch==="/"&&next==="*"){state="block";index+=1;continue;}if(ch==="'"){state="single";continue;}if(ch==='"'){state="double";continue;}if(ch==="`"){state="template";continue;}if(ch==="{")depth+=1;else if(ch==="}"&&--depth===0)return source.slice(start,index+1).replace(/\r\n/g,"\n");}
  throw new Error(`ANCHOR_UNTERMINATED:${marker}`);
}

test("frozen legacy source symbols and live saveJsonFile oracle stay bound to the classifier",async()=>{
  const source=await readFile(new URL("../../../main.js",import.meta.url),"utf8"),parts=LEGACY_RANK_LABEL_RUNTIME_SYMBOL_HASHES.map(entry=>({entry,body:extractFunction(source,entry.symbol)}));
  for(const part of parts)assert.equal(createHash("sha256").update(part.body).digest("hex"),part.entry.sha256);
  const combined=parts.map(part=>`${part.entry.symbol}:${part.entry.sha256}`).join("\n");assert.equal(createHash("sha256").update(combined).digest("hex"),LEGACY_RANK_LABEL_RUNTIME_SOURCE_SHA256);
  const getId=parts.find(part=>part.entry.symbol==="getMyGuildId")!.body,getInfo=parts.find(part=>part.entry.symbol==="getMyGuildInfo")!.body;
  for(const fixture of [{member:{},guilds:{},expected:"NONE"},{member:{guild:{id:"g1"}},guilds:{g1:{members:{Alice:true}}},expected:"VALID"},{member:{guild:{id:"missing"}},guilds:{},expected:"STALE_GUILD"},{member:{guild:{id:"g1"}},guilds:{g1:{members:{Bob:true}}},expected:"MEMBER_MISMATCH"}]){
    const classified=classifyLegacyGuildPointer(fixture.member,fixture.guilds,"Alice");
    let saves=0;const sandbox:{data:unknown;guildData:unknown;saveJsonFile:()=>void;filePath:string;result?:unknown}={data:{member:{Alice:fixture.member}},guildData:{guilds:fixture.guilds},saveJsonFile:()=>{saves+=1;},filePath:"forbidden-operational-path"};
    vm.runInNewContext(`${getId}\n${getInfo}\nresult=getMyGuildInfo(data,guildData,"Alice");`,sandbox);
    assert.equal(classified.guildPointerState,fixture.expected);assert.equal(saves,classified.sideEffectDecision==="WOULD_DELETE"?1:0);
  }
});

test("actual checkRank call chain preserves bag anchor and legacy save counts",async()=>{
  const source=await readFile(new URL("../../../main.js",import.meta.url),"utf8");
  const checkRank=extractFunction(source,"checkRank"),getId=extractFunction(source,"getMyGuildId"),getInfo=extractFunction(source,"getMyGuildInfo");
  const bagAnchor=extractBraceBlock(source,'if (msg === "/가방" || msg === "ㄴㄴㄴ")');
  assert.equal(createHash("sha256").update(bagAnchor).digest("hex"),LEGACY_RANK_LABEL_BAG_COMMAND_ANCHOR_SHA256);
  assert.match(bagAnchor,/checkRank\(data, petData, guildData, sender\)/);
  const fixtures=[
    {name:"valid",aliceGuild:"g1",lordGuild:"g1",guilds:{g1:{name:"Guild",rank:1,members:{Alice:true,Lord:true}}},expectedSaves:0},
    {name:"no-guild",aliceGuild:null,lordGuild:null,guilds:{},expectedSaves:0},
    {name:"current-stale",aliceGuild:"missing-a",lordGuild:"g1",guilds:{g1:{name:"Guild",rank:1,members:{Lord:true}}},expectedSaves:1},
    {name:"lord-stale",aliceGuild:"g1",lordGuild:"missing-l",guilds:{g1:{name:"Guild",rank:1,members:{Alice:true}}},expectedSaves:1},
    {name:"both-stale",aliceGuild:"missing-a",lordGuild:"missing-l",guilds:{},expectedSaves:2},
  ];
  for(const fixture of fixtures){
    const member=(guildId:string|null)=>({rank:{emoji:"R"},...(guildId?{guild:{id:guildId}}:{})});
    const alice=member(fixture.aliceGuild),lord=member(fixture.lordGuild);
    const aliceDecision=classifyLegacyGuildPointer(alice,fixture.guilds,"Alice").sideEffectDecision;
    const lordDecision=classifyLegacyGuildPointer(lord,fixture.guilds,"Lord").sideEffectDecision;
    const certifiedDeletes=[aliceDecision,lordDecision].filter(decision=>decision==="WOULD_DELETE").length;
    assert.equal(certifiedDeletes,fixture.expectedSaves,`${fixture.name}: classifier/certificate intent`);
    let saves=0,petReads=0;
    const poisonPetData=new Proxy({}, {get(){petReads+=1;throw new Error("PET_RANK_MUST_NOT_READ_PET_DATA");}});
    const sandbox:{data:unknown;petData:unknown;guildData:unknown;saveJsonFile:()=>void;loadJsonFile:()=>unknown;filePath:string;guildPath:string;getGuildMasterRankEmoji:()=>string;result?:unknown}={
      data:{member:{Alice:alice,Lord:lord,Sentinel:{rank:{emoji:"S"},guild:{id:"untouched"},other:{value:7}}},HoiCastle:{lord:"Lord"},other:{value:9}},petData:poisonPetData,guildData:{guilds:fixture.guilds},
      saveJsonFile:()=>{saves+=1;},loadJsonFile:()=>({guilds:fixture.guilds}),filePath:"forbidden-operational-path",guildPath:"forbidden-guild-path",getGuildMasterRankEmoji:()=>"",
    };
    const expectedData=structuredClone(sandbox.data) as {member:Record<string,{guild?:unknown}>};
    if(aliceDecision==="WOULD_DELETE")delete expectedData.member.Alice!.guild;
    if(lordDecision==="WOULD_DELETE")delete expectedData.member.Lord!.guild;
    vm.runInNewContext(`${getId}\n${getInfo}\n${checkRank}\nresult=checkRank(data,petData,guildData,"Alice");`,sandbox);
    assert.equal(saves,fixture.expectedSaves,`${fixture.name}: actual checkRank saveJsonFile count`);
    assert.equal(petReads,0,`${fixture.name}: unreachable petData dependency`);
    assert.deepEqual(sandbox.data,expectedData,`${fixture.name}: only stale guild fields may be deleted`);
  }
});
