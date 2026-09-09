import { createHash } from "node:crypto";
import type { AppWiringReadParticipant } from "../dispatch/app-wiring-operation-provider.js";

// OBJECT_DATA_MODEL_STANDARD_CANONICAL_PROVIDER: WBS744 canonical Shadow 전용이며 레거시 재화 provider 집합에 포함하지 않습니다.

export type ObjectDbShadowMismatchCategory =
  | "IDENTITY_UNRESOLVED" | "IDENTITY_AMBIGUOUS" | "IDENTITY_PAYLOAD_DRIFT"
  | "CANONICAL_ROW_MISSING" | "LEGACY_ROW_MISSING" | "ROW_MULTIPLICITY_MISMATCH"
  | "FIELD_VALUE_MISMATCH" | "UNICODE_BYTE_MISMATCH" | "BIGINT_ENCODING_INVALID"
  | "REFERENCE_CLOSURE_MISMATCH" | "TABLE_COVERAGE_MISMATCH"
  | "RESTART_FINGERPRINT_DRIFT" | "MUTATION_DETECTED";

export type ShadowValue = null | boolean | number | string | { readonly $bigint: string } | readonly ShadowValue[] | { readonly [key: string]: ShadowValue };
export type ShadowRow = Readonly<Record<string, ShadowValue>>;
export interface ObjectDbShadowIdentityIssue { readonly category: "IDENTITY_UNRESOLVED" | "IDENTITY_AMBIGUOUS" | "IDENTITY_PAYLOAD_DRIFT"; readonly locatorFingerprint: string }
export interface ObjectDbShadowValidationInput {
  readonly legacyRowsByTable: Readonly<Record<string, readonly ShadowRow[]>>;
  readonly identityIssues?: readonly ObjectDbShadowIdentityIssue[];
  readonly previousRunFingerprint?: string;
  readonly beforeMutationFingerprint?: string;
  readonly afterMutationFingerprint?: string;
}
export interface ObjectDbShadowMismatch {
  readonly category: ObjectDbShadowMismatchCategory;
  readonly domain: string | null;
  readonly table: string | null;
  readonly rowKey: string | null;
  readonly field: string | null;
  readonly legacyFingerprint: string | null;
  readonly canonicalFingerprint: string | null;
}
export interface ObjectDbShadowValidationResult {
  readonly schemaVersion: "object-db-shadow-validation.v1";
  readonly comparedTableCount: number;
  readonly mismatchCount: number;
  readonly promotionAllowed: boolean;
  readonly projectionFingerprint: string;
  readonly runFingerprint: string;
  readonly mismatches: readonly ObjectDbShadowMismatch[];
}

