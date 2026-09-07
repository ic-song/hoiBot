import { createHash } from "node:crypto";
import type { AppWiringReadParticipant } from "../dispatch/app-wiring-operation-provider.js";
import type { VerifiedEnvironmentContext } from "../runtime/environment-context.js";
import { assertVerifiedEnvironmentContext } from "../runtime/environment-context.js";
import { normalizeCanonicalPetSkillOptions } from "./canonical-pet-skill-handler-registry.js";
import { normalizePetSkillLookup, readCanonicalPetSkillCatalogInSnapshot } from "./canonical-pet-skill-read-provider.js";

const EXPECTED_DEFINITIONS=93;
const EXPECTED_IMPORTS=93;
const EXPECTED_ALIASES=30;
const EXPECTED_POLICIES=4;
const SOURCE_SYSTEM="LEGACY_JSON";
const SOURCE_NAMESPACE="PET_SKILL_LIST";
export const PET_SKILL_READINESS_SEMANTIC_FINGERPRINT="dfdc76016342f7db4f8514b8a6f529e0865d808f433cde3069b266eba6a02011";

interface CountRow{database_identity:string|null;definitions:string|bigint;imports:string|bigint;aliases:string|bigint;policies:string|bigint}
interface SemanticDefinitionRow{pet_skill_id:string;pet_skill_name:string;pet_skill_description:string|null;pet_skill_grade:string|null;legacy_source_key:string|null;display_order:number|null;base_draw_rate:string|null;fixed_draw_rate_flag:boolean|number|null;openable_flag:boolean|number|null;pet_skill_grade_emoji:string|null;required_tier_name:string|null;tier_exclusive_flag:boolean|number|null;equip_description:string|null;handler_key:string;options_json:unknown;raid_charm_bonus:string|null;castle_charm_bonus:string|null;active_flag:boolean|number;source_identifier:string|null;payload_fingerprint:string|null}
interface SemanticAliasRow{source_identifier:string|null;alias_type:string;alias_value:string;normalized_alias_value:string;active_flag:boolean|number}
interface PolicySetRow{pet_skill_grade:string;grade_probability_total:string;display_order:number;active_flag:boolean|number}

export interface PetSkillCatalogReadinessCounts{readonly definitions:number;readonly imports:number;readonly aliases:number;readonly policies:number}
export type PetSkillCatalogReadiness=
  |{readonly status:"UNREADY";readonly reasonCode:"EMPTY";readonly counts:PetSkillCatalogReadinessCounts}
  |{readonly status:"PARTIAL";readonly reasonCode:"COUNT_MISMATCH"|"SEMANTIC_DRIFT";readonly counts:PetSkillCatalogReadinessCounts}
  |{readonly status:"READY";readonly reasonCode:"COMPLETE";readonly counts:PetSkillCatalogReadinessCounts};

