import assert from "node:assert/strict";
import fs from "node:fs";
import {describe,it} from "node:test";
import type {DatabaseClient,ReadOnlySnapshotTransaction} from "../src/database.js";
import {fingerprintPetSkillInfoBagStacks,fingerprintPetSkillInfoCatalog,formatLegacyPetSkillAdminBag,formatLegacyPetSkillInfo,isPetSkillInfoShadowCandidate,normalizePetSkillInfoDispatchMessage,parsePetSkillInfoShadowCommand,PetSkillInfoShadowService,resolveLegacyPetSkillInfo} from "../src/pet/pet-skill-info-shadow-service.js";
import {projectCanonicalPetSkillReadCatalog,type CanonicalPetSkillReadDefinition} from "../src/pet/canonical-pet-skill-read-provider.js";

type InfoDefinition=CanonicalPetSkillReadDefinition&{raidCharmBonus:number;castleCharmBonus:number};
const definition=(override:Partial<InfoDefinition>={}):InfoDefinition=>({petSkillId:"skill001",name:"청룡언월도",description:"삼국지 관우의 전설적인 무기입니다.",grade:"S",gradeEmoji:"📙",legacySourceKey:"skill_000",displayOrder:1,baseDrawRate:.1,actualRate:.1,fixedDrawRate:true,openable:true,requiredTierName:null,tierExclusive:false,equipDescription:null,raidCharmBonus:1000000,castleCharmBonus:1000000,handlerKey:"presentation_only",options:{},aliases:[],...override});
const exactCatalogRows=(names=["야수의본능","던전 탐험가","숨김"])=>Array.from({length:93},(_,index)=>({pet_skill_id:index<3?`skill00${index+1}`:`s${String(index).padStart(7,"0")}`,pet_skill_name:names[index]??`합성스킬${index}`,pet_skill_description:"효과",pet_skill_grade:index===0?"A":index===2?"C":"S",legacy_source_key:`skill_${String(index).padStart(3,"0")}`,display_order:index+1,base_draw_rate:index===0?"100":"0",fixed_draw_rate_flag:1,openable_flag:index===0?1:0,pet_skill_grade_emoji:"📙",required_tier_name:null,tier_exclusive_flag:0,equip_description:null,handler_key:"presentation_only",options_json:{},active_flag:1}));

