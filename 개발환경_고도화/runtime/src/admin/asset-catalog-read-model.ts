import type { DatabaseClient } from "../database.js";

export interface AssetCatalogListQuery { query?: string; objectType?: string; active?: boolean; page: number; limit: number; }
export interface AssetCatalogManagementProjection {
  page: number; limit: number; total: number; activeCount: number; inactiveCount: number;
  items: Array<{ definitionId: string; objectKey: string; objectType: string; displayName: string; version: string; active: boolean; sourceBindings: Array<{ system: string; table: string; key: string }> }>;
  typeCounts: Array<{ objectType: string; count: number }>;
  domains: Array<{ domain: string; canonicalTable: string; count: number }>;
  packageResolution: null | { catalogVersion: string; publicationStatus: string; packageCount: number; rewardCount: number; frozenResolved: number; overlayResolved: number; effectiveResolved: number; residualStackGaps: number; residualPackageGaps: number; conflicts: number; gaps: Array<{ sourceOrder: number; targetType: string; displayName: string; resolutionStatus: string }> };
}

interface ObjectListRow { id: bigint; object_key: string; object_type: string; display_name: string; version: bigint; active: number; }
const PACKAGE_VERSION = "ASSET-FREEZE-v2.438-package-canonical-gap-correction-01";

// 기존 canonical 테이블을 변경하지 않고 관리화면용 읽기 projection만 합성합니다.
export class AdminAssetCatalogReadModel {
  constructor(private readonly database: DatabaseClient) {}

  async read(input: AssetCatalogListQuery): Promise<AssetCatalogManagementProjection> {
    const where: string[] = [];
    const parameters: unknown[] = [];
    if (input.query) { where.push("(r.object_key LIKE ? OR r.display_name LIKE ?)"); parameters.push(`%${input.query}%`, `%${input.query}%`); }
    if (input.objectType) { where.push("r.object_type=?"); parameters.push(input.objectType); }
    if (input.active !== undefined) { where.push("r.active=?"); parameters.push(input.active); }
    const clause = where.length ? ` WHERE ${where.join(" AND ")}` : "";
    const countRows = await this.database.query<Array<{ total: bigint; active_count: bigint; inactive_count: bigint }>>(`SELECT COUNT(*) total,COALESCE(SUM(r.active=TRUE),0) active_count,COALESCE(SUM(r.active=FALSE),0) inactive_count FROM object_registry r${clause}`, parameters);
    const rows = await this.database.query<ObjectListRow[]>(`SELECT r.id,r.object_key,r.object_type,r.display_name,r.version,r.active FROM object_registry r${clause} ORDER BY r.object_type,r.object_key LIMIT ? OFFSET ?`, [...parameters, input.limit, (input.page - 1) * input.limit]);
    const ids = rows.map((row) => row.id);
    const sources = ids.length ? await this.database.query<Array<{ object_id: bigint; source_system: string; source_table: string; source_key: string }>>(`SELECT object_id,source_system,source_table,source_key FROM object_source_bindings WHERE object_id IN (${ids.map(() => "?").join(",")}) ORDER BY object_id,source_system,source_table,source_key`, ids) : [];
    const sourceMap = new Map<string, Array<{ system: string; table: string; key: string }>>();
    for (const source of sources) { const key = source.object_id.toString(); const values = sourceMap.get(key) ?? []; values.push({ system: source.source_system, table: source.source_table, key: source.source_key }); sourceMap.set(key, values); }
    const typeRows = await this.database.query<Array<{ object_type: string; count: bigint }>>("SELECT object_type,COUNT(*) count FROM object_registry GROUP BY object_type ORDER BY object_type");
    const domainRows = await this.database.query<Array<{ domain: string; canonical_table: string; count: bigint }>>("SELECT 'ITEM' domain,'item_definitions' canonical_table,COUNT(*) count FROM item_definitions UNION ALL SELECT 'PET_SKILL','skill_definitions',COUNT(*) FROM skill_definitions UNION ALL SELECT 'MINI_PET','mini_pet_definitions',COUNT(*) FROM mini_pet_definitions UNION ALL SELECT 'FURNITURE','furniture_definitions',COUNT(*) FROM furniture_definitions UNION ALL SELECT 'PENDANT_POLICY','pendant_upgrade_policy_versions',COUNT(*) FROM pendant_upgrade_policy_versions UNION ALL SELECT 'TITLE','title_definitions',COUNT(*) FROM title_definitions UNION ALL SELECT 'PASS','support_pass_definitions',COUNT(*) FROM support_pass_definitions UNION ALL SELECT 'PACKAGE','package_catalog',COUNT(*) FROM package_catalog");
    const count = countRows[0] ?? { total: 0n, active_count: 0n, inactive_count: 0n };
    return { page: input.page, limit: input.limit, total: Number(count.total), activeCount: Number(count.active_count), inactiveCount: Number(count.inactive_count), items: rows.map((row) => ({ definitionId: row.id.toString(), objectKey: row.object_key, objectType: row.object_type, displayName: row.display_name, version: row.version.toString(), active: Boolean(row.active), sourceBindings: sourceMap.get(row.id.toString()) ?? [] })), typeCounts: typeRows.map((row) => ({ objectType: row.object_type, count: Number(row.count) })), domains: domainRows.map((row) => ({ domain: row.domain, canonicalTable: row.canonical_table, count: Number(row.count) })), packageResolution: await this.readPackageResolution() };
  }

