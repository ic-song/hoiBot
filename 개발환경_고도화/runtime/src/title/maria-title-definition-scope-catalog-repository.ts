import type { DatabaseClient } from "../database.js";
import type {
  CanonicalTitleDefinition,
  TitleDefinitionCatalog,
  TitleDefinitionCatalogFilter,
  TitleDefinitionIdentity,
  TitleDefinitionLifecycle,
  TitleDefinitionScopeCatalogRepository,
} from "./title-definition-scope-catalog.js";

interface CatalogHeaderRow {
  id: bigint;
  catalog_code: string;
  catalog_version: number;
  publish_state: "PUBLISHED";
  source_hash: string;
  entry_count: number;
}

interface DefinitionRow {
  legacy_title_definition_id: bigint;
  source_system: "RUNTIME_DB";
  source_table: "title_definitions";
  source_scope: string;
  stable_code: string;
  definition_version: number;
  lifecycle_code: TitleDefinitionLifecycle;
  normalized_asset_scope: string;
  display_name: string;
  active_snapshot: number | boolean;
  metadata_json: string;
}

function mapDefinition(row: DefinitionRow): CanonicalTitleDefinition {
  return {
    legacyTitleDefinitionId: BigInt(row.legacy_title_definition_id),
    sourceSystem: row.source_system,
    sourceTable: row.source_table,
    sourceScope: row.source_scope,
    stableCode: row.stable_code,
    definitionVersion: Number(row.definition_version),
    lifecycle: row.lifecycle_code,
    normalizedAssetScope: row.normalized_asset_scope,
    displayName: row.display_name,
    active: Boolean(row.active_snapshot),
    metadataJson: row.metadata_json,
  };
}

export class MariaTitleDefinitionScopeCatalogRepository implements TitleDefinitionScopeCatalogRepository {
  public constructor(private readonly database: DatabaseClient) {}

  private async findHeader(catalogCode: string): Promise<CatalogHeaderRow | undefined> {
    const rows = await this.database.query<CatalogHeaderRow[]>(
      `SELECT id,catalog_code,catalog_version,publish_state,source_hash,entry_count
       FROM title_definition_catalog_versions
       WHERE catalog_code=? AND publish_state='PUBLISHED'
       ORDER BY catalog_version DESC LIMIT 1`,
      [catalogCode],
    );
    return rows[0];
  }

  // Published version의 정의를 identity 순서와 optional canonical scope 조건으로 조회합니다.
  public async findPublished(
    catalogCode: string,
    filter: TitleDefinitionCatalogFilter = {},
  ): Promise<TitleDefinitionCatalog | undefined> {
    const header = await this.findHeader(catalogCode);
    if (!header) return undefined;
    const conditions = ["catalog_version_id=?"];
    const parameters: unknown[] = [header.id];
    if (filter.normalizedAssetScope) {
      conditions.push("normalized_asset_scope=?");
      parameters.push(filter.normalizedAssetScope);
    }
    if (filter.lifecycle) {
      conditions.push("lifecycle_code=?");
      parameters.push(filter.lifecycle);
    }
    const rows = await this.database.query<DefinitionRow[]>(
      `SELECT legacy_title_definition_id,source_system,source_table,source_scope,stable_code,
              definition_version,lifecycle_code,normalized_asset_scope,display_name,active_snapshot,
              CAST(metadata_json AS CHAR) metadata_json
       FROM title_definition_catalog_entries
       WHERE ${conditions.join(" AND ")}
       ORDER BY BINARY source_scope,BINARY stable_code,definition_version,lifecycle_code`,
      parameters,
    );
    return {
      catalogCode: header.catalog_code,
      catalogVersion: Number(header.catalog_version),
      publishState: header.publish_state,
      sourceHash: header.source_hash,
      entryCount: Number(header.entry_count),
      definitions: rows.map(mapDefinition),
    };
  }

  // source scope를 포함한 composite identity 전체가 일치하는 published 정의만 반환합니다.
  public async findPublishedDefinition(
    catalogCode: string,
    identity: TitleDefinitionIdentity,
  ): Promise<CanonicalTitleDefinition | undefined> {
    const header = await this.findHeader(catalogCode);
    if (!header) return undefined;
    const rows = await this.database.query<DefinitionRow[]>(
      `SELECT legacy_title_definition_id,source_system,source_table,source_scope,stable_code,
              definition_version,lifecycle_code,normalized_asset_scope,display_name,active_snapshot,
              CAST(metadata_json AS CHAR) metadata_json
       FROM title_definition_catalog_entries
       WHERE catalog_version_id=? AND source_scope=? AND stable_code=?
         AND definition_version=? AND lifecycle_code=?
       LIMIT 1`,
      [header.id, identity.sourceScope, identity.stableCode, identity.definitionVersion, identity.lifecycle],
    );
    return rows[0] ? mapDefinition(rows[0]) : undefined;
  }
}
