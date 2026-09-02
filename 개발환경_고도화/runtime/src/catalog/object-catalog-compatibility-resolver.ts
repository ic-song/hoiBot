import type { DatabaseClient } from "../database.js";
import { assertObjectIdentityCandidate } from "../identity/object-identity-audit-provider.js";
import type { ObjectAliasType, ObjectSourceBindingInput, ObjectType } from "./object-catalog.js";

// WBS731 crosswalk의 source locator. legacy BIGINT는 이 입력으로만 취급합니다.
export const LEGACY_OBJECT_REGISTRY_SOURCE = {
  system: "LEGACY_DB",
  namespace: "object_registry.id"
} as const;

export type ObjectCatalogCompatibilityStatus = "RESOLVED" | "UNMAPPED" | "TYPE_MISMATCH" | "AMBIGUOUS";

// migration 384~443과 현재 catalog consumer가 실제로 기록·조회하는 binding locator만 동결합니다.
const LEGACY_SOURCE_TABLES = {
  LEGACY_JS: ["member.bag"],
  LEGACY_JSON: [
    "PET_SKILL_LIST",
    "miniPetData.miniPet",
    "petSweetHomeInfo.homeInfo.required",
    "petSweetHomeInfo.homeInfo",
    "petSweetHomeInfo.furnitureDraw",
    "data/miniPetCollectionInfo.json#titles",
    "petSweetHomeInfo.furnitureDraw.v2_438",
    "petSweetHomeInfo.homeInfo.required.v2_438",
    "petSweetHomeInfo.homeInfo.v2_438",
    "trialTowerBoss.reward.v2_438",
    "data/packageInfo.json"
  ],
  RUNTIME_DB: [
    "item_definitions",
    "currency_definitions",
    "home_badge_definitions",
    "asset_package_reward_target_occurrences"
  ],
  "legacy-json": [
    "data/itemInfo.json#ring",
    "data/itemInfo.json#raidSpecialItem",
    "data/itemInfo.json#castlePremiumItem",
    "data/itemInfo.json#castleItem"
  ]
} as const;

export type LegacySourceSystem = keyof typeof LEGACY_SOURCE_TABLES;
export interface LegacySourceLocator { system: LegacySourceSystem; table: string; key: string; }

export interface ObjectCatalogCompatibilityResult {
  status: ObjectCatalogCompatibilityStatus;
  canonicalObjectIdentityId: string | null;
  legacyObjectId: string | null;
  legacyObjectKey: string | null;
  objectType: ObjectType | null;
  quarantineReason: string | null;
}

interface LegacyObjectRow {
  legacy_object_id: bigint;
  legacy_object_key: string;
  object_type: ObjectType;
  object_identity_id: string | null;
}