function fail(code:string):never{throw new Error(code);}
function count(value:string|bigint,code:string):number{const parsed=Number(value);if(!Number.isSafeInteger(parsed)||parsed<0)return fail(code);return parsed;}
function sourceKey(index:number):string{return`skill_${String(index).padStart(3,"0")}`;}
function flag(value:boolean|number|null):boolean|undefined{if(value===true||value===1)return true;if(value===false||value===0)return false;return undefined;}
function stable(value:unknown):unknown{if(Array.isArray(value))return value.map(stable);if(typeof value==="object"&&value!==null){const input=value as Record<string,unknown>,output:Record<string,unknown>={};for(const key of Object.keys(input).sort())output[key]=stable(input[key]);return output;}return value;}
function sha256(value:unknown):string{return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");}
function finite(value:string|null):number|undefined{const parsed=Number(value);return value!==null&&Number.isFinite(parsed)&&parsed>=0?parsed:undefined;}
function unsigned(value:string|null):number|undefined{const parsed=Number(value);return value!==null&&Number.isSafeInteger(parsed)&&parsed>=0?parsed:undefined;}

export function computePetSkillReadinessSemanticFingerprint(definitions:readonly SemanticDefinitionRow[],aliases:readonly SemanticAliasRow[],policies:readonly PolicySetRow[]):string|undefined{
  const expectedSources=new Set(Array.from({length:EXPECTED_DEFINITIONS},(_,index)=>sourceKey(index))),seenSources=new Set<string>(),seenOrders=new Set<number>();
  const definitionTuples:unknown[][]=[];
  for(const row of definitions){
    const source=row.source_identifier,active=flag(row.active_flag),fixed=flag(row.fixed_draw_rate_flag),openable=flag(row.openable_flag),tier=flag(row.tier_exclusive_flag),rate=finite(row.base_draw_rate),raid=unsigned(row.raid_charm_bonus),castle=unsigned(row.castle_charm_bonus);
    if(source===null||!expectedSources.has(source)||seenSources.has(source)||active!==true||row.legacy_source_key!==source||row.display_order===null||!Number.isSafeInteger(row.display_order)||row.display_order<1||row.display_order>EXPECTED_DEFINITIONS||seenOrders.has(row.display_order)||row.pet_skill_description===null||row.pet_skill_grade===null||row.pet_skill_grade_emoji===null||fixed===undefined||openable===undefined||tier===undefined||rate===undefined||raid===undefined||castle===undefined||row.payload_fingerprint===null||!/^[0-9a-f]{64}$/.test(row.payload_fingerprint))return undefined;
    let options:Readonly<Record<string,unknown>>;try{options=normalizeCanonicalPetSkillOptions(row.handler_key,typeof row.options_json==="string"?JSON.parse(row.options_json)as unknown:row.options_json);}catch{return undefined;}
    const payload=sha256([row.pet_skill_name,row.pet_skill_description,row.pet_skill_grade,row.handler_key,options,true]);
    if(payload!==row.payload_fingerprint)return undefined;
    seenSources.add(source);seenOrders.add(row.display_order);
    definitionTuples.push([source,row.payload_fingerprint,row.pet_skill_name,row.pet_skill_description,row.pet_skill_grade,row.legacy_source_key,row.display_order,rate,fixed,openable,row.pet_skill_grade_emoji,row.required_tier_name,tier,row.equip_description,row.handler_key,options,raid,castle]);
  }
  if(seenSources.size!==EXPECTED_DEFINITIONS||seenOrders.size!==EXPECTED_DEFINITIONS)return undefined;
  const aliasTuples:unknown[][]=[];const seenAliases=new Set<string>();
  for(const row of aliases){const source=row.source_identifier,key=`${source??""}\0${row.normalized_alias_value}`;if(source===null||!expectedSources.has(source)||flag(row.active_flag)!==true||row.alias_type!=="legacy_name"||normalizePetSkillLookup(row.alias_value)!==row.normalized_alias_value||seenAliases.has(key))return undefined;seenAliases.add(key);aliasTuples.push([source,row.alias_type,row.alias_value,row.normalized_alias_value]);}
  if(aliasTuples.length!==EXPECTED_ALIASES)return undefined;
  const policyTuples=policies.map(row=>[row.pet_skill_grade,finite(row.grade_probability_total),row.display_order]as const);
  if(policyTuples.some(row=>row[1]===undefined)||policies.some(row=>flag(row.active_flag)!==true))return undefined;
  return sha256({definitions:definitionTuples,aliases:aliasTuples,policies:policyTuples});
}

export function formatPetSkillCatalogReadinessReply(readiness:Exclude<PetSkillCatalogReadiness,{status:"READY"}>):string{
  const title=readiness.status==="UNREADY"?"❌ DEV 펫스킬 카탈로그가 준비되지 않았습니다.":"⚠️ DEV 펫스킬 카탈로그가 일부만 준비되었습니다.";
  const counts=readiness.counts;
  return `[DEV 테스트환경]\n${title}\n정의: ${counts.definitions}/${EXPECTED_DEFINITIONS}\n정의 연결: ${counts.imports}/${EXPECTED_IMPORTS}\n별칭: ${counts.aliases}/${EXPECTED_ALIASES}\n확률 정책: ${counts.policies}/${EXPECTED_POLICIES}`;
}

export class MariaCanonicalPetSkillReadinessProvider{
  public async inspect(transaction:AppWiringReadParticipant,environment:VerifiedEnvironmentContext):Promise<PetSkillCatalogReadiness>{
    assertVerifiedEnvironmentContext(environment);
    const rows=await transaction.query<CountRow[]>(`SELECT DATABASE() database_identity,
      (SELECT COUNT(*) FROM canonical_pet_skill_definitions WHERE active_flag=TRUE) definitions,
      (SELECT COUNT(*) FROM canonical_pet_skill_definition_imports WHERE source_system=? AND source_namespace=?) imports,
      (SELECT COUNT(*) FROM canonical_pet_skill_aliases WHERE active_flag=TRUE) aliases,
      (SELECT COUNT(*) FROM canonical_pet_skill_draw_grade_policies WHERE active_flag=TRUE) policies`,[SOURCE_SYSTEM,SOURCE_NAMESPACE]);
    if(rows.length!==1||rows[0]!.database_identity!==environment.databaseIdentity)return fail("PET_SKILL_INFO_DEV_READINESS_DATABASE_IDENTITY_DRIFT");
    const counts={definitions:count(rows[0]!.definitions,"PET_SKILL_INFO_DEV_READINESS_COUNT_INVALID"),imports:count(rows[0]!.imports,"PET_SKILL_INFO_DEV_READINESS_COUNT_INVALID"),aliases:count(rows[0]!.aliases,"PET_SKILL_INFO_DEV_READINESS_COUNT_INVALID"),policies:count(rows[0]!.policies,"PET_SKILL_INFO_DEV_READINESS_COUNT_INVALID")};
    if(counts.definitions===0&&counts.imports===0&&counts.aliases===0&&counts.policies===0)return{status:"UNREADY",reasonCode:"EMPTY",counts};
    if(counts.definitions!==EXPECTED_DEFINITIONS||counts.imports!==EXPECTED_IMPORTS||counts.aliases!==EXPECTED_ALIASES||counts.policies!==EXPECTED_POLICIES)return{status:"PARTIAL",reasonCode:"COUNT_MISMATCH",counts};

    const definitions=await transaction.query<SemanticDefinitionRow[]>(`SELECT definition.pet_skill_id,definition.pet_skill_name,definition.pet_skill_description,definition.pet_skill_grade,definition.legacy_source_key,definition.display_order,CAST(definition.base_draw_rate AS CHAR) base_draw_rate,definition.fixed_draw_rate_flag,definition.openable_flag,definition.pet_skill_grade_emoji,definition.required_tier_name,definition.tier_exclusive_flag,definition.equip_description,definition.handler_key,definition.options_json,CAST(definition.raid_charm_bonus AS CHAR) raid_charm_bonus,CAST(definition.castle_charm_bonus AS CHAR) castle_charm_bonus,definition.active_flag,import_row.source_identifier,import_row.payload_fingerprint
      FROM canonical_pet_skill_definitions definition
      LEFT JOIN canonical_pet_skill_definition_imports import_row ON import_row.pet_skill_id=definition.pet_skill_id AND import_row.source_system=? AND import_row.source_namespace=?
      WHERE definition.active_flag=TRUE ORDER BY definition.display_order,definition.pet_skill_id,import_row.source_identifier`,[SOURCE_SYSTEM,SOURCE_NAMESPACE]);

    const aliases=await transaction.query<SemanticAliasRow[]>(`SELECT import_row.source_identifier,alias_row.alias_type,alias_row.alias_value,alias_row.normalized_alias_value,alias_row.active_flag
      FROM canonical_pet_skill_aliases alias_row
      LEFT JOIN canonical_pet_skill_definition_imports import_row ON import_row.pet_skill_id=alias_row.pet_skill_id AND import_row.source_system=? AND import_row.source_namespace=?
      WHERE alias_row.active_flag=TRUE ORDER BY import_row.source_identifier,alias_row.normalized_alias_value`,[SOURCE_SYSTEM,SOURCE_NAMESPACE]);

    const policies=await transaction.query<PolicySetRow[]>("SELECT pet_skill_grade,CAST(grade_probability_total AS CHAR) grade_probability_total,display_order,active_flag FROM canonical_pet_skill_draw_grade_policies WHERE active_flag=TRUE ORDER BY display_order,pet_skill_grade");
    const expectedPolicies=[{grade:"S",total:10.5,order:1},{grade:"A",total:18.1,order:2},{grade:"B",total:20,order:3},{grade:"C",total:47.7,order:4}];
    if(policies.length!==expectedPolicies.length||policies.some((row,index)=>row.active_flag!==1&&row.active_flag!==true||row.pet_skill_grade!==expectedPolicies[index]!.grade||Number(row.grade_probability_total)!==expectedPolicies[index]!.total||Number(row.display_order)!==expectedPolicies[index]!.order))return{status:"PARTIAL",reasonCode:"SEMANTIC_DRIFT",counts};

    const semanticFingerprint=computePetSkillReadinessSemanticFingerprint(definitions,aliases,policies);
    if(semanticFingerprint!==PET_SKILL_READINESS_SEMANTIC_FINGERPRINT)return{status:"PARTIAL",reasonCode:"SEMANTIC_DRIFT",counts};

    let catalog;
    try{catalog=await readCanonicalPetSkillCatalogInSnapshot(transaction);}catch(error){if(error instanceof Error&&error.message.startsWith("CANONICAL_PET_SKILL_READ_"))return{status:"PARTIAL",reasonCode:"SEMANTIC_DRIFT",counts};throw error;}
    if(catalog.definitions.length!==EXPECTED_DEFINITIONS||catalog.definitions.filter(row=>row.tierExclusive).length!==EXPECTED_ALIASES)return{status:"PARTIAL",reasonCode:"SEMANTIC_DRIFT",counts};
    return{status:"READY",reasonCode:"COMPLETE",counts};
  }
}
