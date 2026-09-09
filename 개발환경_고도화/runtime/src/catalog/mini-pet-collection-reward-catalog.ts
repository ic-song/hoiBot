import type { DatabaseClient } from "../database.js";

export type MiniPetCollectionRewardScope = "GRADE" | "STAGE";
export type MiniPetCollectionTitleResolution = "NOT_APPLICABLE" | "RESOLVED" | "UNRESOLVED" | "CONFLICT";

export interface MiniPetCollectionRewardOccurrence {
  globalSourceOrder: number;
  sourceScope: MiniPetCollectionRewardScope;
  sourceKey: string;
  sourceOrder: number;
  rawItemDisplayName: string;
  quantity: string;
  titleDisplayName: string | null;
  titlePrice: string | null;
  canonicalTitleId: string | null;
  titleResolution: MiniPetCollectionTitleResolution;
  displayIdentityHash: string;
}

export interface MiniPetCollectionRewardCatalog {
  catalogVersion: string;
  sourcePath: string;
  sourceSha256: string;
  publicationStatus: "SHADOW" | "PUBLISHED" | "RETIRED";
  rewardTarget: {
    itemId: string;
    objectId: string;
    itemCode: string;
    objectKey: string;
    displayName: string;
    ownershipModel: "STACK";
  };
  occurrences: MiniPetCollectionRewardOccurrence[];
}

interface CatalogRow {
  id: bigint;
  catalog_version: string;
  source_path: string;
  source_sha256: string;
  grade_reward_count: number | bigint;
  stage_reward_count: number | bigint;
  title_definition_count: number | bigint;
  reward_item_id: bigint;
  reward_item_object_id: bigint;
  reward_item_code: string;
  reward_item_object_key: string;
  reward_item_display_name: string;
  ownership_model: "STACK";
  publication_status: MiniPetCollectionRewardCatalog["publicationStatus"];
}

interface OccurrenceRow {
  global_source_order: number | bigint;
  source_scope: MiniPetCollectionRewardScope;
  source_key: string;
  source_order: number | bigint;
  raw_item_display_name: string;
  quantity: bigint | string | number;
  title_display_name: string | null;
  title_price: bigint | string | number | null;
  canonical_title_id: bigint | null;
  title_resolution: MiniPetCollectionTitleResolution;
  display_identity_hash: string;
}

// 동결된 미니펫 컬렉션 등급·단계 보상과 안정적으로 연결된 자산을 순서대로 조회합니다.
export class MariaMiniPetCollectionRewardCatalogProvider {
  constructor(private readonly database: Pick<DatabaseClient, "query">) {}

  async readCatalog(catalogVersion: string): Promise<MiniPetCollectionRewardCatalog | null> {
    const catalogs = await this.database.query<CatalogRow[]>(
      `SELECT id,catalog_version,source_path,source_sha256,grade_reward_count,stage_reward_count,title_definition_count,
              reward_item_id,reward_item_object_id,reward_item_code,reward_item_object_key,reward_item_display_name,
              ownership_model,publication_status
         FROM mini_pet_collection_reward_catalogs
        WHERE catalog_version=?`,
      [catalogVersion]
    );
    const catalog = catalogs[0];
    if (catalog === undefined) return null;
    if (catalogs.length !== 1) throw new Error("MINI_PET_COLLECTION_REWARD_CATALOG_AMBIGUOUS");

    const rows = await this.database.query<OccurrenceRow[]>(
      `SELECT global_source_order,source_scope,source_key,source_order,raw_item_display_name,quantity,
              title_display_name,title_price,canonical_title_id,title_resolution,display_identity_hash
         FROM mini_pet_collection_reward_occurrences
        WHERE reward_catalog_id=?
        ORDER BY global_source_order`,
      [catalog.id]
    );
    const occurrences = rows.map((row, offset) => ({
      globalSourceOrder: Number(row.global_source_order),
      sourceScope: row.source_scope,
      sourceKey: row.source_key,
      sourceOrder: Number(row.source_order),
      rawItemDisplayName: row.raw_item_display_name,
      quantity: String(row.quantity),
      titleDisplayName: row.title_display_name,
      titlePrice: row.title_price === null ? null : String(row.title_price),
      canonicalTitleId: row.canonical_title_id === null ? null : String(row.canonical_title_id),
      titleResolution: row.title_resolution,
      displayIdentityHash: row.display_identity_hash
    }));
    this.assertParity(catalog, occurrences);
    return {
      catalogVersion: catalog.catalog_version,
      sourcePath: catalog.source_path,
      sourceSha256: catalog.source_sha256,
      publicationStatus: catalog.publication_status,
      rewardTarget: {
        itemId: String(catalog.reward_item_id),
        objectId: String(catalog.reward_item_object_id),
        itemCode: catalog.reward_item_code,
        objectKey: catalog.reward_item_object_key,
        displayName: catalog.reward_item_display_name,
        ownershipModel: catalog.ownership_model
      },
      occurrences
    };
  }

  private assertParity(catalog: CatalogRow, occurrences: MiniPetCollectionRewardOccurrence[]): void {
    if (occurrences.length !== 108 || Number(catalog.grade_reward_count) !== 8 || Number(catalog.stage_reward_count) !== 100 || Number(catalog.title_definition_count) !== 100) {
      throw new Error("MINI_PET_COLLECTION_REWARD_COUNT_MISMATCH");
    }
    const grade = occurrences.filter((row) => row.sourceScope === "GRADE");
    const stage = occurrences.filter((row) => row.sourceScope === "STAGE");
    if (grade.length !== 8 || stage.length !== 100) throw new Error("MINI_PET_COLLECTION_REWARD_SCOPE_MISMATCH");
    for (let index = 0; index < occurrences.length; index++) {
      if (occurrences[index]!.globalSourceOrder !== index + 1) throw new Error("MINI_PET_COLLECTION_REWARD_GLOBAL_ORDER_GAP");
    }
    for (const rows of [grade, stage]) {
      for (let index = 0; index < rows.length; index++) {
        if (rows[index]!.sourceOrder !== index + 1) throw new Error("MINI_PET_COLLECTION_REWARD_SCOPE_ORDER_GAP");
      }
    }
    if (grade.some((row) => row.titleResolution !== "NOT_APPLICABLE" || row.canonicalTitleId !== null) ||
        stage.some((row) => row.titleResolution === "NOT_APPLICABLE" || row.titleDisplayName === null || row.titlePrice === null)) {
      throw new Error("MINI_PET_COLLECTION_REWARD_TITLE_BINDING_MISMATCH");
    }
  }
}