type ResolverInput = { expectedObjectType?: ObjectType };
const MAX_LEGACY_OBJECT_ID = 18446744073709551615n;
const MAX_LEGACY_LOCATOR_LENGTH = 191;
const LEGACY_TOKEN_PATTERN = /^[A-Za-z0-9_.#-]+$/;

function unresolved(status: Exclude<ObjectCatalogCompatibilityStatus, "RESOLVED">, reason: string): ObjectCatalogCompatibilityResult {
  return { status, canonicalObjectIdentityId: null, legacyObjectId: null, legacyObjectKey: null, objectType: null, quarantineReason: reason };
}

// BIGINT UNSIGNED 비교 전에 canonical decimal과 최댓값을 확정해 MariaDB coercion을 차단합니다.
function normalizeLegacyObjectId(value: string): string | null {
  if (!/^[1-9][0-9]*$/.test(value)) return null;
  try {
    return BigInt(value) <= MAX_LEGACY_OBJECT_ID ? value : null;
  } catch {
    return null;
  }
}

function isLegacyToken(value: string, maxLength: number): boolean {
  return value.length > 0 && value.length <= maxLength && LEGACY_TOKEN_PATTERN.test(value);
}

function isLegacySourceLocator(binding: ObjectSourceBindingInput | LegacySourceLocator): binding is LegacySourceLocator {
  if (!(binding.system in LEGACY_SOURCE_TABLES) || binding.key.length === 0 || binding.key.length > MAX_LEGACY_LOCATOR_LENGTH) return false;
  const tables = LEGACY_SOURCE_TABLES[binding.system as LegacySourceSystem] as readonly string[];
  return tables.includes(binding.table);
}

function resolved(row: LegacyObjectRow, expectedObjectType: ObjectType | undefined): ObjectCatalogCompatibilityResult {
  const base = {
    legacyObjectId: row.legacy_object_id.toString(),
    legacyObjectKey: row.legacy_object_key,
    objectType: row.object_type
  };
  if (expectedObjectType !== undefined && row.object_type !== expectedObjectType) {
    return { status: "TYPE_MISMATCH", canonicalObjectIdentityId: null, ...base, quarantineReason: "LEGACY_OBJECT_TYPE_MISMATCH" };
  }
  if (row.object_identity_id === null) {
    return { status: "UNMAPPED", canonicalObjectIdentityId: null, ...base, quarantineReason: "LEGACY_OBJECT_IDENTITY_UNMAPPED" };
  }
  try {
    assertObjectIdentityCandidate(row.object_identity_id);
  } catch {
    return { status: "UNMAPPED", canonicalObjectIdentityId: null, ...base, quarantineReason: "CANONICAL_OBJECT_IDENTITY_INVALID" };
  }
  return { status: "RESOLVED", canonicalObjectIdentityId: row.object_identity_id, ...base, quarantineReason: null };
}

// 기존 object_registry/alias/source binding은 읽기 전용 locator이며 새 표준 PK의 FK 대상이 아닙니다.
export class ObjectCatalogCompatibilityResolver {
  constructor(private readonly database: Pick<DatabaseClient, "query">) {}

  async resolveLegacyObjectId(legacyObjectId: string, input: ResolverInput = {}): Promise<ObjectCatalogCompatibilityResult> {
    const normalizedId = normalizeLegacyObjectId(legacyObjectId);
    if (normalizedId === null) return unresolved("UNMAPPED", "LEGACY_OBJECT_ID_INVALID");
    return this.resolveRows(await this.database.query<LegacyObjectRow[]>(
      this.selectSql("WHERE registry.id = ?"), [normalizedId]
    ), input);
  }

  async resolveAlias(objectType: ObjectType, aliasType: ObjectAliasType, aliasValue: string, input: ResolverInput = {}): Promise<ObjectCatalogCompatibilityResult> {
    if (!isLegacyToken(String(aliasType), 32) || aliasValue.length === 0 || aliasValue.length > MAX_LEGACY_LOCATOR_LENGTH) {
      return unresolved("UNMAPPED", "LEGACY_OBJECT_ALIAS_INVALID");
    }
    return this.resolveRows(await this.database.query<LegacyObjectRow[]>(
      this.selectSql("JOIN object_aliases alias ON alias.object_id = registry.id AND alias.object_type = registry.object_type WHERE alias.object_type = ? AND alias.alias_type = ? AND alias.alias_value = ?"),
      [objectType, aliasType, aliasValue]
    ), { expectedObjectType: input.expectedObjectType ?? objectType });
  }

  // 기존 migration의 `legacy-json` 표기는 보존하되, system/table 모두 동결 목록과 정확히 일치해야 합니다.
  async resolveSource(binding: ObjectSourceBindingInput | LegacySourceLocator, input: ResolverInput = {}): Promise<ObjectCatalogCompatibilityResult> {
    if (!isLegacySourceLocator(binding)) {
      return unresolved("UNMAPPED", "LEGACY_OBJECT_SOURCE_INVALID");
    }
    return this.resolveRows(await this.database.query<LegacyObjectRow[]>(
      this.selectSql("JOIN object_source_bindings source ON source.object_id = registry.id AND source.object_type = registry.object_type WHERE source.source_system = ? AND source.source_table = ? AND source.source_key = ?"),
      [binding.system, binding.table, binding.key]
    ), input);
  }

  private selectSql(from: string): string {
    return "SELECT registry.id legacy_object_id,registry.object_key legacy_object_key,registry.object_type," +
      "crosswalk.object_identity_id FROM object_registry registry LEFT JOIN object_identity_crosswalks crosswalk ON " +
      "crosswalk.source_system = 'LEGACY_DB' AND crosswalk.source_namespace = 'object_registry.id' AND " +
      "crosswalk.source_identifier = CAST(registry.id AS CHAR) " + from;
  }

  private resolveRows(rows: LegacyObjectRow[], input: ResolverInput): ObjectCatalogCompatibilityResult {
    if (rows.length === 0) return unresolved("UNMAPPED", "LEGACY_OBJECT_NOT_FOUND");
    if (rows.length !== 1) return unresolved("AMBIGUOUS", "LEGACY_OBJECT_LOCATOR_AMBIGUOUS");
    return resolved(rows[0]!, input.expectedObjectType);
  }
}
