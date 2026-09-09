import { createHash } from "node:crypto";
import type { PrivateAssetReferenceGapCrosswalk, PrivateAssetReferenceGapEntry } from "./asset-reference-validation.js";

export type AssetReferenceGapLane =
  | "LEGACY_BAG_ITEM"
  | "LEGACY_TITLE_OWNERSHIP"
  | "DOMAIN_INSTANCE_IDENTITY"
  | "CATALOG_COMPATIBILITY";

export interface AssetReferenceGapClassification {
  format: "hoibot-asset-reference-gap-classification-v1";
  catalogVersion: string;
  stagingSha256: string;
  canonicalSha256: string;
  privateCrosswalkContentSha256: string;
  gapIdentityCount: number;
  gapOccurrenceCount: number;
  lanes: Record<AssetReferenceGapLane, {
    downstreamSliceId: string;
    identityCount: number;
    occurrenceCount: number;
    breakdown: Array<{
      kind: PrivateAssetReferenceGapEntry["kind"];
      requestedType: string;
      sourceKind: string;
      identityCount: number;
      occurrenceCount: number;
    }>;
  }>;
}

const downstream: Record<AssetReferenceGapLane, string> = {
  LEGACY_BAG_ITEM: "SL-ASSET-LEGACY-BAG-ITEM-REFERENCE-CORRECTION-01",
  LEGACY_TITLE_OWNERSHIP: "SL-ASSET-LEGACY-TITLE-OWNERSHIP-CROSSWALK-01",
  DOMAIN_INSTANCE_IDENTITY: "SL-ASSET-DOMAIN-INSTANCE-REFERENCE-CORRECTION-01",
  CATALOG_COMPATIBILITY: "SL-ASSET-CATALOG-COMPATIBILITY-REFERENCE-CORRECTION-01"
};

function laneFor(requestedType: string): AssetReferenceGapLane {
  if (requestedType === "ITEM") return "LEGACY_BAG_ITEM";
  if (requestedType === "TITLE|MEMBER_TITLE|PET_TITLE") return "LEGACY_TITLE_OWNERSHIP";
  if (["FURNITURE", "MINI_PET", "SKILL", "PET"].includes(requestedType)) return "DOMAIN_INSTANCE_IDENTITY";
  return "CATALOG_COMPATIBILITY";
}

// 비공개 crosswalk에서 원문을 제거한 corrective lane 집계만 생성한다.
export function classifyPrivateAssetReferenceGaps(
  crosswalk: PrivateAssetReferenceGapCrosswalk
): AssetReferenceGapClassification {
  if (crosswalk.format !== "hoibot-private-asset-reference-gap-crosswalk-v1") throw new Error("PRIVATE_CROSSWALK_FORMAT_INVALID");
  const laneMaps = new Map<AssetReferenceGapLane, Map<string, {
    kind: PrivateAssetReferenceGapEntry["kind"];
    requestedType: string;
    sourceKind: string;
    identityCount: number;
    occurrenceCount: number;
  }>>();
  const laneTotals = new Map<AssetReferenceGapLane, { identityCount: number; occurrenceCount: number }>();

  for (const entry of crosswalk.entries) {
    const lane = laneFor(entry.requestedType);
    const totals = laneTotals.get(lane) ?? { identityCount: 0, occurrenceCount: 0 };
    totals.identityCount += 1;
    totals.occurrenceCount += entry.occurrenceCount;
    laneTotals.set(lane, totals);
    const breakdown = laneMaps.get(lane) ?? new Map();
    for (const [sourceKind, occurrenceCount] of Object.entries(entry.sourceKinds)) {
      const key = `${entry.kind}|${entry.requestedType}|${sourceKind}`;
      const current = breakdown.get(key) ?? {
        kind: entry.kind,
        requestedType: entry.requestedType,
        sourceKind,
        identityCount: 0,
        occurrenceCount: 0
      };
      current.identityCount += 1;
      current.occurrenceCount += occurrenceCount;
      breakdown.set(key, current);
    }
    laneMaps.set(lane, breakdown);
  }

  const laneNames = Object.keys(downstream) as AssetReferenceGapLane[];
  const lanes = Object.fromEntries(laneNames.map((lane) => {
    const totals = laneTotals.get(lane) ?? { identityCount: 0, occurrenceCount: 0 };
    const breakdown = [...(laneMaps.get(lane)?.values() ?? [])].sort((left, right) =>
      `${left.kind}|${left.requestedType}|${left.sourceKind}`.localeCompare(
        `${right.kind}|${right.requestedType}|${right.sourceKind}`,
        "en"
      )
    );
    return [lane, { downstreamSliceId: downstream[lane], ...totals, breakdown }];
  })) as AssetReferenceGapClassification["lanes"];

  const deterministicPrivate = JSON.stringify({ ...crosswalk, generatedAt: undefined });
  return {
    format: "hoibot-asset-reference-gap-classification-v1",
    catalogVersion: crosswalk.catalogVersion,
    stagingSha256: crosswalk.stagingSha256,
    canonicalSha256: crosswalk.canonicalSha256,
    privateCrosswalkContentSha256: createHash("sha256").update(deterministicPrivate).digest("hex"),
    gapIdentityCount: crosswalk.gapIdentityCount,
    gapOccurrenceCount: crosswalk.entries.reduce((sum, entry) => sum + entry.occurrenceCount, 0),
    lanes
  };
}
