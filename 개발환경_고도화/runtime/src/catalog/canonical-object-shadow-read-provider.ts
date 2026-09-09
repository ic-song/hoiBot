import { createHash } from "node:crypto";
import { isLosslessNumber, parse as parseLossless } from "lossless-json";
import type { DatabaseTransactionCapabilities, ReadOnlySnapshotTransaction } from "../database.js";

export const CANONICAL_OBJECT_SHADOW_DOMAINS = [
  "items", "furniture", "pets", "miniPets", "memberTitles", "petTitles",
  "miniPetTitles", "petSkills", "equipment", "packages", "currencies", "buildings", "craftRecipes",
] as const;
export type CanonicalObjectShadowDomain = typeof CANONICAL_OBJECT_SHADOW_DOMAINS[number];
export type CanonicalShadowJson = null | boolean | number | string | CanonicalShadowJson[] | { [key: string]: CanonicalShadowJson };

export interface CanonicalShadowRecord {
  recordKind: string;
  recordId: string;
  definitionId: string | null;
  relations: Readonly<Record<string, string | null>>;
  attributes: Readonly<Record<string, CanonicalShadowJson>>;
}
export interface CanonicalShadowDomainSnapshot { owned: readonly CanonicalShadowRecord[]; catalog: readonly CanonicalShadowRecord[]; }
export interface CanonicalObjectShadowSnapshot {
  schemaVersion: "canonical-object-shadow.v1";
  playerId: string;
  domains: Readonly<Record<CanonicalObjectShadowDomain, CanonicalShadowDomainSnapshot>>;
  payloadFingerprint: string;
}

interface ReadSpec {
  domain: CanonicalObjectShadowDomain;
  segment: "owned" | "catalog";
  recordKind: string;
  idColumn: string;
  definitionColumn?: string;
  sql: string;
  playerScoped?: true;
}