describe("pet skill info shadow",()=>{
  it("preserves the legacy startsWith/no-argument/whitespace/suffix boundary without claiming sibling commands",()=>{
    assert.deepEqual(parsePetSkillInfoShadowCommand("/펫스킬정보"),{query:null});
    assert.deepEqual(parsePetSkillInfoShadowCommand("/펫스킬정보   "),{query:null});
    assert.deepEqual(parsePetSkillInfoShadowCommand("/펫스킬정보 청룡언월도"),{query:"청룡언월도"});
    assert.deepEqual(parsePetSkillInfoShadowCommand("/펫스킬정보청룡언월도"),{query:"청룡언월도"});
    for(const value of ["/펫스킬","/펫스킬확률",undefined])assert.equal(isPetSkillInfoShadowCandidate(value),false);
    assert.equal(normalizePetSkillInfoDispatchMessage("/펫스킬정보청룡언월도"),"/펫스킬정보 [조회값]");
  });

  it("matches exact legacy names and tier aliases, formats full bytes, and fails closed on ambiguity",()=>{
    const tier=definition({petSkillId:"skill089",name:"🐉 용용용의 용신 여의주",description:"용용용 티어부터 장착할 수 있습니다.\n장착 시 레이드/캐슬 매력 각각 2,100만 증가합니다.",grade:"S",actualRate:.4,tierExclusive:true,requiredTierName:"용용용",raidCharmBonus:21000000,castleCharmBonus:21000000,aliases:["용용용의 용신 여의주"]});
    assert.equal(resolveLegacyPetSkillInfo([tier],"용용용의 용신 여의주"),tier);
    assert.equal(formatLegacyPetSkillInfo(tier),"🐉 용용용의 용신 여의주📙\n등급: S\n확률: 0.4%\n효과: 용용용 티어부터 장착할 수 있습니다.\n장착 시 레이드/캐슬 매력 각각 2,100만 증가합니다.\n종합매력 4,200만 증가\n티어전용 펫스킬 중복 장착은 불가합니다.\n일반 종합매력 무기 펫스킬과는 중복 장착할 수 있습니다.");
    assert.throws(()=>resolveLegacyPetSkillInfo([tier,{...tier,petSkillId:"skill090"}],"용용용의 용신 여의주"),/LOOKUP_AMBIGUOUS/);
    const legacy=fs.readFileSync(new URL("../../../main.js",import.meta.url),"utf8");
    assert.match(legacy,/if \(msg\.startsWith\("\/펫스킬정보"\)\)/);
    assert.match(legacy,/등록되지 않은 펫스킬입니다\.\\n또는 존재하지 않는 유저입니다\./);
  });

  it("uses one query-only snapshot, preserves usage and unknown replies, and does no DML",async()=>{
    const sql:string[]=[];
    const rows=[{pet_skill_id:"skill001",pet_skill_name:"청룡언월도",pet_skill_description:"효과",pet_skill_grade:"S",legacy_source_key:"skill_000",display_order:1,base_draw_rate:"100",fixed_draw_rate_flag:1,openable_flag:1,pet_skill_grade_emoji:"📙",required_tier_name:null,tier_exclusive_flag:0,equip_description:null,raid_charm_bonus:"1000000",castle_charm_bonus:"1000000",handler_key:"presentation_only",options_json:{},active_flag:1}];
    const snapshot:ReadOnlySnapshotTransaction={query:async<T>(query:string)=>{sql.push(query);if(query.includes("external_identities"))return[{player_status:"active",is_operator:0}]as T;if(query.includes("player_profiles"))return[]as T;if(query.includes("canonical_pet_skill_aliases")||query.includes("grade_policies"))return[]as T;if(query.includes("CAST(raid_charm_bonus"))return[{pet_skill_id:"skill001",raid_charm_bonus:"1000000",castle_charm_bonus:"1000000"}]as T;return rows as T;}};
    const no=async()=>{throw new Error("mutable path must not run");};
    const database={ping:no,verifyRollback:no,query:no,execute:no,withTransaction:no,close:no,withControlledTransaction:no,withReadOnlySnapshot:async<T>(work:(transaction:ReadOnlySnapshotTransaction)=>Promise<T>)=>work(snapshot)}as unknown as DatabaseClient;
    const service=new PetSkillInfoShadowService(database);
    const usage=await service.evaluate({externalUserId:"u1",displayName:"호이 남",message:"/펫스킬정보"});assert.equal(usage?.status,"shadow");assert.equal(usage?.status==="shadow"?usage.reply:null,"사용법:\n/펫스킬정보 [펫스킬이름] — 펫스킬 효과 조회\n/펫스킬정보 [유저닉네임] — 유저 펫스킬가방 조회 (관리자 전용)");
    assert.equal(sql.length,1);
    sql.length=0;
    const unknown=await service.evaluate({externalUserId:"u1",displayName:"호이 남",message:"/펫스킬정보 없음"});assert.equal(unknown?.status,"shadow");assert.equal(unknown?.status==="shadow"?unknown.reply:null,"등록되지 않은 펫스킬입니다.\n또는 존재하지 않는 유저입니다.");
    assert.equal(sql.length,6);assert.ok(sql.every(value=>value.startsWith("SELECT ")));
    sql.length=0;
    assert.equal(await service.evaluate({externalUserId:"u1",displayName:"다섯글자임",message:"/펫스킬정보 청룡언월도"}),null);
    assert.equal(sql.length,0);
  });

  it("keeps skill lookup ahead of nickname denial and fails closed for the unprojected admin bag",async()=>{
    const rows=[{pet_skill_id:"skill001",pet_skill_name:"청룡언월도",pet_skill_description:"효과",pet_skill_grade:"S",legacy_source_key:"skill_000",display_order:1,base_draw_rate:"100",fixed_draw_rate_flag:1,openable_flag:1,pet_skill_grade_emoji:"📙",required_tier_name:null,tier_exclusive_flag:0,equip_description:null,handler_key:"presentation_only",options_json:{},active_flag:1}];
    const evaluate=async(query:string,isOperator:number,denied=false,externalChannelId?:string)=>{
      const snapshot:ReadOnlySnapshotTransaction={query:async<T>(sql:string)=>{
        if(sql.includes("external_identities identity"))return[{player_status:"active",identity_id:1n,operator_id:isOperator?2n:null,role_code:isOperator?"manager":null}]as T;
        if(sql.includes("player_profiles profile"))return[{player_id:2n}]as T;
        if(sql.includes("admin_operator_external_identities"))return(isOperator&&!denied?[{operator_id:2n,role_code:"manager"}]:[])as T;
        if(sql.includes("canonical_pet_skill_aliases")||sql.includes("grade_policies"))return[]as T;
        if(sql.includes("CAST(raid_charm_bonus"))return[{pet_skill_id:"skill001",raid_charm_bonus:"0",castle_charm_bonus:"0"}]as T;
        return rows as T;
      }};
      const no=async()=>{throw new Error("mutable path must not run");};
      const database={ping:no,verifyRollback:no,query:no,execute:no,withTransaction:no,close:no,withControlledTransaction:no,withReadOnlySnapshot:async<T>(work:(transaction:ReadOnlySnapshotTransaction)=>Promise<T>)=>work(snapshot)}as unknown as DatabaseClient;
      return new PetSkillInfoShadowService(database).evaluate({externalUserId:"u1",externalChannelId,displayName:"호이 남",message:`/펫스킬정보 ${query}`});
    };
    const collision=await evaluate("청룡언월도",0);
    assert.equal(collision?.status,"shadow");
    assert.match(collision?.status==="shadow"?collision.reply:"",/^청룡언월도📙/);
    const denied=await evaluate("다른이",0);
    assert.equal(denied?.status==="shadow"?denied.reply:"","❌ 다른 유저의 펫스킬 조회는 관리자만 가능합니다.");
    assert.deepEqual(await evaluate("다른이",1),{status:"legacy_fallback",reason:"ADMIN_PLAYER_BAG_PROJECTION_UNPROVEN"});
    const deniedOverride=await evaluate("다른이",1,true,"room-with-allow");
    assert.equal(deniedOverride?.status==="shadow"?deniedOverride.reply:"","❌ 다른 유저의 펫스킬 조회는 관리자만 가능합니다.");
    const source=fs.readFileSync(new URL("../src/pet/pet-skill-info-shadow-service.ts",import.meta.url),"utf8");
    assert.match(source,/NOT EXISTS\(SELECT 1 FROM admin_operator_permission_overrides denied/);assert.match(source,/denied\.effect='deny'/);
    assert.match(source,/EXISTS\(SELECT 1 FROM admin_operator_permission_overrides allowed/);assert.match(source,/allowed\.effect='allow'/);
  });

  it("formats the complete premium admin bag byte-exactly with total, ordering, allsee, marker and guild rank",async()=>{
    const kinds=["CASTLE_LORD","STAR","CARROT","THERMO","MINI_PET","TOP_LEVEL","MC","INTIMACY"];
    const catalogRows=exactCatalogRows();
    const catalog=projectCanonicalPetSkillReadCatalog(catalogRows,[],[]);
    const stacks=[{owned_pet_skill_id:"stack001",pet_skill_id:"skill001",legacy_source_key:"skill_000",pet_skill_name:"야수의본능",pet_skill_grade:"A",display_order:1,quantity:1200n},{owned_pet_skill_id:"stack002",pet_skill_id:"skill002",legacy_source_key:"skill_001",pet_skill_name:"던전 탐험가",pet_skill_grade:"S",display_order:2,quantity:2n},{owned_pet_skill_id:"stack003",pet_skill_id:"skill003",legacy_source_key:"skill_002",pet_skill_name:"숨김",pet_skill_grade:"C",display_order:3,quantity:0n}];
    const scripted:unknown[]=[
      [{player_status:"active",identity_id:1n}], [{player_id:2n}], [{operator_id:4n,role_code:"manager"},{operator_id:4n,role_code:"super_admin"}],
      [{authority_decision:"ALLOW",source_fingerprint:"a".repeat(64),revision:1n}],
      [{player_id:2n,rank_emoji:"🐣",canonical_player_id:"player02"}],
      kinds.map((marker_kind,index)=>({marker_kind,marker_priority:index+1,assignment_status:"ASSIGNED",player_id:index===0?"player09":index===2?"player02":`player${index+20}`,legacy_player_id:index===0?9n:BigInt(index+20),source_fingerprint:String(index+1).repeat(64).slice(0,64),revision:1n})),
      [{player_id:2n,guild_id:7n,ordinal_value:2,snapshot_id:3n,current_snapshot_id:3n},{player_id:9n,guild_id:8n,ordinal_value:1,snapshot_id:3n,current_snapshot_id:3n}],
      [{premium_active:1}],
      [{expected_source_key_count:3,projected_stack_count:3,quarantined_source_key_count:0,ignored_source_key_count:0,source_fingerprint:"c".repeat(64),catalog_projection_sha256:"d".repeat(64),catalog_set_fingerprint:fingerprintPetSkillInfoCatalog(catalog.definitions),stack_set_fingerprint:fingerprintPetSkillInfoBagStacks(stacks),revision:1n,run_status:"COMPLETE",import_sha256:"c".repeat(64),run_catalog_projection_sha256:"d".repeat(64),expected_source_count:93,projected_source_count:93,run_quarantined_source_count:0,run_ignored_source_count:0,expected_row_count:93,imported_row_count:93}],
      catalogRows,[],[],stacks
    ];
    const snapshot:ReadOnlySnapshotTransaction={query:async<T>()=>scripted.shift() as T};
    const no=async()=>{throw new Error("mutable path must not run");};
    const database={ping:no,verifyRollback:no,query:no,execute:no,withTransaction:no,close:no,withControlledTransaction:no,withReadOnlySnapshot:async<T>(work:(transaction:ReadOnlySnapshotTransaction)=>Promise<T>)=>work(snapshot)}as unknown as DatabaseClient;
    const result=await new PetSkillInfoShadowService(database).evaluate({externalUserId:"admin",externalChannelId:"room-1",displayName:"호이 남",message:"/펫스킬정보 대상"});
    assert.equal(scripted.length,0);assert.equal(result?.status,"shadow");
    const expected="[👑호이패스 프리미엄👑]\n[🥕대상_♔] 보유 스킬가방📙[1,202/100]\n━━━━━━━━━━━━━\n※ 스킬 장착: /펫스킬장착 [번호]\n※ 스킬 판매: /펫스킬판매 [번호]\n※ 스킬 분해: /펫스킬북분해 [번호] [개수]\n※ 스킬 정보: /펫스킬정보 [스킬이름]\n━━━━━━━━━━━━━\n"+"\u200b".repeat(500)+"\n1. 야수의 본능📙[A] x1,200\n2. 던전탐험가📙[S] x2";
    assert.equal(result?.status==="shadow"?result.reply:"",expected);
    assert.equal(formatLegacyPetSkillAdminBag({displayName:"빈",rankDisplay:"🐣빈",premium:false,total:0n,skills:[]}),"[🐣빈] 보유 스킬가방📙[0/100]\n━━━━━━━━━━━━━\n※ 스킬 장착: /펫스킬장착 [번호]\n※ 스킬 판매: /펫스킬판매 [번호]\n※ 스킬 분해: /펫스킬북분해 [번호] [개수]\n※ 스킬 정보: /펫스킬정보 [스킬이름]\n━━━━━━━━━━━━━\n보유 중인 펫스킬북이 없습니다.");
  });

  it("fails closed on missing authority, deny priority and incomplete or tampered rank projections",async()=>{
    const run=async(authorities:unknown[],markers:unknown[]=[])=>{
      const scripted:unknown[]=[[{player_status:"active",identity_id:1n}],[{player_id:2n}],[{operator_id:4n,role_code:"manager"}],authorities];
      if(authorities.length===1&&(authorities[0] as {authority_decision:string}).authority_decision==="ALLOW")scripted.push([{player_id:2n,rank_emoji:"🐣",canonical_player_id:"player02"}],markers);
      const snapshot:ReadOnlySnapshotTransaction={query:async<T>()=>scripted.shift() as T};
      const no=async()=>{throw new Error("mutable path must not run");};
      const database={ping:no,verifyRollback:no,query:no,execute:no,withTransaction:no,close:no,withControlledTransaction:no,withReadOnlySnapshot:async<T>(work:(transaction:ReadOnlySnapshotTransaction)=>Promise<T>)=>work(snapshot)}as unknown as DatabaseClient;
      return new PetSkillInfoShadowService(database).evaluate({externalUserId:"admin",externalChannelId:"room-1",displayName:"호이 남",message:"/펫스킬정보 대상"});
    };
    const fallback={status:"legacy_fallback",reason:"ADMIN_PLAYER_BAG_PROJECTION_UNPROVEN"};
    assert.deepEqual(await run([]),fallback);
    assert.deepEqual(await run([{authority_decision:"DENY",source_fingerprint:"a".repeat(64),revision:1n}]),fallback);
    assert.deepEqual(await run([{authority_decision:"ALLOW",source_fingerprint:"a".repeat(64),revision:1n}],[{marker_kind:"CASTLE_LORD",marker_priority:1,player_id:9n,source_fingerprint:"x".repeat(64),revision:1n}]),fallback);
  });

  it("requires source completeness and exact non-null catalog grade/order/locator evidence",()=>{
    const source=fs.readFileSync(new URL("../src/pet/pet-skill-info-shadow-service.ts",import.meta.url),"utf8");
    assert.match(source,/completeness\.length!==1/);assert.match(source,/quarantined_source_key_count\)!==0/);assert.match(source,/ignored_source_key_count\)!==0/);
    assert.match(source,/catalog\.definitions\.length!==93/);assert.match(source,/source_fingerprint!==completeness\[0\]!\.import_sha256/);
    assert.match(source,/catalog_projection_sha256!==completeness\[0\]!\.run_catalog_projection_sha256/);assert.match(source,/stacks\.length!==Number\(completeness\[0\]!\.projected_stack_count\)/);
    assert.match(source,/fingerprintPetSkillInfoCatalog\(catalog\.definitions\)!==completeness\[0\]!\.catalog_set_fingerprint/);assert.match(source,/fingerprintPetSkillInfoBagStacks\(stacks\)!==completeness\[0\]!\.stack_set_fingerprint/);
    assert.match(source,/definition\.grade!==row\.pet_skill_grade\|\|definition\.displayOrder!==Number\(row\.display_order\)/);
  });
});
