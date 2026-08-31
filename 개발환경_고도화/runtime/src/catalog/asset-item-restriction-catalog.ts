import type { DatabaseClient } from "../database.js";

export type AssetItemRestrictionKind = "non_item" | "untradable";

export interface AssetItemRestrictionOccurrence {
  sourceOrder: number;
  definitionHash: string;
  rawValue: string;
  canonicalItemId: string | null;
}

export interface AssetItemRestrictionPolicy {
  catalogVersion: string;
  restrictionKind: AssetItemRestrictionKind;
  sourcePath: string;
  sourceKey: string;
  sourceSha256: string;
  sourceRowCount: number;
  sourceUniqueCount: number;
  publicationStatus: "SHADOW" | "PUBLISHED" | "RETIRED";
  occurrences: AssetItemRestrictionOccurrence[];
}

interface SetRow {
  id: bigint;
  catalog_version: string;
  restriction_kind: AssetItemRestrictionKind;
  source_path: string;
  source_key: string;
  source_sha256: string;
  source_row_count: number | bigint;
  source_unique_count: number | bigint;
  publication_status: AssetItemRestrictionPolicy["publicationStatus"];
}

interface OccurrenceRow {
  source_order: number | bigint;
  definition_hash: string;
  raw_value: string;
  canonical_item_id: bigint | null;
}

// 버전과 제한 종류로 동결된 ordered occurrence 정책을 조회합니다.
export class MariaAssetItemRestrictionCatalogProvider {
  constructor(private readonly database: Pick<DatabaseClient, "query">) {}

  async readPolicy(catalogVersion: string, restrictionKind: AssetItemRestrictionKind): Promise<AssetItemRestrictionPolicy | null> {
    const sets = await this.database.query<SetRow[]>(
      `SELECT id,catalog_version,restriction_kind,source_path,source_key,source_sha256,
              source_row_count,source_unique_count,publication_status
         FROM asset_item_restriction_sets
        WHERE catalog_version=? AND restriction_kind=?`,
      [catalogVersion, restrictionKind]
    );
    const set = sets[0];
    if (set === undefined) return null;
    if (sets.length !== 1) throw new Error("ASSET_ITEM_RESTRICTION_SET_AMBIGUOUS");

    const rows = await this.database.query<OccurrenceRow[]>(
      `SELECT occurrence.source_order,definition_row.definition_hash,occurrence.raw_value,
              definition_row.canonical_item_id
         FROM asset_item_restriction_occurrences occurrence
         JOIN asset_item_restriction_definitions definition_row
           ON definition_row.id=occurrence.restriction_definition_id
          AND definition_row.restriction_set_id=occurrence.restriction_set_id
        WHERE occurrence.restriction_set_id=?
        ORDER BY occurrence.source_order`,
      [set.id]
    );
    const occurrences = rows.map((row, offset) => {
      const sourceOrder = Number(row.source_order);
      if (sourceOrder !== offset + 1) throw new Error(`ASSET_ITEM_RESTRICTION_ORDER_GAP:${sourceOrder}:${offset + 1}`);
      return {
        sourceOrder,
        definitionHash: row.definition_hash,
        rawValue: row.raw_value,
        canonicalItemId: row.canonical_item_id === null ? null : String(row.canonical_item_id)
      };
    });
    const sourceRowCount = Number(set.source_row_count);
    const sourceUniqueCount = Number(set.source_unique_count);
    if (occurrences.length !== sourceRowCount || new Set(occurrences.map((row) => row.definitionHash)).size !== sourceUniqueCount) {
      throw new Error("ASSET_ITEM_RESTRICTION_POLICY_PARITY_MISMATCH");
    }
    return {
      catalogVersion: set.catalog_version,
      restrictionKind: set.restriction_kind,
      sourcePath: set.source_path,
      sourceKey: set.source_key,
      sourceSha256: set.source_sha256,
      sourceRowCount,
      sourceUniqueCount,
      publicationStatus: set.publication_status,
      occurrences
    };
  }
}
