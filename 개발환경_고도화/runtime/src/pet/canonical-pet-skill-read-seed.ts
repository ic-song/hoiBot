import { createHash } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { createScopedDatabaseClient } from "../database.js";
import { MariaObjectIdentityAuditProvider } from "../identity/object-identity-audit-provider.js";
import { normalizeCanonicalPetSkillOptions } from "./canonical-pet-skill-handler-registry.js";
import { normalizePetSkillLookup } from "./canonical-pet-skill-read-provider.js";

export interface LegacyPetSkillSeedEntry {
  sourceIndex:number; sourceKey:string; definitionCode:string;
  source:{name:string;grade:string;rate?:number;fixedRate?:boolean;openable?:boolean;effect:string;requiredTier?:string;tierExclusive?:boolean;equipComment?:string;[key:string]:unknown};
}
export interface CanonicalPetSkillSeedDefinition extends LegacyPetSkillSeedEntry { displayOrder:number;handlerKey:"presentation_only";options:Readonly<Record<string,never>>; }
export interface CanonicalPetSkillSeedProjection { sourceHash:string;canonicalTupleHash:string;definitions:readonly CanonicalPetSkillSeedDefinition[]; aliases:readonly {sourceKey:string;aliasValue:string;normalizedAliasValue:string}[]; gradePolicies:readonly {grade:string;probabilityTotal:number;displayOrder:number}[]; }
const SOURCE_KEY=/^skill_\d{3,}$/;
export const CANONICAL_PET_SKILL_LEGACY_SOURCE_COUNT=93;
export const CANONICAL_PET_SKILL_LEGACY_SOURCE_HASH="435a49512498b33295734e7dc864628792a47409b1e818c047d0051b2f15d176";
export const CANONICAL_PET_SKILL_CANONICAL_TUPLE_HASH="b108a0b9d07ccaa40d0a7f85961c6d4bddbb91969dc3f6405a93162fae4517c9";
function fail(code:string):never{throw new Error(code);}
function tierAlias(entry:LegacyPetSkillSeedEntry):string|null{if(entry.source.tierExclusive!==true)return null;const index=entry.source.name.indexOf(" ");return index<0?null:entry.source.name.slice(index+1).trim();}

// Frozen legacy source is transformed into declarative metadata only; executable JS/SQL is never persisted.
export function projectCanonicalPetSkillSeed(entries:readonly LegacyPetSkillSeedEntry[],gradeTotals:Readonly<Record<string,number>>,expectedSourceHash:string):CanonicalPetSkillSeedProjection{
  const sourceHash=createHash("sha256").update(JSON.stringify(entries.map(row=>row.source))).digest("hex");
  if(expectedSourceHash!==CANONICAL_PET_SKILL_LEGACY_SOURCE_HASH||sourceHash!==expectedSourceHash||entries.length!==CANONICAL_PET_SKILL_LEGACY_SOURCE_COUNT)return fail("CANONICAL_PET_SKILL_SEED_SOURCE_DRIFT");
  const keys=new Set<string>(),orders=new Set<number>(),names=new Set<string>();
  const definitions=entries.map((entry,runtimeIndex)=>{
    if(!SOURCE_KEY.test(entry.sourceKey)||entry.sourceIndex<0||!Number.isSafeInteger(entry.sourceIndex)||entry.source.name.trim()===""||entry.source.grade.trim()===""||entry.source.effect.trim()==="")return fail("CANONICAL_PET_SKILL_SEED_ENTRY_INVALID");
    if(keys.has(entry.sourceKey)||orders.has(entry.sourceIndex)||names.has(entry.source.name))return fail("CANONICAL_PET_SKILL_SEED_ENTRY_DUPLICATE");
    keys.add(entry.sourceKey);orders.add(entry.sourceIndex);names.add(entry.source.name);return{...entry,displayOrder:runtimeIndex+1,handlerKey:"presentation_only" as const,options:{}};
  });
  const aliases:{sourceKey:string;aliasValue:string;normalizedAliasValue:string}[]=[];
  for(const entry of definitions){const alias=tierAlias(entry);if(alias!==null&&alias!=="")aliases.push({sourceKey:entry.sourceKey,aliasValue:alias,normalizedAliasValue:normalizePetSkillLookup(alias)});}
  const gradePolicies=Object.entries(gradeTotals).map(([grade,probabilityTotal],index)=>{if(grade.trim()===""||!Number.isFinite(probabilityTotal)||probabilityTotal<0||probabilityTotal>100)return fail("CANONICAL_PET_SKILL_SEED_POLICY_INVALID");return{grade,probabilityTotal,displayOrder:index+1};});
  const canonicalTupleHash=createHash("sha256").update(JSON.stringify({definitions,aliases,gradePolicies})).digest("hex");
  if(canonicalTupleHash!==CANONICAL_PET_SKILL_CANONICAL_TUPLE_HASH)return fail(`CANONICAL_PET_SKILL_SEED_CANONICAL_TUPLE_DRIFT:${canonicalTupleHash}`);
  return{sourceHash,canonicalTupleHash,definitions,aliases,gradePolicies};
}

