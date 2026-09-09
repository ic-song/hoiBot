import type { DatabaseClient } from "../database.js";

export type PackageRewardTargetType = "STACK" | "PACKAGE";
export type PackageRewardResolution = "RESOLVED" | "GAP" | "SOURCE_RESOLVED_CANONICAL_GAP";

export interface PackageSourceDefinition {
  sourceOrder: number;
  sourcePackageId: string;
  displayName: string;
  inventoryKey: string;
  description: string;
  enabled: boolean;
  legacyMaxUseOnce: number;
  enforcementStatus: "INERT_METADATA";
  identityHash: string;
}

export interface PackageRewardTargetOccurrence {
  globalSourceOrder: number;
  sourcePackageId: string;
  rewardOrder: number;
  rawType: string;
  targetType: PackageRewardTargetType;
  targetDisplayName: string;
  quantity: string;
  targetSourcePackageId: string | null;
  canonicalItemCode: string | null;
  canonicalPackageId: string | null;
  resolutionStatus: PackageRewardResolution;
  identityHash: string;
}

export interface PackageTypedRewardTargetCatalog {
  catalogVersion: string;
  sourceRevision: string;
  sourcePath: string;
  sourceSha256: string;
  publicationStatus: "SHADOW" | "PUBLISHED" | "RETIRED";
  packages: PackageSourceDefinition[];
  occurrences: PackageRewardTargetOccurrence[];
}

interface CatalogRow {
  id: bigint; catalog_version: string; source_revision: string; source_path: string; source_sha256: string;
  package_count: number | bigint; reward_count: number | bigint; stack_row_count: number | bigint; package_row_count: number | bigint;
  resolved_stack_row_count: number | bigint; gap_stack_row_count: number | bigint; publication_status: PackageTypedRewardTargetCatalog["publicationStatus"];
}

interface PackageRow {
  source_order: number | bigint; source_package_id: string; display_name: string; inventory_key: string; description: string;
  enabled: number | boolean; legacy_max_use_once: number | bigint; enforcement_status: "INERT_METADATA"; identity_hash: string;
}

interface OccurrenceRow {
  global_source_order: number | bigint; source_package_id: string; reward_order: number | bigint; raw_type: string;
  target_type: PackageRewardTargetType; target_display_name: string; quantity: number | bigint | string;
  target_source_package_id: string | null; canonical_item_code: string | null; canonical_package_id: string | null;
  resolution_status: PackageRewardResolution; identity_hash: string;
}

// 동결된 packageInfo 보상 대상을 원본 순서와 타입 관계를 보존해 조회합니다.
export class MariaPackageTypedRewardTargetCatalogProvider {
  constructor(private readonly database: Pick<DatabaseClient, "query">) {}

