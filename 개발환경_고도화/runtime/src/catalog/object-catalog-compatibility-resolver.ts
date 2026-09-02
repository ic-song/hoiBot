import type { DatabaseClient } from "../database.js";
import { assertObjectIdentityCandidate } from "../identity/object-identity-audit-provider.js";
import type { ObjectAliasType, ObjectSourceBindingInput, ObjectType } from "./object-catalog.js";

// WBS731 crosswalk의 source locator. legacy BIGINT는 이 입력으로만 취급합니다.
export const LEGACY_OBJECT_REGISTRY_SOURCE = {
  system: "LEGACY_DB",
  namespace: "object_registry.id"
} as const;

export type ObjectCatalogCompatibilityStatus = "RESOLVED" | "UNMAPPED" | "TYPE_MISMATCH" | "AMBIGUOUS";
export type LegacySourceSystem = ObjectSourceBindingInput["system"] | "legacy-json" | "legacy-db" | "runtime-db";
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
// legacy source_table에는 기존 `data/itemInfo.json#castleItem` 경로가 있으므로 /와 #를 보존합니다.
const LEGACY_TOKEN_PATTERN = /^[A-Za-z0-9_.#-]+$/;
const LEGACY_SOURCE_TABLE_PATTERN = /^[A-Za-z0-9_./#-]+$/;
const LEGACY_SOURCE_SYSTEMS: readonly LegacySourceSystem[] = ["LEGACY_JSON", "LEGACY_DB", "RUNTIME_DB", "legacy-json", "legacy-db", "runtime-db"];

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

function isLegacySourceTable(value: string): boolean {
  return value.length > 0 && value.length <= MAX_LEGACY_LOCATOR_LENGTH && LEGACY_SOURCE_TABLE_PATTERN.test(value);
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

  // 기존 migration의 `legacy-json` 같은 소문자 locator도 값 변환 없이 정확히 비교합니다.
  async resolveSource(binding: ObjectSourceBindingInput | LegacySourceLocator, input: ResolverInput = {}): Promise<ObjectCatalogCompatibilityResult> {
    if (!LEGACY_SOURCE_SYSTEMS.includes(binding.system) || !isLegacySourceTable(binding.table)
      || binding.key.length === 0 || binding.key.length > MAX_LEGACY_LOCATOR_LENGTH) {
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
