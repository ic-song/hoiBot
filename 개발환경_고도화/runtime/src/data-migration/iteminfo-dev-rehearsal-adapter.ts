import { createHash } from "node:crypto";
import { isLosslessNumber, parse as parseLossless } from "lossless-json";
import { calculateRawLandingBundleSha256, type RawLandingBundleManifest } from "./maria-raw-landing-repository.js";
import type { CommonStagingExtraction, CommonStagingExtractionManifest, CommonStagingRecordDirective } from "./common-staging-extractor.js";
import type { CatalogProjectionManifest } from "./catalog-projection-provider.js";

export interface ItemInfoRehearsalCounts {
  rootEntries: number;
  aliasLeaves: number;
  definitionOccurrences: number;
}

export interface ItemInfoRehearsalReconciliation extends ItemInfoRehearsalCounts {
  elementalDefinitions: number;
  ringDefinitions: number;
  raidDefinitions: number;
  territoryDefinitions: number;
  castleDefinitions: number;
  projectedOccurrences: number;
  quarantinedOccurrences: number;
  ignoredOccurrences: number;
}

export interface ItemInfoApprovalProvenance {
  format: "hoibot-iteminfo-approval-provenance-v1";
  catalogVersion: "SC-20260902-1";
  sourceContentSha256: string;
  adapterContractSha256: string;
  definitionOccurrenceCount: number;
  aliasReferenceCount: number;
  identityPolicy: "STRUCTURAL_POINTER_NOT_DISPLAY_NAME";
  projectionPolicy: "LEASE2549_DEV_REHEARSAL_GENERATED_LOCATOR";
  productionMigrationReuseAllowed: false;
}

export interface ItemInfoRehearsalArtifacts {
  rawManifest: RawLandingBundleManifest;
  stagingManifest: CommonStagingExtractionManifest;
  reconciliation: ItemInfoRehearsalReconciliation;
  approvalProvenance: ItemInfoApprovalProvenance;
  approvalProvenanceSha256: string;
}

const EXPECTED_COUNTS: ItemInfoRehearsalCounts = { rootEntries: 120, aliasLeaves: 124, definitionOccurrences: 131 };
const LOGICAL_SOURCE_NAME = "data/itemInfo.json";
const SOURCE_NAMESPACE = "itemInfo.json";
const ADAPTER_CONTRACT = "iteminfo-dev-rehearsal-adapter-v1|definition=grade-or-typed-leaf|alias=nameList-index|identity=exact-rfc6901-pointer";
const sha256 = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");

function stableJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  throw new Error("ITEMINFO_REHEARSAL_UNSUPPORTED_VALUE");
}

function pointerToken(value: string): string {
  return value.replace(/~/g, "~0").replace(/\//g, "~1");
}

function normalizeLosslessValue(value: unknown): unknown {
  if (isLosslessNumber(value)) return value.toString();
  if (Array.isArray(value)) return value.map(normalizeLosslessValue);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, normalizeLosslessValue(child)]));
  return value;
}

