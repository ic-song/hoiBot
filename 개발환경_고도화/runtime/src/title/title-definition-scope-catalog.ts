export type TitleDefinitionLifecycle = "ACTIVE" | "RETIRED";

export interface TitleDefinitionIdentity {
  sourceScope: string;
  stableCode: string;
  definitionVersion: number;
  lifecycle: TitleDefinitionLifecycle;
}

export interface CanonicalTitleDefinition extends TitleDefinitionIdentity {
  legacyTitleDefinitionId: bigint;
  sourceSystem: "RUNTIME_DB";
  sourceTable: "title_definitions";
  normalizedAssetScope: string;
  displayName: string;
  active: boolean;
  metadataJson: string;
}

export interface TitleDefinitionCatalog {
  catalogCode: string;
  catalogVersion: number;
  publishState: "PUBLISHED";
  sourceHash: string;
  entryCount: number;
  definitions: readonly CanonicalTitleDefinition[];
}

export interface TitleDefinitionCatalogFilter {
  normalizedAssetScope?: string;
  lifecycle?: TitleDefinitionLifecycle;
}

export interface TitleDefinitionScopeCatalogRepository {
  findPublished(catalogCode: string, filter?: TitleDefinitionCatalogFilter): Promise<TitleDefinitionCatalog | undefined>;
  findPublishedDefinition(catalogCode: string, identity: TitleDefinitionIdentity): Promise<CanonicalTitleDefinition | undefined>;
}

// Legacy scope case와 separator 차이를 canonical asset scope로 정규화합니다.
export function normalizeTitleAssetScope(scope: string): string {
  const normalized = scope.trim().replace(/[\s-]+/g, "_").toUpperCase();
  return normalized === "MINIPET" ? "MINI_PET" : normalized;
}

export class TitleDefinitionScopeCatalogReadProvider {
  public constructor(private readonly repository: TitleDefinitionScopeCatalogRepository) {}

  // Published catalog를 normalized scope와 lifecycle 조건으로 읽습니다.
  public async readPublished(
    catalogCode = "TITLE_DEFINITION_SCOPE_LEGACY",
    filter: TitleDefinitionCatalogFilter = {},
  ): Promise<TitleDefinitionCatalog> {
    const normalizedFilter = filter.normalizedAssetScope
      ? { ...filter, normalizedAssetScope: normalizeTitleAssetScope(filter.normalizedAssetScope) }
      : filter;
    const catalog = await this.repository.findPublished(catalogCode, normalizedFilter);
    if (!catalog) throw new Error(`TITLE_DEFINITION_CATALOG_NOT_FOUND:${catalogCode}`);
    return catalog;
  }

  // 표시명이나 global code가 아닌 frozen composite identity 전체로 단일 정의를 읽습니다.
  public async readExact(
    identity: TitleDefinitionIdentity,
    catalogCode = "TITLE_DEFINITION_SCOPE_LEGACY",
  ): Promise<CanonicalTitleDefinition> {
    const definition = await this.repository.findPublishedDefinition(catalogCode, identity);
    if (!definition) {
      throw new Error(
        `TITLE_DEFINITION_NOT_FOUND:${identity.sourceScope}:${identity.stableCode}:${identity.definitionVersion}:${identity.lifecycle}`,
      );
    }
    return definition;
  }
}