  async readCatalog(catalogVersion: string): Promise<PackageTypedRewardTargetCatalog | null> {
    const catalogs = await this.database.query<CatalogRow[]>(
      `SELECT id,catalog_version,source_revision,source_path,source_sha256,package_count,reward_count,stack_row_count,package_row_count,resolved_stack_row_count,gap_stack_row_count,publication_status FROM asset_package_typed_target_catalogs WHERE catalog_version=?`,
      [catalogVersion]
    );
    const catalog = catalogs[0];
    if (catalog === undefined) return null;
    if (catalogs.length !== 1) throw new Error("PACKAGE_TYPED_TARGET_CATALOG_AMBIGUOUS");
    const packageRows = await this.database.query<PackageRow[]>(
      `SELECT source_order,source_package_id,display_name,inventory_key,description,enabled,legacy_max_use_once,enforcement_status,identity_hash FROM asset_package_source_definitions WHERE catalog_id=? ORDER BY source_order`, [catalog.id]
    );
    const occurrenceRows = await this.database.query<OccurrenceRow[]>(
      `SELECT occurrence.global_source_order,source_definition.source_package_id,occurrence.reward_order,occurrence.raw_type,occurrence.target_type,occurrence.target_display_name,occurrence.quantity,target_definition.source_package_id AS target_source_package_id,canonical_item.code AS canonical_item_code,occurrence.canonical_package_id,occurrence.resolution_status,occurrence.identity_hash FROM asset_package_reward_target_occurrences occurrence JOIN asset_package_source_definitions source_definition ON source_definition.id=occurrence.source_package_definition_id LEFT JOIN asset_package_source_definitions target_definition ON target_definition.id=occurrence.target_source_package_definition_id LEFT JOIN item_definitions canonical_item ON canonical_item.id=occurrence.canonical_item_id WHERE occurrence.catalog_id=? ORDER BY occurrence.global_source_order`, [catalog.id]
    );
    const packages = packageRows.map((row) => ({ sourceOrder: Number(row.source_order), sourcePackageId: row.source_package_id, displayName: row.display_name, inventoryKey: row.inventory_key, description: row.description, enabled: Boolean(row.enabled), legacyMaxUseOnce: Number(row.legacy_max_use_once), enforcementStatus: row.enforcement_status, identityHash: row.identity_hash }));
    const occurrences = occurrenceRows.map((row) => ({ globalSourceOrder: Number(row.global_source_order), sourcePackageId: row.source_package_id, rewardOrder: Number(row.reward_order), rawType: row.raw_type, targetType: row.target_type, targetDisplayName: row.target_display_name, quantity: String(row.quantity), targetSourcePackageId: row.target_source_package_id, canonicalItemCode: row.canonical_item_code, canonicalPackageId: row.canonical_package_id, resolutionStatus: row.resolution_status, identityHash: row.identity_hash }));
    this.assertParity(catalog, packages, occurrences);
    return { catalogVersion: catalog.catalog_version, sourceRevision: catalog.source_revision, sourcePath: catalog.source_path, sourceSha256: catalog.source_sha256, publicationStatus: catalog.publication_status, packages, occurrences };
  }

  private assertParity(catalog: CatalogRow, packages: PackageSourceDefinition[], occurrences: PackageRewardTargetOccurrence[]): void {
    if (packages.length !== 107 || occurrences.length !== 557 || Number(catalog.package_count) !== 107 || Number(catalog.reward_count) !== 557) throw new Error("PACKAGE_TYPED_TARGET_COUNT_MISMATCH");
    const stack = occurrences.filter((row) => row.targetType === "STACK");
    const nested = occurrences.filter((row) => row.targetType === "PACKAGE");
    if (stack.length !== 513 || nested.length !== 44 || Number(catalog.stack_row_count) !== 513 || Number(catalog.package_row_count) !== 44) throw new Error("PACKAGE_TYPED_TARGET_TYPE_MISMATCH");
    if (stack.filter((row) => row.resolutionStatus === "RESOLVED").length !== 467 || stack.filter((row) => row.resolutionStatus === "GAP").length !== 46 || Number(catalog.resolved_stack_row_count) !== 467 || Number(catalog.gap_stack_row_count) !== 46) throw new Error("PACKAGE_TYPED_TARGET_RESOLUTION_MISMATCH");
    for (let index = 0; index < packages.length; index++) if (packages[index]!.sourceOrder !== index + 1 || packages[index]!.enforcementStatus !== "INERT_METADATA") throw new Error("PACKAGE_TYPED_TARGET_PACKAGE_ORDER_GAP");
    for (let index = 0; index < occurrences.length; index++) if (occurrences[index]!.globalSourceOrder !== index + 1) throw new Error("PACKAGE_TYPED_TARGET_REWARD_ORDER_GAP");
    if (nested.some((row) => row.targetSourcePackageId === null || row.canonicalItemCode !== null || row.resolutionStatus !== "SOURCE_RESOLVED_CANONICAL_GAP") || stack.some((row) => row.targetSourcePackageId !== null || row.canonicalPackageId !== null)) throw new Error("PACKAGE_TYPED_TARGET_SHAPE_MISMATCH");
  }
}
