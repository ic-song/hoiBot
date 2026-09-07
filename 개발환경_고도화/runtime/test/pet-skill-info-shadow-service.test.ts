import assert from "node:assert/strict";
import fs from "node:fs";
import {describe,it} from "node:test";
import type {DatabaseClient,ReadOnlySnapshotTransaction} from "../src/database.js";
import {formatLegacyPetSkillInfo,isPetSkillInfoShadowCandidate,normalizePetSkillInfoDispatchMessage,parsePetSkillInfoShadowCommand,PetSkillInfoShadowService,resolveLegacyPetSkillInfo} from "../src/pet/pet-skill-info-shadow-service.js";
import type {CanonicalPetSkillReadDefinition} from "../src/pet/canonical-pet-skill-read-provider.js";

type InfoDefinition=CanonicalPetSkillReadDefinition&{raidCharmBonus:number;castleCharmBonus:number};
const definition=(override:Partial<InfoDefinition>={}):InfoDefinition=>({petSkillId:"skill001",name:"청룡언월도",description:"삼국지 관우의 전설적인 무기입니다.",grade:"S",gradeEmoji:"📙",legacySourceKey:"skill_000",displayOrder:1,baseDrawRate:.1,actualRate:.1,fixedDrawRate:true,openable:true,requiredTierName:null,tierExclusive:false,equipDescription:null,raidCharmBonus:1000000,castleCharmBonus:1000000,handlerKey:"presentation_only",options:{},aliases:[],...override});

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
    const evaluate=async(query:string,isOperator:number)=>{
      const snapshot:ReadOnlySnapshotTransaction={query:async<T>(sql:string)=>{
        if(sql.includes("external_identities identity"))return[{player_status:"active",is_operator:isOperator}]as T;
        if(sql.includes("player_profiles profile"))return[{player_id:2n}]as T;
        if(sql.includes("canonical_pet_skill_aliases")||sql.includes("grade_policies"))return[]as T;
        if(sql.includes("CAST(raid_charm_bonus"))return[{pet_skill_id:"skill001",raid_charm_bonus:"0",castle_charm_bonus:"0"}]as T;
        return rows as T;
      }};
      const no=async()=>{throw new Error("mutable path must not run");};
      const database={ping:no,verifyRollback:no,query:no,execute:no,withTransaction:no,close:no,withControlledTransaction:no,withReadOnlySnapshot:async<T>(work:(transaction:ReadOnlySnapshotTransaction)=>Promise<T>)=>work(snapshot)}as unknown as DatabaseClient;
      return new PetSkillInfoShadowService(database).evaluate({externalUserId:"u1",displayName:"호이 남",message:`/펫스킬정보 ${query}`});
    };
    const collision=await evaluate("청룡언월도",0);
    assert.equal(collision?.status,"shadow");
    assert.match(collision?.status==="shadow"?collision.reply:"",/^청룡언월도📙/);
    const denied=await evaluate("다른이",0);
    assert.equal(denied?.status==="shadow"?denied.reply:"","❌ 다른 유저의 펫스킬 조회는 관리자만 가능합니다.");
    assert.deepEqual(await evaluate("다른이",1),{status:"legacy_fallback",reason:"ADMIN_PLAYER_BAG_PROJECTION_UNPROVEN"});
  });
});