// 모든 SQL과 table 선택은 provider 내부에 고정합니다. 호출자는 player ID 외의 query 입력을 제공할 수 없습니다.
const READ_SPECS: readonly ReadSpec[] = [
  { domain:"items",segment:"owned",recordKind:"item-stack",idColumn:"owned_item_stack_id",definitionColumn:"item_id",playerScoped:true,sql:"SELECT owned_item_stack_id,item_id,quantity FROM canonical_owned_item_stacks WHERE player_id=?" },
  { domain:"items",segment:"owned",recordKind:"item-instance",idColumn:"owned_item_id",definitionColumn:"item_id",playerScoped:true,sql:"SELECT owned_item_id,item_id,ownership_status,instance_options FROM canonical_owned_item_instances WHERE player_id=?" },
  { domain:"items",segment:"catalog",recordKind:"item-definition",idColumn:"item_id",definitionColumn:"item_id",sql:"SELECT item_id,item_name,item_description,item_kind,item_grade,price_amount,price_currency_source_identifier,stackable_flag,active_flag,definition_options FROM canonical_item_definitions" },
  { domain:"furniture",segment:"owned",recordKind:"furniture-instance",idColumn:"owned_furniture_id",definitionColumn:"furniture_id",playerScoped:true,sql:"SELECT owned.owned_furniture_id,owned.furniture_id,owned.enhancement_level,owned.ownership_status,placement.home_furniture_placement_id,placement.placement_order FROM object_owned_furniture_instances owned LEFT JOIN object_home_furniture_placements placement ON placement.owned_furniture_id=owned.owned_furniture_id WHERE owned.player_id=?" },
  { domain:"furniture",segment:"catalog",recordKind:"furniture-definition",idColumn:"furniture_id",definitionColumn:"furniture_id",sql:"SELECT furniture_id,display_name,purchase_price,base_charm,charm_per_enhancement,active FROM object_furniture_definitions" },
  { domain:"pets",segment:"owned",recordKind:"pet-instance",idColumn:"owned_pet_id",definitionColumn:"pet_id",playerScoped:true,sql:"SELECT owned_pet_id,pet_id,custom_name,enhancement_level,experience_amount,ownership_status FROM canonical_owned_pet_instances WHERE player_id=?" },
  { domain:"pets",segment:"catalog",recordKind:"pet-definition",idColumn:"pet_id",definitionColumn:"pet_id",sql:"SELECT pet_id,pet_name,pet_description,pet_grade,base_charm,charm_per_enhancement,active_flag FROM canonical_pet_definitions" },
  { domain:"equipment",segment:"owned",recordKind:"equipment-instance",idColumn:"owned_equipment_id",definitionColumn:"equipment_id",playerScoped:true,sql:"SELECT equipment.owned_equipment_id,equipment.equipment_id,equipment.custom_name,equipment.enhancement_level,equipment.durability_amount,equipment.ownership_status,binding.owned_pet_equipment_id,binding.owned_pet_id,binding.equipment_slot FROM canonical_owned_equipment_instances equipment LEFT JOIN canonical_owned_pet_equipment binding ON binding.owned_equipment_id=equipment.owned_equipment_id AND binding.player_id=equipment.player_id WHERE equipment.player_id=?" },
  { domain:"equipment",segment:"catalog",recordKind:"equipment-definition",idColumn:"equipment_id",definitionColumn:"equipment_id",sql:"SELECT equipment_id,equipment_name,equipment_description,equipment_slot,equipment_grade,base_charm,charm_per_enhancement,active_flag FROM canonical_equipment_definitions" },
  { domain:"miniPets",segment:"owned",recordKind:"mini-pet-instance",idColumn:"owned_mini_pet_id",definitionColumn:"mini_pet_id",playerScoped:true,sql:"SELECT owned_mini_pet_id,mini_pet_id,custom_name,custom_emoji,enhancement_level,equipped_flag,bound_flag,ownership_status FROM canonical_owned_mini_pet_instances WHERE player_id=?" },
  { domain:"miniPets",segment:"catalog",recordKind:"mini-pet-definition",idColumn:"mini_pet_id",definitionColumn:"mini_pet_id",sql:"SELECT mini_pet_id,mini_pet_name,mini_pet_emoji,mini_pet_grade,sale_price,base_battle_charm,base_castle_charm,base_raid_charm,max_enhancement_level,active_flag FROM canonical_mini_pet_definitions" },
  { domain:"miniPets",segment:"catalog",recordKind:"mini-pet-enhancement-rule",idColumn:"mini_pet_enhancement_rule_id",definitionColumn:"mini_pet_id",sql:"SELECT mini_pet_enhancement_rule_id,mini_pet_id,target_enhancement_level,battle_charm_gain,castle_charm_gain,raid_charm_gain,success_probability,point_cost,stone_quantity FROM canonical_mini_pet_enhancement_rules" },
  { domain:"memberTitles",segment:"owned",recordKind:"member-title-instance",idColumn:"owned_member_title_id",definitionColumn:"member_title_id",playerScoped:true,sql:"SELECT owned.owned_member_title_id,owned.member_title_id,owned.acquisition_sequence,owned.acquired_time,owned.acquisition_price,owned.ownership_status,selection.owned_member_title_id AS selected_owned_member_title_id FROM canonical_owned_member_title_instances owned LEFT JOIN canonical_member_title_selections selection ON selection.owned_member_title_id=owned.owned_member_title_id AND selection.player_id=owned.player_id WHERE owned.player_id=?" },
  { domain:"memberTitles",segment:"catalog",recordKind:"member-title-definition",idColumn:"member_title_id",definitionColumn:"member_title_id",sql:"SELECT member_title_id,title_name,base_sale_price,active_flag FROM canonical_member_title_definitions" },
  { domain:"petTitles",segment:"owned",recordKind:"pet-title-instance",idColumn:"owned_pet_title_id",definitionColumn:"pet_title_id",playerScoped:true,sql:"SELECT owned.owned_pet_title_id,owned.pet_title_id,owned.acquisition_sequence,owned.acquired_time,owned.acquisition_price,owned.ownership_status,selection.owned_pet_title_id AS selected_owned_pet_title_id FROM canonical_owned_pet_title_instances owned LEFT JOIN canonical_pet_title_selections selection ON selection.owned_pet_title_id=owned.owned_pet_title_id AND selection.player_id=owned.player_id WHERE owned.player_id=?" },
  { domain:"petTitles",segment:"catalog",recordKind:"pet-title-definition",idColumn:"pet_title_id",definitionColumn:"pet_title_id",sql:"SELECT pet_title_id,title_name,base_sale_price,active_flag FROM canonical_pet_title_definitions" },
  { domain:"miniPetTitles",segment:"owned",recordKind:"mini-pet-title-instance",idColumn:"owned_mini_pet_title_id",definitionColumn:"mini_pet_title_id",playerScoped:true,sql:"SELECT owned.owned_mini_pet_title_id,owned.mini_pet_title_id,owned.acquisition_sequence,owned.acquired_time,owned.acquisition_price,owned.ownership_status,selection.owned_mini_pet_title_id AS selected_owned_mini_pet_title_id FROM canonical_owned_mini_pet_title_instances owned LEFT JOIN canonical_mini_pet_title_selections selection ON selection.owned_mini_pet_title_id=owned.owned_mini_pet_title_id AND selection.player_id=owned.player_id WHERE owned.player_id=?" },
  { domain:"miniPetTitles",segment:"catalog",recordKind:"mini-pet-title-definition",idColumn:"mini_pet_title_id",definitionColumn:"mini_pet_title_id",sql:"SELECT mini_pet_title_id,title_name,base_sale_price,active_flag FROM canonical_mini_pet_title_definitions" },
  { domain:"petSkills",segment:"owned",recordKind:"pet-skill-stack",idColumn:"owned_pet_skill_id",definitionColumn:"pet_skill_id",playerScoped:true,sql:"SELECT owned_pet_skill_id,pet_skill_id,quantity FROM canonical_owned_pet_skill_stacks WHERE player_id=?" },
  { domain:"petSkills",segment:"owned",recordKind:"pet-skill-equipment",idColumn:"owned_pet_skill_equipment_id",definitionColumn:"pet_skill_id",playerScoped:true,sql:"SELECT owned_pet_skill_equipment_id,pet_skill_id,owned_pet_id,slot_number FROM canonical_owned_pet_skill_equipments WHERE player_id=?" },
  { domain:"petSkills",segment:"catalog",recordKind:"pet-skill-definition",idColumn:"pet_skill_id",definitionColumn:"pet_skill_id",sql:"SELECT pet_skill_id,pet_skill_name,pet_skill_description,pet_skill_grade,handler_key,options_json,active_flag FROM canonical_pet_skill_definitions" },
  { domain:"packages",segment:"catalog",recordKind:"package-definition",idColumn:"package_id",definitionColumn:"package_id",sql:"SELECT package_id,package_name,package_description,max_open_quantity,active_flag FROM canonical_package_definitions" },
  { domain:"packages",segment:"catalog",recordKind:"package-reward-group",idColumn:"package_reward_group_id",definitionColumn:"package_id",sql:"SELECT package_reward_group_id,package_id,selection_mode,active_flag FROM canonical_package_reward_groups" },
  { domain:"packages",segment:"catalog",recordKind:"package-reward-entry",idColumn:"package_reward_entry_id",sql:"SELECT package_reward_entry_id,package_reward_group_id,reward_order,target_kind FROM canonical_package_reward_entries" },
  { domain:"packages",segment:"catalog",recordKind:"package-item-reward",idColumn:"package_reward_entry_id",definitionColumn:"item_id",sql:"SELECT package_reward_entry_id,item_id,quantity,probability FROM canonical_package_item_rewards" },
  { domain:"packages",segment:"catalog",recordKind:"package-nested-reward",idColumn:"package_reward_entry_id",definitionColumn:"package_id",sql:"SELECT package_reward_entry_id,package_id,quantity,probability FROM canonical_package_nested_rewards" },
  { domain:"currencies",segment:"owned",recordKind:"currency-balance",idColumn:"player_currency_balance_id",definitionColumn:"currency_id",playerScoped:true,sql:"SELECT player_currency_balance_id,currency_id,balance_minor_amount FROM canonical_player_currency_balances WHERE player_id=?" },
  { domain:"currencies",segment:"catalog",recordKind:"currency-definition",idColumn:"currency_id",definitionColumn:"currency_id",sql:"SELECT currency_id,currency_name,decimal_places,active_flag FROM canonical_currency_definitions" },
  { domain:"buildings",segment:"catalog",recordKind:"building-definition",idColumn:"building_id",definitionColumn:"building_id",sql:"SELECT building_id,building_name,floor_value,experience_required,active_flag FROM canonical_building_definitions" },
  { domain:"craftRecipes",segment:"catalog",recordKind:"craft-recipe-definition",idColumn:"craft_recipe_id",definitionColumn:"craft_recipe_id",sql:"SELECT craft_recipe_id,craft_recipe_name,craft_recipe_kind,maximum_batch_count,active_flag FROM canonical_craft_recipe_definitions" },
  { domain:"craftRecipes",segment:"catalog",recordKind:"craft-item-input",idColumn:"craft_recipe_item_input_id",definitionColumn:"craft_recipe_id",sql:"SELECT craft_recipe_item_input_id,craft_recipe_id,item_id,quantity FROM canonical_craft_recipe_item_inputs" },
  { domain:"craftRecipes",segment:"catalog",recordKind:"craft-currency-input",idColumn:"craft_recipe_currency_input_id",definitionColumn:"craft_recipe_id",sql:"SELECT craft_recipe_currency_input_id,craft_recipe_id,currency_id,amount_minor FROM canonical_craft_recipe_currency_inputs" },
  { domain:"craftRecipes",segment:"catalog",recordKind:"craft-item-output",idColumn:"craft_recipe_item_output_id",definitionColumn:"craft_recipe_id",sql:"SELECT craft_recipe_item_output_id,craft_recipe_id,item_id,quantity FROM canonical_craft_recipe_item_outputs" },
  { domain:"craftRecipes",segment:"catalog",recordKind:"craft-currency-output",idColumn:"craft_recipe_currency_output_id",definitionColumn:"craft_recipe_id",sql:"SELECT craft_recipe_currency_output_id,craft_recipe_id,currency_id,amount_minor FROM canonical_craft_recipe_currency_outputs" },
  { domain:"craftRecipes",segment:"catalog",recordKind:"building-craft-recipe",idColumn:"building_craft_recipe_id",definitionColumn:"craft_recipe_id",sql:"SELECT building_craft_recipe_id,craft_recipe_id,building_id FROM canonical_building_craft_recipes" },
];