interface TablePlan { readonly domain: string; readonly table: string; readonly primaryKey: readonly string[] }
export const OBJECT_DB_SHADOW_TABLE_PLAN: readonly TablePlan[] = Object.freeze([
  ["player","canonical_players",["player_id"]],
  ["item","canonical_item_definitions",["item_id"]],["item","canonical_owned_item_stacks",["owned_item_stack_id"]],["item","canonical_owned_item_instances",["owned_item_id"]],
  ["furniture","object_furniture_definitions",["furniture_id"]],["furniture","object_owned_furniture_instances",["owned_furniture_id"]],["furniture","object_home_furniture_placements",["home_furniture_placement_id"]],["furniture","object_furniture_market_listings",["furniture_market_listing_id"]],
  ["pet-equipment","canonical_pet_definitions",["pet_id"]],["pet-equipment","canonical_owned_pet_instances",["owned_pet_id"]],["pet-equipment","canonical_equipment_definitions",["equipment_id"]],["pet-equipment","canonical_owned_equipment_instances",["owned_equipment_id"]],["pet-equipment","canonical_owned_pet_equipment",["owned_pet_equipment_id"]],
  ["mini-pet","canonical_mini_pet_definitions",["mini_pet_id"]],["mini-pet","canonical_mini_pet_enhancement_rules",["mini_pet_enhancement_rule_id"]],["mini-pet","canonical_owned_mini_pet_instances",["owned_mini_pet_id"]],
  ["member-title","canonical_member_title_definitions",["member_title_id"]],["member-title","canonical_owned_member_title_instances",["owned_member_title_id"]],["member-title","canonical_member_title_selections",["player_id"]],
  ["pet-title","canonical_pet_title_definitions",["pet_title_id"]],["pet-title","canonical_owned_pet_title_instances",["owned_pet_title_id"]],["pet-title","canonical_pet_title_selections",["player_id"]],
  ["mini-pet-title","canonical_mini_pet_title_definitions",["mini_pet_title_id"]],["mini-pet-title","canonical_owned_mini_pet_title_instances",["owned_mini_pet_title_id"]],["mini-pet-title","canonical_mini_pet_title_selections",["player_id"]],
  ["pet-skill","canonical_pet_skill_definitions",["pet_skill_id"]],["pet-skill","canonical_owned_pet_skill_stacks",["owned_pet_skill_id"]],["pet-skill","canonical_owned_pet_skill_equipments",["owned_pet_skill_equipment_id"]],
  ["currency","canonical_currency_definitions",["currency_id"]],["currency","canonical_player_currency_balances",["player_currency_balance_id"]],["currency","canonical_currency_operations",["currency_operation_id"]],["currency","canonical_currency_ledger_entries",["currency_ledger_entry_id"]],
  ["package","canonical_package_definitions",["package_id"]],["package","canonical_package_reward_groups",["package_reward_group_id"]],["package","canonical_package_reward_entries",["package_reward_entry_id"]],["package","canonical_package_item_rewards",["package_reward_entry_id"]],["package","canonical_package_nested_rewards",["package_reward_entry_id"]],["package","canonical_package_reward_quarantines",["package_reward_quarantine_id"]],
  ["building-recipe","canonical_building_definitions",["building_id"]],["building-recipe","canonical_craft_recipe_definitions",["craft_recipe_id"]],["building-recipe","canonical_craft_recipe_item_inputs",["craft_recipe_item_input_id"]],["building-recipe","canonical_craft_recipe_currency_inputs",["craft_recipe_currency_input_id"]],["building-recipe","canonical_craft_recipe_item_outputs",["craft_recipe_item_output_id"]],["building-recipe","canonical_craft_recipe_currency_outputs",["craft_recipe_currency_output_id"]],["building-recipe","canonical_building_craft_recipes",["building_craft_recipe_id"]],
].map(([domain,table,primaryKey]) => Object.freeze({ domain,table,primaryKey })) as readonly TablePlan[]);