  private async readPackageResolution(): Promise<AssetCatalogManagementProjection["packageResolution"]> {
    const catalogs = await this.database.query<Array<{ id: bigint; catalog_version: string; publication_status: string; package_count: number; reward_count: number }>>("SELECT id,catalog_version,publication_status,package_count,reward_count FROM asset_package_typed_target_catalogs WHERE catalog_version=?", [PACKAGE_VERSION]);
    const catalog = catalogs[0]; if (!catalog) return null;
    const stats = (await this.database.query<Array<{ frozen_resolved: bigint; frozen_stack_gaps: bigint; package_gaps: bigint }>>("SELECT SUM(target_type='STACK' AND resolution_status='RESOLVED') frozen_resolved,SUM(target_type='STACK' AND resolution_status='GAP') frozen_stack_gaps,SUM(target_type='PACKAGE' AND resolution_status='SOURCE_RESOLVED_CANONICAL_GAP') package_gaps FROM asset_package_reward_target_occurrences WHERE catalog_id=?", [catalog.id]))[0] ?? { frozen_resolved: 0n, frozen_stack_gaps: 0n, package_gaps: 0n };
    const overlay = (await this.database.query<Array<{ overlay_count: bigint; conflict_count: bigint }>>("SELECT COUNT(*) overlay_count,COALESCE(SUM(BINARY r.display_name<>BINARY o.target_display_name OR JSON_UNQUOTE(JSON_EXTRACT(r.metadata_json,'$.definitionCode')) IS NULL),0) conflict_count FROM object_source_bindings b JOIN object_registry r ON r.id=b.object_id JOIN asset_package_reward_target_occurrences o ON o.catalog_id=? AND o.global_source_order=CAST(SUBSTRING_INDEX(b.source_key,'#',-1) AS UNSIGNED) WHERE b.object_type='ITEM' AND b.source_system='RUNTIME_DB' AND b.source_table='asset_package_reward_target_occurrences' AND b.source_key LIKE ?", [catalog.id, `${PACKAGE_VERSION}#%`]))[0] ?? { overlay_count: 0n, conflict_count: 0n };
    const gaps = await this.database.query<Array<{ global_source_order: number; target_type: string; target_display_name: string; resolution_status: string }>>("SELECT o.global_source_order,o.target_type,o.target_display_name,o.resolution_status FROM asset_package_reward_target_occurrences o LEFT JOIN object_source_bindings b ON b.object_type='ITEM' AND b.source_system='RUNTIME_DB' AND b.source_table='asset_package_reward_target_occurrences' AND b.source_key=CONCAT(?, '#', o.global_source_order) WHERE o.catalog_id=? AND ((o.target_type='STACK' AND o.resolution_status='GAP' AND b.object_id IS NULL) OR (o.target_type='PACKAGE' AND o.resolution_status='SOURCE_RESOLVED_CANONICAL_GAP')) ORDER BY o.target_type,o.global_source_order LIMIT 80", [PACKAGE_VERSION, catalog.id]);
    const frozenResolved = Number(stats.frozen_resolved);
    const frozenStackGaps = Number(stats.frozen_stack_gaps);
    const overlayResolved = Number(overlay.overlay_count);
    return { catalogVersion: catalog.catalog_version, publicationStatus: catalog.publication_status, packageCount: Number(catalog.package_count), rewardCount: Number(catalog.reward_count), frozenResolved, overlayResolved, effectiveResolved: frozenResolved + overlayResolved, residualStackGaps: frozenStackGaps - overlayResolved, residualPackageGaps: Number(stats.package_gaps), conflicts: Number(overlay.conflict_count), gaps: gaps.map((row) => ({ sourceOrder: row.global_source_order, targetType: row.target_type, displayName: row.target_display_name, resolutionStatus: row.resolution_status })) };
  }
}