function stableJson(value: CanonicalShadowJson): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key]!)}`).join(",")}}`;
}
function normalizeJson(value: unknown, jsonColumn = false): CanonicalShadowJson {
  if (jsonColumn && typeof value === "string") {
    try { return normalizeJson(parseLossless(value),true); } catch { throw new Error("CANONICAL_SHADOW_JSON_INVALID"); }
  }
  if (isLosslessNumber(value)) return value.toString();
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("CANONICAL_SHADOW_NUMBER_INVALID");
    return jsonColumn ? String(value) : value;
  }
  if (Array.isArray(value)) return value.map((entry) => normalizeJson(entry,jsonColumn));
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([left],[right]) => left.localeCompare(right,"en")).map(([key,entry]) => [key,normalizeJson(entry,jsonColumn)]));
  throw new Error("CANONICAL_SHADOW_VALUE_INVALID");
}
function identifier(value: unknown, location: string): string {
  const result = String(value ?? "");
  if (!/^[a-z][a-z0-9]{7}$/.test(result)) throw new Error(`CANONICAL_SHADOW_IDENTIFIER_INVALID:${location}`);
  return result;
}
function mapRow(spec: ReadSpec, row: Record<string, unknown>): CanonicalShadowRecord {
  const recordId = identifier(row[spec.idColumn], `${spec.recordKind}.${spec.idColumn}`);
  const definitionId = spec.definitionColumn === undefined ? null : identifier(row[spec.definitionColumn], `${spec.recordKind}.${spec.definitionColumn}`);
  const relations: Record<string,string|null> = {};
  const attributes: Record<string,CanonicalShadowJson> = {};
  for (const key of Object.keys(row).sort()) {
    if (key === spec.idColumn || key === spec.definitionColumn) continue;
    const value = row[key];
    if (key.endsWith("_id")) relations[key] = value === null || value === undefined ? null : identifier(value, `${spec.recordKind}.${key}`);
    else if (key.endsWith("_flag") || key === "active") {
      if (value !== true && value !== false && value !== 0 && value !== 1 && value !== 0n && value !== 1n) throw new Error(`CANONICAL_SHADOW_BOOLEAN_INVALID:${spec.recordKind}.${key}`);
      attributes[key] = value === true || value === 1 || value === 1n;
    } else attributes[key] = normalizeJson(value, key.endsWith("_json") || key.endsWith("_options"));
  }
  return { recordKind:spec.recordKind,recordId,definitionId,relations,attributes };
}
function compareRecord(left: CanonicalShadowRecord, right: CanonicalShadowRecord): number {
  return left.recordKind.localeCompare(right.recordKind,"en") || left.recordId.localeCompare(right.recordId,"en") || stableJson({ relations:left.relations,attributes:left.attributes }).localeCompare(stableJson({ relations:right.relations,attributes:right.attributes }),"en");
}