const AUDIT_COLUMNS = new Set(["INSERT_USER","INSERT_TIME","UPDATE_USER","UPDATE_TIME"]);
const REFERENCE_TARGETS:Readonly<Record<string,readonly [string,string]>>=Object.freeze({
  player_id:["canonical_players","player_id"],item_id:["canonical_item_definitions","item_id"],furniture_id:["object_furniture_definitions","furniture_id"],owned_furniture_id:["object_owned_furniture_instances","owned_furniture_id"],
  pet_id:["canonical_pet_definitions","pet_id"],equipment_id:["canonical_equipment_definitions","equipment_id"],owned_pet_id:["canonical_owned_pet_instances","owned_pet_id"],owned_equipment_id:["canonical_owned_equipment_instances","owned_equipment_id"],
  mini_pet_id:["canonical_mini_pet_definitions","mini_pet_id"],member_title_id:["canonical_member_title_definitions","member_title_id"],owned_member_title_id:["canonical_owned_member_title_instances","owned_member_title_id"],
  pet_title_id:["canonical_pet_title_definitions","pet_title_id"],owned_pet_title_id:["canonical_owned_pet_title_instances","owned_pet_title_id"],mini_pet_title_id:["canonical_mini_pet_title_definitions","mini_pet_title_id"],owned_mini_pet_title_id:["canonical_owned_mini_pet_title_instances","owned_mini_pet_title_id"],
  pet_skill_id:["canonical_pet_skill_definitions","pet_skill_id"],currency_id:["canonical_currency_definitions","currency_id"],player_currency_balance_id:["canonical_player_currency_balances","player_currency_balance_id"],currency_operation_id:["canonical_currency_operations","currency_operation_id"],
  package_id:["canonical_package_definitions","package_id"],package_reward_group_id:["canonical_package_reward_groups","package_reward_group_id"],package_reward_entry_id:["canonical_package_reward_entries","package_reward_entry_id"],
  building_id:["canonical_building_definitions","building_id"],craft_recipe_id:["canonical_craft_recipe_definitions","craft_recipe_id"],
});
const DECIMAL = /^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/;
function scalarCompare(left:string,right:string):number { const a=Array.from(left,v=>v.codePointAt(0)!);const b=Array.from(right,v=>v.codePointAt(0)!);for(let i=0;i<Math.min(a.length,b.length);i+=1)if(a[i]!==b[i])return a[i]!-b[i]!;return a.length-b.length; }
function normalize(value: unknown): ShadowValue {
  if (typeof value === "bigint") return { $bigint:value.toString() };
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") { if (!Number.isFinite(value) || !Number.isSafeInteger(value)) throw new Error("BIGINT_ENCODING_INVALID"); return value; }
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object") {
    const record=value as Record<string,unknown>;
    if (Object.keys(record).length===1 && Object.hasOwn(record,"$bigint")) { const decimal=record.$bigint;if(typeof decimal!=="string"||!DECIMAL.test(decimal)||decimal==="-0")throw new Error("BIGINT_ENCODING_INVALID");return {$bigint:decimal}; }
    return Object.fromEntries(Object.entries(record).filter(([key])=>!AUDIT_COLUMNS.has(key)).sort(([a],[b])=>scalarCompare(a,b)).map(([key,entry])=>[key,normalize(entry)]));
  }
  throw new Error("SHADOW_VALUE_INVALID");
}
function stableJson(value: ShadowValue):string { if(value===null||typeof value!=="object")return JSON.stringify(value);if(Array.isArray(value))return `[${value.map(stableJson).join(",")}]`;const record=value as Readonly<Record<string,ShadowValue>>;return `{${Object.keys(record).sort(scalarCompare).map(key=>`${JSON.stringify(key)}:${stableJson(record[key]!)}`).join(",")}}`; }
function fingerprint(value: ShadowValue):string { return createHash("sha256").update(stableJson(value),"utf8").digest("hex"); }
function rowKey(row:ShadowRow,keys:readonly string[]):string { return stableJson(keys.map(key=>{if(!Object.hasOwn(row,key))throw new Error(`SHADOW_PRIMARY_KEY_MISSING:${key}`);return row[key]!;})); }
function unicodeMismatch(left:ShadowValue,right:ShadowValue):boolean { if(typeof left==="string"&&typeof right==="string")return left!==right&&left.normalize("NFC")===right.normalize("NFC");if(Array.isArray(left)&&Array.isArray(right))return left.some((v,i)=>right[i]!==undefined&&unicodeMismatch(v,right[i]!));if(left&&right&&typeof left==="object"&&typeof right==="object"&&!Array.isArray(left)&&!Array.isArray(right)){const a=left as Readonly<Record<string,ShadowValue>>;const b=right as Readonly<Record<string,ShadowValue>>;return Object.keys(a).some(key=>Object.hasOwn(b,key)&&unicodeMismatch(a[key]!,b[key]!));}return false; }
function mismatch(category:ObjectDbShadowMismatchCategory,plan:TablePlan|null,key:string|null,field:string|null,legacy:ShadowValue|null,canonical:ShadowValue|null):ObjectDbShadowMismatch { return {category,domain:plan?.domain??null,table:plan?.table??null,rowKey:key,field,legacyFingerprint:legacy===null?null:fingerprint(legacy),canonicalFingerprint:canonical===null?null:fingerprint(canonical)}; }