interface ImportRow{pet_skill_id:string;pet_skill_name:string;pet_skill_description:string|null;pet_skill_grade:string|null;handler_key:string;options_json:unknown;payload_fingerprint:string;}
interface AliasRow{pet_skill_id:string;alias_value:string;}
interface PolicyRow{grade_probability_total:string;display_order:number;}
interface SeedCountRow{definitions:string|bigint;imports:string|bigint;aliases:string|bigint;policies:string|bigint;}
interface DefinitionActiveSetRow{pet_skill_id:string;active_flag:boolean|number;source_identifier:string|null;}
interface AliasActiveSetRow{normalized_alias_value:string;active_flag:boolean|number;source_identifier:string|null;}
interface PolicyActiveSetRow{pet_skill_grade:string;active_flag:boolean|number;}
export class MariaCanonicalPetSkillReadSeeder{
  public constructor(private readonly database:DatabaseClient){}
  public async seed(input:{actor:string;sourceSystem:string;sourceNamespace:string;projection:CanonicalPetSkillSeedProjection}):Promise<void>{
    const expected=projectCanonicalPetSkillSeed(input.projection.definitions,Object.fromEntries(input.projection.gradePolicies.map(row=>[row.grade,row.probabilityTotal])),input.projection.sourceHash);
    const exactDefinitions=input.projection.definitions.every((row,index)=>row.sourceKey===`skill_${String(row.sourceIndex).padStart(3,"0")}`&&row.displayOrder===index+1);
    if(!exactDefinitions||JSON.stringify(expected)!==JSON.stringify(input.projection))return fail("CANONICAL_PET_SKILL_SEED_PROJECTION_INCOMPLETE");
    await this.database.withTransaction(transaction=>this.seedInTransaction(transaction,input));
  }
  private async seedInTransaction(transaction:DatabaseTransaction,input:{actor:string;sourceSystem:string;sourceNamespace:string;projection:CanonicalPetSkillSeedProjection}):Promise<void>{
    const identity=new MariaObjectIdentityAuditProvider(createScopedDatabaseClient(transaction));
    const counts=async()=>{const row=(await transaction.query<SeedCountRow[]>("SELECT (SELECT COUNT(*) FROM canonical_pet_skill_definitions WHERE active_flag=TRUE) definitions,(SELECT COUNT(*) FROM canonical_pet_skill_definition_imports WHERE source_system=? AND source_namespace=?) imports,(SELECT COUNT(*) FROM canonical_pet_skill_aliases WHERE active_flag=TRUE) aliases,(SELECT COUNT(*) FROM canonical_pet_skill_draw_grade_policies WHERE active_flag=TRUE) policies",[input.sourceSystem,input.sourceNamespace]))[0];if(row===undefined)return fail("CANONICAL_PET_SKILL_SEED_COUNT_DRIFT");return[Number(row.definitions),Number(row.imports),Number(row.aliases),Number(row.policies)]as const;};
    const before=await counts();if(before[0]!==93||before[1]!==93||before[2]>30||before[3]>4)return fail("CANONICAL_PET_SKILL_SEED_COUNT_DRIFT");
    const definitionSet=await transaction.query<DefinitionActiveSetRow[]>("SELECT definitions.pet_skill_id,definitions.active_flag,imports.source_identifier FROM canonical_pet_skill_definitions definitions LEFT JOIN canonical_pet_skill_definition_imports imports ON imports.pet_skill_id=definitions.pet_skill_id AND imports.source_system=? AND imports.source_namespace=? ORDER BY definitions.pet_skill_id,imports.source_identifier",[input.sourceSystem,input.sourceNamespace]);
    const expectedDefinitionKeys=new Set(input.projection.definitions.map(row=>row.sourceKey)),seenDefinitionKeys=new Set<string>();
    for(const row of definitionSet){const expected=row.source_identifier!==null&&expectedDefinitionKeys.has(row.source_identifier);if(expected){if(seenDefinitionKeys.has(row.source_identifier!)||(row.active_flag!==true&&row.active_flag!==1))return fail("CANONICAL_PET_SKILL_SEED_ACTIVE_SET_DRIFT");seenDefinitionKeys.add(row.source_identifier!);}else if(row.active_flag===true||row.active_flag===1)return fail("CANONICAL_PET_SKILL_SEED_ACTIVE_SET_DRIFT");}
    if(seenDefinitionKeys.size!==expectedDefinitionKeys.size)return fail("CANONICAL_PET_SKILL_SEED_ACTIVE_SET_DRIFT");
    const aliasSet=await transaction.query<AliasActiveSetRow[]>("SELECT aliases.normalized_alias_value,aliases.active_flag,imports.source_identifier FROM canonical_pet_skill_aliases aliases LEFT JOIN canonical_pet_skill_definition_imports imports ON imports.pet_skill_id=aliases.pet_skill_id AND imports.source_system=? AND imports.source_namespace=? ORDER BY aliases.normalized_alias_value",[input.sourceSystem,input.sourceNamespace]);
    const expectedAliasKeys=new Set(input.projection.aliases.map(row=>`${row.sourceKey}\0${row.normalizedAliasValue}`)),seenAliasKeys=new Set<string>();
    for(const row of aliasSet){const key=`${row.source_identifier??""}\0${row.normalized_alias_value}`,expected=expectedAliasKeys.has(key);if(expected){if(seenAliasKeys.has(key)||(row.active_flag!==true&&row.active_flag!==1))return fail("CANONICAL_PET_SKILL_SEED_ACTIVE_SET_DRIFT");seenAliasKeys.add(key);}else if(row.active_flag===true||row.active_flag===1)return fail("CANONICAL_PET_SKILL_SEED_ACTIVE_SET_DRIFT");}
    if(seenAliasKeys.size!==expectedAliasKeys.size&&aliasSet.length!==0)return fail("CANONICAL_PET_SKILL_SEED_ACTIVE_SET_DRIFT");
    const policySet=await transaction.query<PolicyActiveSetRow[]>("SELECT pet_skill_grade,active_flag FROM canonical_pet_skill_draw_grade_policies ORDER BY pet_skill_grade");
    const expectedPolicyGrades=new Set(input.projection.gradePolicies.map(row=>row.grade)),seenPolicyGrades=new Set<string>();
    for(const row of policySet){const expected=expectedPolicyGrades.has(row.pet_skill_grade);if(expected){if(seenPolicyGrades.has(row.pet_skill_grade)||(row.active_flag!==true&&row.active_flag!==1))return fail("CANONICAL_PET_SKILL_SEED_ACTIVE_SET_DRIFT");seenPolicyGrades.add(row.pet_skill_grade);}else if(row.active_flag===true||row.active_flag===1)return fail("CANONICAL_PET_SKILL_SEED_ACTIVE_SET_DRIFT");}
    if(seenPolicyGrades.size!==expectedPolicyGrades.size&&policySet.length!==0)return fail("CANONICAL_PET_SKILL_SEED_ACTIVE_SET_DRIFT");
    for(const entry of input.projection.definitions){
      const mapped=await transaction.query<ImportRow[]>("SELECT imports.pet_skill_id,imports.payload_fingerprint,definitions.pet_skill_name,definitions.pet_skill_description,definitions.pet_skill_grade,definitions.handler_key,definitions.options_json FROM canonical_pet_skill_definition_imports imports JOIN canonical_pet_skill_definitions definitions ON definitions.pet_skill_id=imports.pet_skill_id WHERE definitions.active_flag=TRUE AND imports.source_system=? AND imports.source_namespace=? AND imports.source_identifier=? FOR UPDATE",[input.sourceSystem,input.sourceNamespace,entry.sourceKey]);
      const mappedRow=mapped[0],expectedFingerprint=createHash("sha256").update(JSON.stringify([entry.source.name,entry.source.effect,entry.source.grade,entry.handlerKey,entry.options,true])).digest("hex");
      let mappedOptions:Readonly<Record<string,unknown>>|undefined;
      if(mappedRow!==undefined){try{const raw=typeof mappedRow.options_json==="string"?JSON.parse(mappedRow.options_json)as unknown:mappedRow.options_json;mappedOptions=normalizeCanonicalPetSkillOptions(mappedRow.handler_key,raw);}catch{return fail("CANONICAL_PET_SKILL_SEED_CROSSWALK_INVALID");}}
      if(mapped.length!==1||mappedRow===undefined||mappedRow.pet_skill_name!==entry.source.name||mappedRow.pet_skill_description!==entry.source.effect||mappedRow.pet_skill_grade!==entry.source.grade||mappedRow.handler_key!==entry.handlerKey||JSON.stringify(mappedOptions)!==JSON.stringify(entry.options)||mappedRow.payload_fingerprint!==expectedFingerprint)return fail("CANONICAL_PET_SKILL_SEED_CROSSWALK_INVALID");
      const source=entry.source;
      await transaction.execute("UPDATE canonical_pet_skill_definitions SET pet_skill_description=?,pet_skill_grade=?,legacy_source_key=?,display_order=?,base_draw_rate=?,fixed_draw_rate_flag=?,openable_flag=?,pet_skill_grade_emoji=?,required_tier_name=?,tier_exclusive_flag=?,equip_description=?,UPDATE_USER=?,UPDATE_TIME=DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00','+09:00'),'%Y-%m-%d %H:%i:%s') WHERE pet_skill_id=?",[source.effect,source.grade,entry.sourceKey,entry.displayOrder,source.rate??0,source.fixedRate===true,source.openable!==false,"\ud83d\udcd9",source.requiredTier??null,source.tierExclusive===true,source.equipComment??null,input.actor,mapped[0]!.pet_skill_id]);
    }
    for(const alias of input.projection.aliases){
      const mapped=await transaction.query<ImportRow[]>("SELECT imports.pet_skill_id,imports.payload_fingerprint,definitions.pet_skill_name,definitions.pet_skill_description,definitions.pet_skill_grade,definitions.handler_key,definitions.options_json FROM canonical_pet_skill_definition_imports imports JOIN canonical_pet_skill_definitions definitions ON definitions.pet_skill_id=imports.pet_skill_id WHERE imports.source_system=? AND imports.source_namespace=? AND imports.source_identifier=? FOR UPDATE",[input.sourceSystem,input.sourceNamespace,alias.sourceKey]);
      if(mapped.length!==1)return fail("CANONICAL_PET_SKILL_SEED_CROSSWALK_INVALID");
      const current=await transaction.query<AliasRow[]>("SELECT pet_skill_id,alias_value FROM canonical_pet_skill_aliases WHERE alias_type='legacy_name' AND normalized_alias_value=? FOR UPDATE",[alias.normalizedAliasValue]);
      if(current.length>1||(current.length===1&&(current[0]!.pet_skill_id!==mapped[0]!.pet_skill_id||current[0]!.alias_value!==alias.aliasValue)))return fail("CANONICAL_PET_SKILL_SEED_ALIAS_CONFLICT");
      if(current.length===0){const registered=await identity.registerCrosswalk({actor:input.actor,objectType:"PET_SKILL_ALIAS",sourceSystem:input.sourceSystem,sourceNamespace:"canonicalPetSkillAlias",sourceIdentifier:createHash("sha256").update(`${alias.sourceKey}:${alias.normalizedAliasValue}`).digest("hex")});const audit=registered.audit;await transaction.execute("INSERT INTO canonical_pet_skill_aliases(pet_skill_alias_id,pet_skill_id,alias_type,alias_value,normalized_alias_value,active_flag,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,'legacy_name',?,?,TRUE,?,?,?,?)",[registered.objectIdentityId,mapped[0]!.pet_skill_id,alias.aliasValue,alias.normalizedAliasValue,audit.INSERT_USER,audit.INSERT_TIME,audit.UPDATE_USER,audit.UPDATE_TIME]);}
    }
    for(const policy of input.projection.gradePolicies){
      const current=await transaction.query<PolicyRow[]>("SELECT CAST(grade_probability_total AS CHAR) grade_probability_total,display_order FROM canonical_pet_skill_draw_grade_policies WHERE pet_skill_grade=? FOR UPDATE",[policy.grade]);
      if(current.length>1||(current.length===1&&(Number(current[0]!.grade_probability_total)!==policy.probabilityTotal||current[0]!.display_order!==policy.displayOrder)))return fail("CANONICAL_PET_SKILL_SEED_POLICY_CONFLICT");
      if(current.length===0){const registered=await identity.registerCrosswalk({actor:input.actor,objectType:"PET_SKILL_DRAW_POLICY",sourceSystem:input.sourceSystem,sourceNamespace:"canonicalPetSkillDrawPolicy",sourceIdentifier:policy.grade});const audit=registered.audit;await transaction.execute("INSERT INTO canonical_pet_skill_draw_grade_policies(pet_skill_draw_grade_policy_id,pet_skill_grade,grade_probability_total,display_order,active_flag,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,TRUE,?,?,?,?)",[registered.objectIdentityId,policy.grade,policy.probabilityTotal,policy.displayOrder,audit.INSERT_USER,audit.INSERT_TIME,audit.UPDATE_USER,audit.UPDATE_TIME]);}
    }
    const after=await counts();if(JSON.stringify(after)!==JSON.stringify([93,93,30,4]))return fail("CANONICAL_PET_SKILL_SEED_COUNT_DRIFT");
  }
}