export class CanonicalObjectShadowReadProvider {
  readonly #database: Pick<DatabaseTransactionCapabilities,"withReadOnlySnapshot">;
  constructor(database: Pick<DatabaseTransactionCapabilities,"withReadOnlySnapshot">) {
    if (typeof database?.withReadOnlySnapshot !== "function") throw new Error("CANONICAL_SHADOW_READ_ONLY_CAPABILITY_REQUIRED");
    this.#database = database;
  }

  async readPlayerSnapshot(playerId: string): Promise<CanonicalObjectShadowSnapshot> {
    identifier(playerId,"playerId");
    const domains = await this.#database.withReadOnlySnapshot(async (transaction) => this.readAll(transaction,playerId));
    const envelope = { schemaVersion:"canonical-object-shadow.v1" as const,playerId,domains };
    return { ...envelope,payloadFingerprint:createHash("sha256").update(stableJson(normalizeJson(envelope))).digest("hex") };
  }

  private async readAll(transaction: ReadOnlySnapshotTransaction, playerId: string): Promise<Record<CanonicalObjectShadowDomain, CanonicalShadowDomainSnapshot>> {
    const domains = Object.fromEntries(CANONICAL_OBJECT_SHADOW_DOMAINS.map((domain) => [domain,{ owned:[] as CanonicalShadowRecord[],catalog:[] as CanonicalShadowRecord[] }])) as Record<CanonicalObjectShadowDomain,{ owned:CanonicalShadowRecord[];catalog:CanonicalShadowRecord[] }>;
    for (const spec of READ_SPECS) {
      const rows = await transaction.query<Record<string,unknown>[]>(spec.sql,spec.playerScoped ? [playerId] : []);
      domains[spec.domain][spec.segment].push(...rows.map((row) => mapRow(spec,row)));
    }
    for (const domain of CANONICAL_OBJECT_SHADOW_DOMAINS) {
      domains[domain].owned.sort(compareRecord);
      domains[domain].catalog.sort(compareRecord);
    }
    return domains;
  }
}