function asRecord(value: unknown, code: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

function definitionDirective(sourcePointer: string, recordDomain: "PET_EQUIPMENT" | "ITEM", recordKind: string): CommonStagingRecordDirective {
  return {
    sourcePointer,
    recordDomain,
    recordKind,
    projectionLocator: sourcePointer,
    projectionStatus: "PROJECT"
  };
}

// 표시명이 아닌 구조적 JSON Pointer로 itemInfo 정의 후보와 별칭 근거를 분리합니다.
export function buildItemInfoDevRehearsalArtifacts(
  payload: Buffer,
  actor: string,
  expectedCounts: ItemInfoRehearsalCounts = EXPECTED_COUNTS
): ItemInfoRehearsalArtifacts {
  let rootValue: unknown;
  try { rootValue = JSON.parse(payload.toString("utf8")); } catch { throw new Error("ITEMINFO_REHEARSAL_JSON_INVALID"); }
  const root = asRecord(rootValue, "ITEMINFO_REHEARSAL_ROOT_INVALID");
  const expectedCategories = ["elemental", "ring", "raidSpecialItem", "castlePremiumItem", "castleItem"];
  if (stableJson(Object.keys(root).sort()) !== stableJson([...expectedCategories].sort())) throw new Error("ITEMINFO_REHEARSAL_CATEGORY_SCOPE_MISMATCH");

  const records: CommonStagingRecordDirective[] = [];
  let aliasLeaves = 0;
  const definitionCounts = { elemental: 0, ring: 0, raid: 0, territory: 0, castle: 0 };

  for (const category of ["elemental", "ring"] as const) {
    const definitions = asRecord(root[category], "ITEMINFO_REHEARSAL_EQUIPMENT_SCOPE_INVALID");
    for (const [definitionKey, rawDefinition] of Object.entries(definitions)) {
      const definition = asRecord(rawDefinition, "ITEMINFO_REHEARSAL_EQUIPMENT_DEFINITION_INVALID");
      const names = definition.nameList;
      if (!Array.isArray(names) || names.length === 0 || names.some((name) => typeof name !== "string" || name.length === 0)) throw new Error("ITEMINFO_REHEARSAL_NAME_LIST_INVALID");
      aliasLeaves += names.length;
      const pointer = `/${category}/${pointerToken(definitionKey)}`;
      records.push(definitionDirective(pointer, "PET_EQUIPMENT", category === "elemental" ? "ELEMENTAL_DEFINITION" : "RING_DEFINITION"));
      definitionCounts[category] += 1;
    }
  }

  for (const [category, kind, countKey] of [
    ["raidSpecialItem", "RAID_ITEM_DEFINITION", "raid"],
    ["castlePremiumItem", "TERRITORY_ITEM_DEFINITION", "territory"]
  ] as const) {
    const groups = asRecord(root[category], "ITEMINFO_REHEARSAL_TYPED_GROUP_SCOPE_INVALID");
    for (const [groupKey, rawGroup] of Object.entries(groups)) {
      const group = asRecord(rawGroup, "ITEMINFO_REHEARSAL_TYPED_GROUP_INVALID");
      for (const [itemKey, item] of Object.entries(group)) {
        if (!/^item_(?:0|[1-9]\d*)$/.test(itemKey)) throw new Error("ITEMINFO_REHEARSAL_TYPED_ITEM_KEY_INVALID");
        asRecord(item, "ITEMINFO_REHEARSAL_TYPED_ITEM_INVALID");
        records.push(definitionDirective(`/${category}/${pointerToken(groupKey)}/${itemKey}`, "ITEM", kind));
        definitionCounts[countKey] += 1;
      }
    }
  }

  const castleItems = asRecord(root.castleItem, "ITEMINFO_REHEARSAL_CASTLE_SCOPE_INVALID");
  for (const [itemKey, item] of Object.entries(castleItems)) {
    asRecord(item, "ITEMINFO_REHEARSAL_CASTLE_ITEM_INVALID");
    records.push(definitionDirective(`/castleItem/${pointerToken(itemKey)}`, "ITEM", "CASTLE_ITEM_DEFINITION"));
    definitionCounts.castle += 1;
  }

  const rootEntries = expectedCategories.reduce((total, category) => total + Object.keys(asRecord(root[category], "ITEMINFO_REHEARSAL_CATEGORY_INVALID")).length, 0);
  const counts = { rootEntries, aliasLeaves, definitionOccurrences: records.length };
  if (stableJson(counts) !== stableJson(expectedCounts)) throw new Error(`ITEMINFO_REHEARSAL_COUNT_DRIFT:${stableJson(counts)}`);
  if (new Set(records.map((record) => record.sourcePointer)).size !== records.length) throw new Error("ITEMINFO_REHEARSAL_DUPLICATE_SOURCE_POINTER");

  const sourceContentSha256 = sha256(payload);
  const sourcePathSha256 = sha256(LOGICAL_SOURCE_NAME);
  const snapshotManifestSha256 = sha256(stableJson({ logicalSourceName: LOGICAL_SOURCE_NAME, sourcePathSha256, sourceContentSha256, size: payload.byteLength }));
  const entry = { pathSha256: sourcePathSha256, size: payload.byteLength, contentSha256: sourceContentSha256, storageName: `${sourcePathSha256}.bin` };
  const rawManifest: RawLandingBundleManifest = {
    format: "hoibot-raw-landing-bundle-v1",
    snapshotManifestSha256,
    fileCount: 1,
    totalBytes: payload.byteLength,
    bundleSha256: calculateRawLandingBundleSha256([entry]),
    entries: [entry]
  };
  const stagingManifest: CommonStagingExtractionManifest = {
    format: "hoibot-common-staging-extraction-manifest-v1",
    rawBundleSha256: rawManifest.bundleSha256,
    snapshotManifestSha256,
    actor,
    entries: [{ sourcePathSha256, sourceContentSha256, logicalSourceName: LOGICAL_SOURCE_NAME, sourceNamespace: SOURCE_NAMESPACE, disposition: "PROJECT", records }]
  };
  const approvalProvenance: ItemInfoApprovalProvenance = {
    format: "hoibot-iteminfo-approval-provenance-v1",
    catalogVersion: "SC-20260902-1",
    sourceContentSha256,
    adapterContractSha256: sha256(ADAPTER_CONTRACT),
    definitionOccurrenceCount: records.length,
    aliasReferenceCount: aliasLeaves,
    identityPolicy: "STRUCTURAL_POINTER_NOT_DISPLAY_NAME",
    projectionPolicy: "LEASE2549_DEV_REHEARSAL_GENERATED_LOCATOR",
    productionMigrationReuseAllowed: false
  };
  return {
    rawManifest,
    stagingManifest,
    reconciliation: {
      ...counts,
      elementalDefinitions: definitionCounts.elemental,
      ringDefinitions: definitionCounts.ring,
      raidDefinitions: definitionCounts.raid,
      territoryDefinitions: definitionCounts.territory,
      castleDefinitions: definitionCounts.castle,
      projectedOccurrences: records.length,
      quarantinedOccurrences: 0,
      ignoredOccurrences: 0
    },
    approvalProvenance,
    approvalProvenanceSha256: sha256(stableJson(approvalProvenance))
  };
}

// Lease2549 비운영 범위에서 안전한 ITEM 행만 투영하고 손실성 장비 정의는 격리합니다.
export function buildItemInfoDevCatalogProjectionManifest(
  artifacts: ItemInfoRehearsalArtifacts,
  extraction: CommonStagingExtraction,
  commonStagingRunId: string,
  targetSchemaSha256: string,
  actor: string
): CatalogProjectionManifest {
  if (extraction.records.length !== artifacts.reconciliation.definitionOccurrences) throw new Error("ITEMINFO_REHEARSAL_EXTRACTION_COUNT_MISMATCH");
  const approvalSha256 = artifacts.approvalProvenanceSha256;
  return {
    format: "hoibot-catalog-projection-manifest-v1",
    catalogVersion: "SC-20260902-1",
    commonStagingRunId,
    commonStagingSha256: extraction.stagingSha256,
    commonStagingEnvelope: {
      rawBundleSha256: artifacts.rawManifest.bundleSha256,
      snapshotManifestSha256: artifacts.rawManifest.snapshotManifestSha256,
      extractionManifestSha256: extraction.extractionManifestSha256,
      expectedFileCount: 1,
      expectedTotalBytes: String(artifacts.rawManifest.totalBytes),
      projectedFileCount: 1,
      ignoredFileCount: 0
    },
    targetSchemaSha256,
    actor,
    sources: extraction.records.map((record) => {
      if (record.recordDomain !== "ITEM") {
        return {
          sourceLocatorSha256: record.sourceLocatorSha256,
          sourcePayloadFingerprint: record.payloadFingerprint,
          recordDomain: record.recordDomain,
          decisionStatus: "QUARANTINE" as const,
          decisionReason: "SOURCE_SHAPE_MISMATCH",
          outputs: []
        };
      }
      const payload = normalizeLosslessValue(parseLossless(record.payloadJson)) as Record<string, unknown>;
      if (typeof payload.name !== "string" || payload.name.length === 0) throw new Error("ITEMINFO_REHEARSAL_ITEM_NAME_INVALID");
      const itemKind = record.recordKind === "RAID_ITEM_DEFINITION" ? "RAID_SPECIAL" : record.recordKind === "TERRITORY_ITEM_DEFINITION" ? "TERRITORY_TICKET" : "CASTLE_UNIT";
      return {
        sourceLocatorSha256: record.sourceLocatorSha256,
        sourcePayloadFingerprint: record.payloadFingerprint,
        recordDomain: record.recordDomain,
        decisionStatus: "PROJECT" as const,
        outputs: [{
          projectionLocator: record.sourcePointer,
          identityMode: "GENERATED" as const,
          targetTable: "canonical_item_definitions",
          targetPkColumn: "item_id",
          targetObjectType: "CANONICAL_ITEM_DEFINITIONS",
          targetSourceNamespace: "object-import.item.canonical_item_definitions",
          payload: {
            item_name: payload.name,
            item_description: null,
            item_kind: itemKind,
            item_grade: null,
            price_amount: null,
            price_currency_source_identifier: null,
            stackable_flag: true,
            active_flag: true,
            definition_options: payload
          },
          valueOrigins: {
            item_name: "SOURCE_EXACT" as const,
            item_description: "SOURCE_ABSENT" as const,
            item_kind: "APPROVED_CATALOG" as const,
            item_grade: "SOURCE_ABSENT" as const,
            price_amount: "SOURCE_ABSENT" as const,
            price_currency_source_identifier: "SOURCE_ABSENT" as const,
            stackable_flag: "APPROVED_CATALOG" as const,
            active_flag: "APPROVED_CATALOG" as const,
            definition_options: "SOURCE_EXACT" as const
          },
          sourceBindings: {
            item_name: "/name",
            item_description: "/item_description",
            item_grade: "/item_grade",
            price_amount: "/price_amount",
            price_currency_source_identifier: "/price_currency_source_identifier",
            definition_options: ""
          },
          referenceBindings: [],
          approvalKind: "CATALOG_PROVENANCE" as const,
          approvalSha256
        }]
      };
    })
  };
}