// SQL과 테이블 선택은 이 모듈의 45-table plan에 고정되어 있으며, 호출자는 query 문자열을 주입할 수 없습니다.
export class ObjectDbShadowValidationProvider {
  async compare(database: AppWiringReadParticipant,input:ObjectDbShadowValidationInput):Promise<ObjectDbShadowValidationResult> {
    const mismatches:ObjectDbShadowMismatch[]=[];
    const canonicalByTable=new Map<string,readonly ShadowRow[]>();
    const expectedTables=new Set(OBJECT_DB_SHADOW_TABLE_PLAN.map(plan=>plan.table));
    for(const table of Object.keys(input.legacyRowsByTable).sort(scalarCompare))if(!expectedTables.has(table))mismatches.push(mismatch("TABLE_COVERAGE_MISMATCH",null,table,null,null,null));
    for(const issue of input.identityIssues??[])mismatches.push({category:issue.category,domain:null,table:null,rowKey:issue.locatorFingerprint,field:null,legacyFingerprint:null,canonicalFingerprint:null});
    const projection:ShadowValue[]=[];
    for(const plan of OBJECT_DB_SHADOW_TABLE_PLAN){
      const supplied=input.legacyRowsByTable[plan.table];
      if(supplied===undefined){mismatches.push(mismatch("TABLE_COVERAGE_MISMATCH",plan,null,null,null,null));continue;}
      let legacy:ShadowRow[];let canonical:ShadowRow[];
      try{
        legacy=supplied.map(row=>normalize(row) as ShadowRow);
        const comparisonColumns=new Set([...plan.primaryKey,...legacy.flatMap(row=>Object.keys(row))]);
        const booleanColumns=new Set(legacy.flatMap(row=>Object.entries(row).filter(([,value])=>typeof value==="boolean").map(([column])=>column)));
        canonical=(await database.query<Record<string,unknown>[]>(`SELECT * FROM ${plan.table}`)).map(row=>normalize(Object.fromEntries([...comparisonColumns].filter(column=>Object.hasOwn(row,column)).map(column=>{const value=row[column];return [column,booleanColumns.has(column)&&(value===0||value===1)?value===1:value];}))) as ShadowRow);
      }catch(error){if(error instanceof Error&&error.message==="BIGINT_ENCODING_INVALID"){mismatches.push(mismatch("BIGINT_ENCODING_INVALID",plan,null,null,null,null));continue;}throw error;}
      canonicalByTable.set(plan.table,canonical);
      const left=new Map<string,ShadowRow>();const right=new Map<string,ShadowRow>();
      for(const row of legacy){const key=rowKey(row,plan.primaryKey);if(left.has(key))mismatches.push(mismatch("ROW_MULTIPLICITY_MISMATCH",plan,key,null,row,null));else left.set(key,row);}
      for(const row of canonical){const key=rowKey(row,plan.primaryKey);if(right.has(key))mismatches.push(mismatch("ROW_MULTIPLICITY_MISMATCH",plan,key,null,null,row));else right.set(key,row);}
      for(const [key,row] of left){const other=right.get(key);if(!other){mismatches.push(mismatch("CANONICAL_ROW_MISSING",plan,key,null,row,null));continue;}const fields=[...new Set([...Object.keys(row),...Object.keys(other)])].sort(scalarCompare);for(const field of fields){const leftPresent=Object.hasOwn(row,field);const rightPresent=Object.hasOwn(other,field);const a=leftPresent?row[field]!:null;const b=rightPresent?other[field]!:null;if(leftPresent!==rightPresent||stableJson(a)!==stableJson(b)){const legacyValue=leftPresent?a:{present:false};const canonicalValue=rightPresent?b:{present:false};mismatches.push(mismatch(leftPresent&&rightPresent&&unicodeMismatch(a,b)?"UNICODE_BYTE_MISMATCH":"FIELD_VALUE_MISMATCH",plan,key,field,legacyValue,canonicalValue));}}}
      for(const [key,row] of right)if(!left.has(key))mismatches.push(mismatch("LEGACY_ROW_MISSING",plan,key,null,null,row));
      projection.push({domain:plan.domain,table:plan.table,rows:[...right.entries()].sort(([a],[b])=>scalarCompare(a,b)).map(([,row])=>row)});
    }
    for(const plan of OBJECT_DB_SHADOW_TABLE_PLAN)for(const row of canonicalByTable.get(plan.table)??[]){
      const key=rowKey(row,plan.primaryKey);
      for(const [column,value] of Object.entries(row)){
        const target=REFERENCE_TARGETS[column];if(target===undefined||target[0]===plan.table||value===null)continue;
        const targetRows=canonicalByTable.get(target[0])??[];
        if(!targetRows.some(candidate=>Object.hasOwn(candidate,target[1])&&stableJson(candidate[target[1]]!)===stableJson(value)))mismatches.push(mismatch("REFERENCE_CLOSURE_MISMATCH",plan,key,column,null,value));
      }
    }
    const baseFingerprint=fingerprint(projection);
    if(input.previousRunFingerprint!==undefined&&input.previousRunFingerprint!==baseFingerprint)mismatches.push(mismatch("RESTART_FINGERPRINT_DRIFT",null,null,null,null,null));
    if(input.beforeMutationFingerprint!==undefined&&input.afterMutationFingerprint!==undefined&&input.beforeMutationFingerprint!==input.afterMutationFingerprint)mismatches.push(mismatch("MUTATION_DETECTED",null,null,null,null,null));
    const ordered=[...mismatches].sort((a,b)=>scalarCompare(stableJson(normalize(a)),stableJson(normalize(b))));
    const envelope={schemaVersion:"object-db-shadow-validation.v1" as const,comparedTableCount:OBJECT_DB_SHADOW_TABLE_PLAN.length,mismatches:ordered,projectionFingerprint:baseFingerprint};
    return {...envelope,mismatchCount:ordered.length,promotionAllowed:ordered.length===0,runFingerprint:fingerprint(normalize(envelope))};
  }
}

export class MariaObjectDbShadowValidationProvider extends ObjectDbShadowValidationProvider {}
