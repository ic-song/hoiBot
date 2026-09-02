import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { StagingTransformManifest } from "./staging-transform.js";

export interface CanonicalAssetSource {
  sourceSystem: string;
  sourceTable: string;
  sourceKey: string;
}

export interface CanonicalAssetEntry {
  objectId: string;
  objectKey: string;
  objectType: string;
  displayName: string;
  active: boolean;
  metadata: Record<string, unknown>;
  sources: CanonicalAssetSource[];
}

export interface CanonicalAssetSnapshot {
  format: "hoibot-canonical-asset-reference-v1";
  catalogVersion: string;
  generatedAt: string;
  entries: CanonicalAssetEntry[];
}

interface AssetReference {
  sourceKind: string;
  sourcePathSha256: string;
  requestedTypes: string[];
  exactKey?: string;
  displayName?: string;
  grade?: string;
  visual?: string;
  metric?: string;
  locationHash: string;
}

export interface AssetReferenceIssue {
  kind: "ORPHAN" | "AMBIGUOUS" | "INACTIVE";
  requestedType: string;
  identityHash: string;
  locationHash: string;
}

export interface AssetReferenceValidationReport {
  format: "hoibot-asset-reference-validation-v1";
  catalogVersion: string;
  stagingCatalogVersion: string;
  stagingSha256: string;
  canonicalSha256: string;
  generatedAt: string;
  payloadFileCount: number;
  referenceCount: number;
  distinctReferenceCount: number;
  resolvedCount: number;
  orphanCount: number;
  ambiguousCount: number;
  inactiveCount: number;
  canonicalDuplicateCount: number;
  canonicalCollisionCount: number;
  referenceCountsByType: Record<string, number>;
  issues: AssetReferenceIssue[];
  reportSha256: string;
  dataMigrationReady: boolean;
}

export interface PrivateAssetReferenceGapEntry {
  kind: "ORPHAN" | "AMBIGUOUS" | "INACTIVE";
  requestedType: string;
  exactKey?: string;
  displayName?: string;
  grade?: string;
  visual?: string;
  metric?: string;
  sourceKinds: Record<string, number>;
  sourceFileCount: number;
  occurrenceCount: number;
  candidateCount: number;
  candidates: Array<{
    objectId: string;
    objectKey: string;
    objectType: string;
    displayName: string;
    active: boolean;
    sources: CanonicalAssetSource[];
  }>;
}

export interface PrivateAssetReferenceGapCrosswalk {
  format: "hoibot-private-asset-reference-gap-crosswalk-v1";
  catalogVersion: string;
  stagingSha256: string;
  canonicalSha256: string;
  generatedAt: string;
  payloadFileCount: number;
  distinctReferenceCount: number;
  gapIdentityCount: number;
  entries: PrivateAssetReferenceGapEntry[];
}

interface PrivateStagingEnvelope {
  sourcePathSha256: string;
  sourceContentSha256: string;
  decision: string;
  format: string;
  payload: unknown;
}

const STABLE_CODE = /^(?:ITEM|PET|MINI[_-]?PET|FURNITURE|BADGE|TITLE|MEMBER[_-]?TITLE|PET[_-]?TITLE|PASS|PACKAGE|CURRENCY|SKILL|PET[_-]?SKILL|PENDANT|HOME[_-]?BUILDING|GUILD[_-]?RESOURCE)[-_.:][A-Z0-9][A-Z0-9_.:-]*$/i;
const LEGACY_PET_INTIMACY_PROJECTION = /^펫 친밀도🐾\s*\[Lv\.\d+\]\(\d+\/1000\)\+\d+💕$/;

// 레거시 가방에서 정의가 아니라 현재 상태를 이름에 합성한 projection인지 판별한다.
export function isLegacyDynamicBagProjection(value: string): boolean {
  return LEGACY_PET_INTIMACY_PROJECTION.test(value);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function miniPetStatSignature(row: Record<string, unknown>): string | undefined {
  const battle = row.battleExp;
  const castle = row.castleExp;
  const raid = row.raidExp;
  if (battle === undefined || castle === undefined || raid === undefined) return undefined;
  return `battle:${String(battle)}|castle:${String(castle)}|raid:${String(raid)}`;
}

function addReference(
  output: AssetReference[],
  sourcePathSha256: string,
  pointer: string,
  requestedTypes: string[],
  values: Pick<AssetReference, "sourceKind" | "exactKey" | "displayName" | "grade" | "visual" | "metric">
): void {
  if (!values.exactKey && !values.displayName) return;
  output.push({
    sourcePathSha256,
    requestedTypes,
    ...values,
    locationHash: sha256(`${sourcePathSha256}|${pointer}`)
  });
}

function objectEntries(value: unknown): Array<[string, unknown]> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.entries(value as Record<string, unknown>)
    : [];
}

function stableCodeTypes(value: string): string[] {
  const prefix = value.split(/[-_.:]/, 1)[0]!.toUpperCase();
  if (/^package_/i.test(value)) return ["PACKAGE_DEFINITION"];
  if (prefix === "MEMBER" || prefix === "TITLE" || (prefix === "PET" && /TITLE/i.test(value))) return ["TITLE", "MEMBER_TITLE", "PET_TITLE"];
  if ((prefix === "PET" && /SKILL/i.test(value)) || prefix === "SKILL") return ["SKILL"];
  if (prefix === "MINI") return ["MINI_PET"];
  if (prefix === "HOME") return ["HOME_BUILDING"];
  if (prefix === "GUILD") return ["GUILD_RESOURCE"];
  return [prefix];
}

// 개인 식별 경로를 노출하지 않고 승인된 자산 필드에서 참조 후보만 추출한다.
function collectAssetReferences(
  value: unknown,
  sourcePathSha256: string,
  pointer: string,
  output: AssetReference[],
  depth = 0
): void {
  if (depth > 16 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      collectAssetReferences(entry, sourcePathSha256, `${pointer}/[]${index}`, output, depth + 1)
    );
    return;
  }
  if (typeof value !== "object") return;

  const record = value as Record<string, unknown>;
  const packageId = stringValue(record.packageId);
  const packageName = stringValue(record.packageName);
  if (packageId || packageName) {
    addReference(output, sourcePathSha256, `${pointer}/package`, ["PACKAGE_DEFINITION"], {
      sourceKind: "package",
      exactKey: packageId,
      displayName: packageName
    });
  }

  for (const [key, child] of Object.entries(record)) {
    const childPointer = `${pointer}/${sha256(key).slice(0, 16)}`;
    if (key === "packageId" || key === "packageName") continue;
    if (key === "bag" && child && typeof child === "object" && !Array.isArray(child)) {
      for (const itemName of Object.keys(child as Record<string, unknown>)) {
        if (isLegacyDynamicBagProjection(itemName)) continue;
        addReference(output, sourcePathSha256, `${childPointer}/${sha256(itemName)}`, ["ITEM"], {
          sourceKind: "bag",
          displayName: itemName
        });
      }
    } else if (key === "furnitureBag" && Array.isArray(child)) {
      child.forEach((entry, index) => {
        const row = entry && typeof entry === "object" && !Array.isArray(entry)
          ? entry as Record<string, unknown>
          : {};
        addReference(output, sourcePathSha256, `${childPointer}/${index}`, ["FURNITURE"], {
          sourceKind: "furnitureBag",
          exactKey: stringValue(row.code) ?? stringValue(row.objectKey),
          displayName: stringValue(row.name) ?? stringValue(row.display),
          grade: stringValue(row.grade),
          visual: stringValue(row.emoji),
          metric: row.exp === undefined ? undefined : String(row.exp)
        });
      });
    } else if (key === "miniPetBag" && Array.isArray(child)) {
      child.forEach((entry, index) => {
        const row = entry && typeof entry === "object" && !Array.isArray(entry)
          ? entry as Record<string, unknown>
          : {};
        addReference(output, sourcePathSha256, `${childPointer}/${index}`, ["MINI_PET"], {
          sourceKind: "miniPetBag",
          exactKey: stringValue(row.code) ?? stringValue(row.objectKey),
          displayName: stringValue(row.name),
          grade: stringValue(row.grade),
          visual: stringValue(row.emoji) ?? stringValue(row.display),
          metric: miniPetStatSignature(row)
        });
      });
    } else if (key === "pendantBag" && Array.isArray(child)) {
      child.forEach((entry, index) => {
        const row = entry && typeof entry === "object" && !Array.isArray(entry)
          ? entry as Record<string, unknown>
          : {};
        addReference(output, sourcePathSha256, `${childPointer}/${index}`, ["ITEM"], {
          sourceKind: "pendantBag",
          exactKey: stringValue(row.code) ?? stringValue(row.objectKey),
          displayName: stringValue(row.name),
          grade: stringValue(row.grade),
          visual: stringValue(row.icon)
        });
      });
    } else if ((key === "badges" || key === "deletedBadgeIds") && Array.isArray(child)) {
      child.forEach((entry, index) => {
        const exactKey = stringValue(entry);
        addReference(output, sourcePathSha256, `${childPointer}/${index}`, ["BADGE"], {
          sourceKind: key,
          exactKey,
          displayName: exactKey
        });
      });
    } else if (key === "title" || key === "petTitle") {
      const state = child && typeof child === "object" && !Array.isArray(child)
        ? child as Record<string, unknown>
        : {};
      const rows = Array.isArray(state.list) ? state.list : [];
      rows.forEach((entry, index) => {
        const row = entry && typeof entry === "object" && !Array.isArray(entry)
          ? entry as Record<string, unknown>
          : {};
        const identity = stringValue(row.code) ?? stringValue(row.objectKey) ?? stringValue(row.name);
        addReference(output, sourcePathSha256, `${childPointer}/list/${index}`, ["TITLE", "MEMBER_TITLE", "PET_TITLE"], {
          sourceKind: key,
          exactKey: identity && STABLE_CODE.test(identity) ? identity : undefined,
          displayName: stringValue(row.name) ?? identity
        });
      });
    } else if (key === "petSkills") {
      const state = child && typeof child === "object" && !Array.isArray(child)
        ? child as Record<string, unknown>
        : {};
      const bag = state.bag && typeof state.bag === "object" && !Array.isArray(state.bag)
        ? state.bag as Record<string, unknown>
        : {};
      for (const identity of Object.keys(bag)) {
        addReference(output, sourcePathSha256, `${childPointer}/bag/${sha256(identity)}`, ["SKILL"], {
          sourceKind: "petSkills.bag",
          exactKey: STABLE_CODE.test(identity) ? identity : undefined,
          displayName: identity
        });
      }
      for (const collectionKey of ["equipped", "lockedPremium"] as const) {
        const collection = Array.isArray(state[collectionKey]) ? state[collectionKey] as unknown[] : [];
        collection.forEach((entry, index) => {
          const identity = stringValue(entry);
          addReference(output, sourcePathSha256, `${childPointer}/${collectionKey}/${index}`, ["SKILL"], {
            sourceKind: `petSkills.${collectionKey}`,
            exactKey: identity && STABLE_CODE.test(identity) ? identity : undefined,
            displayName: identity
          });
        });
      }
    } else if (["badgeId", "equippedBadgeId"].includes(key)) {
      const identity = stringValue(child);
      addReference(output, sourcePathSha256, childPointer, ["BADGE"], {
        sourceKind: key,
        exactKey: identity,
        displayName: identity
      });
    } else if (["item", "itemName"].includes(key)) {
      const identity = stringValue(child);
      addReference(output, sourcePathSha256, childPointer, ["ITEM"], {
        sourceKind: key,
        exactKey: identity && STABLE_CODE.test(identity) ? identity : undefined,
        displayName: identity
      });
    } else if (key === "passType") {
      const identity = stringValue(child);
      addReference(output, sourcePathSha256, childPointer, ["PASS"], {
        sourceKind: key,
        exactKey: identity,
        displayName: identity
      });
    } else if (typeof child === "string" && STABLE_CODE.test(child) && /(?:id|code|key)$/i.test(key)) {
      addReference(output, sourcePathSha256, childPointer, stableCodeTypes(child), { sourceKind: "stableCode", exactKey: child });
    }
    if (!["title", "petTitle", "petSkills"].includes(key)) {
      collectAssetReferences(child, sourcePathSha256, childPointer, output, depth + 1);
    }
  }
}

function metadataStrings(value: unknown, output: Set<string>, depth = 0): void {
  if (depth > 5 || value === null || value === undefined) return;
  if (typeof value === "string") {
    output.add(value);
    return;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    output.add(String(value));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => metadataStrings(entry, output, depth + 1));
    return;
  }
  if (typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach((entry) => metadataStrings(entry, output, depth + 1));
  }
}

function resolveReference(reference: AssetReference, entries: CanonicalAssetEntry[]): CanonicalAssetEntry[] {
  let candidates = entries.filter(
    (entry) => reference.requestedTypes.length === 0 || reference.requestedTypes.includes(entry.objectType)
  );
  if (reference.exactKey) {
    const objectKeyMatches = candidates.filter((entry) => entry.objectKey === reference.exactKey);
    const sourceKeyMatches = candidates.filter((entry) =>
      entry.sources.some((source) => source.sourceKey === reference.exactKey)
    );
    const metadataMatches = candidates.filter((entry) => {
      const metadata = new Set<string>();
      metadataStrings(entry.metadata, metadata);
      return metadata.has(reference.exactKey!);
    });
    if (objectKeyMatches.length > 0) candidates = objectKeyMatches;
    else if (sourceKeyMatches.length > 0) candidates = sourceKeyMatches;
    else if (metadataMatches.length > 0) candidates = metadataMatches;
    else return [];
  }
  if (reference.displayName) {
    const display = candidates.filter(
      (entry) =>
        entry.displayName === reference.displayName ||
        entry.sources.some((source) => source.sourceKey === reference.displayName) ||
        (reference.visual !== undefined && (
          entry.displayName === `${reference.displayName}${reference.visual}` ||
          entry.displayName === `${reference.displayName} ${reference.visual}`
        ))
    );
    if (display.length > 0) candidates = display;
    else if (!reference.exactKey && !(reference.requestedTypes.includes("MINI_PET") && reference.metric)) return [];
  }
  for (const qualifier of [reference.grade, reference.visual].filter(Boolean) as string[]) {
    const narrowed = candidates.filter((entry) => {
      const metadata = new Set<string>();
      metadataStrings(entry.metadata, metadata);
      return metadata.has(qualifier);
    });
    if (narrowed.length > 0) candidates = narrowed;
  }
  if (reference.metric) {
    candidates = candidates.filter((entry) => {
      const metadata = new Set<string>();
      metadataStrings(entry.metadata, metadata);
      return metadata.has(reference.metric!);
    });
  }
  if (reference.requestedTypes.includes("FURNITURE") && candidates.length > 1) {
    const current = candidates.filter((entry) => entry.sources.some((source) => source.sourceTable.endsWith(".v2_438")));
    if (current.length > 0) candidates = current;
  }
  return [...new Map(candidates.map((entry) => [entry.objectId, entry])).values()];
}

function canonicalSnapshotHash(snapshot: CanonicalAssetSnapshot): string {
  const entries = snapshot.entries
    .map((entry) => ({
      ...entry,
      sources: [...entry.sources].sort((left, right) =>
        `${left.sourceSystem}|${left.sourceTable}|${left.sourceKey}`.localeCompare(
          `${right.sourceSystem}|${right.sourceTable}|${right.sourceKey}`,
          "en"
        )
      )
    }))
    .sort((left, right) => `${left.objectType}|${left.objectKey}`.localeCompare(`${right.objectType}|${right.objectKey}`, "en"));
  return sha256(canonicalJson(entries));
}

function referenceIdentity(reference: AssetReference): Record<string, unknown> {
  return {
    requestedTypes: reference.requestedTypes,
    exactKey: reference.exactKey,
    displayName: reference.displayName,
    grade: reference.grade,
    visual: reference.visual,
    metric: reference.metric
  };
}

async function loadAssetReferences(
  stagingRoot: string,
  stagingManifest: StagingTransformManifest
): Promise<{ references: AssetReference[]; payloadFileCount: number }> {
  const payloadDirectory = join(resolve(stagingRoot), stagingManifest.decisionSha256, "payload");
  const expectedEntries = stagingManifest.entries.filter((entry) => entry.stagingPayloadSha256 !== null);
  const payloadNames = (await readdir(payloadDirectory)).sort();
  if (payloadNames.length !== expectedEntries.length) throw new Error("STAGING_PAYLOAD_COUNT_MISMATCH");

  const references: AssetReference[] = [];
  for (const entry of expectedEntries) {
    const payloadName = `${entry.sourcePathSha256}.json`;
    if (!payloadNames.includes(payloadName)) throw new Error("STAGING_PAYLOAD_MISSING");
    const bytes = await readFile(join(payloadDirectory, payloadName));
    if (sha256(bytes) !== entry.stagingPayloadSha256) throw new Error("STAGING_PAYLOAD_HASH_MISMATCH");
    const envelope = JSON.parse(bytes.toString("utf8")) as PrivateStagingEnvelope;
    if (envelope.sourcePathSha256 !== entry.sourcePathSha256 || envelope.sourceContentSha256 !== entry.sourceContentSha256) {
      throw new Error("STAGING_ENVELOPE_IDENTITY_MISMATCH");
    }
    if (envelope.format === "JSON") collectAssetReferences(envelope.payload, entry.sourcePathSha256, "", references);
  }
  return { references, payloadFileCount: expectedEntries.length };
}

// 비공개 임시 경로에서만 사용하는 원문 identity와 canonical 후보 crosswalk를 만든다.
export async function buildPrivateAssetReferenceGapCrosswalk(
  stagingRoot: string,
  stagingManifest: StagingTransformManifest,
  canonicalSnapshot: CanonicalAssetSnapshot
): Promise<PrivateAssetReferenceGapCrosswalk> {
  if (canonicalSnapshot.format !== "hoibot-canonical-asset-reference-v1") throw new Error("CANONICAL_SNAPSHOT_FORMAT_INVALID");
  const { references, payloadFileCount } = await loadAssetReferences(stagingRoot, stagingManifest);
  const grouped = new Map<string, {
    reference: AssetReference;
    occurrenceCount: number;
    sourceKinds: Map<string, number>;
    sourcePaths: Set<string>;
  }>();
  for (const reference of references) {
    const identity = canonicalJson(referenceIdentity(reference));
    const existing = grouped.get(identity);
    if (existing) {
      existing.occurrenceCount += 1;
      existing.sourceKinds.set(reference.sourceKind, (existing.sourceKinds.get(reference.sourceKind) ?? 0) + 1);
      existing.sourcePaths.add(reference.sourcePathSha256);
    } else {
      grouped.set(identity, {
        reference,
        occurrenceCount: 1,
        sourceKinds: new Map([[reference.sourceKind, 1]]),
        sourcePaths: new Set([reference.sourcePathSha256])
      });
    }
  }

  const entries: PrivateAssetReferenceGapEntry[] = [];
  for (const group of grouped.values()) {
    const candidates = resolveReference(group.reference, canonicalSnapshot.entries);
    const kind = candidates.length === 0
      ? "ORPHAN"
      : candidates.length > 1
        ? "AMBIGUOUS"
        : !candidates[0]!.active
          ? "INACTIVE"
          : null;
    if (kind === null) continue;
    entries.push({
      kind,
      requestedType: group.reference.requestedTypes.join("|") || "TYPED_CODE",
      exactKey: group.reference.exactKey,
      displayName: group.reference.displayName,
      grade: group.reference.grade,
      visual: group.reference.visual,
      metric: group.reference.metric,
      sourceKinds: Object.fromEntries([...group.sourceKinds.entries()].sort(([left], [right]) => left.localeCompare(right, "en"))),
      sourceFileCount: group.sourcePaths.size,
      occurrenceCount: group.occurrenceCount,
      candidateCount: candidates.length,
      candidates: candidates.map((entry) => ({
        objectId: entry.objectId,
        objectKey: entry.objectKey,
        objectType: entry.objectType,
        displayName: entry.displayName,
        active: entry.active,
        sources: entry.sources
      }))
    });
  }
  entries.sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right), "en"));
  return {
    format: "hoibot-private-asset-reference-gap-crosswalk-v1",
    catalogVersion: canonicalSnapshot.catalogVersion,
    stagingSha256: stagingManifest.stagingSha256,
    canonicalSha256: canonicalSnapshotHash(canonicalSnapshot),
    generatedAt: new Date().toISOString(),
    payloadFileCount,
    distinctReferenceCount: grouped.size,
    gapIdentityCount: entries.length,
    entries
  };
}

// 격리 payload와 canonical snapshot을 읽기 전용으로 대조하고 비식별 증거만 반환한다.
export async function validateAssetReferences(
  stagingRoot: string,
  stagingManifest: StagingTransformManifest,
  canonicalSnapshot: CanonicalAssetSnapshot
): Promise<AssetReferenceValidationReport> {
  if (canonicalSnapshot.format !== "hoibot-canonical-asset-reference-v1") throw new Error("CANONICAL_SNAPSHOT_FORMAT_INVALID");
  const { references, payloadFileCount } = await loadAssetReferences(stagingRoot, stagingManifest);

  const duplicateKeys = new Map<string, number>();
  const objectKeyOwners = new Map<string, Set<string>>();
  for (const entry of canonicalSnapshot.entries) {
    const identity = `${entry.objectType}|${entry.objectKey}|${entry.objectId}`;
    duplicateKeys.set(identity, (duplicateKeys.get(identity) ?? 0) + 1);
    const owners = objectKeyOwners.get(entry.objectKey) ?? new Set<string>();
    owners.add(`${entry.objectType}|${entry.objectId}`);
    objectKeyOwners.set(entry.objectKey, owners);
  }
  const canonicalDuplicateCount = [...duplicateKeys.values()].filter((count) => count > 1).length;
  const canonicalCollisionCount = [...objectKeyOwners.values()].filter((owners) => owners.size > 1).length;
  const issues: AssetReferenceIssue[] = [];
  const referenceCountsByType: Record<string, number> = {};
  let resolvedCount = 0;

  for (const reference of references) {
    const requestedType = reference.requestedTypes.join("|") || "TYPED_CODE";
    referenceCountsByType[requestedType] = (referenceCountsByType[requestedType] ?? 0) + 1;
    const identityHash = sha256(canonicalJson(referenceIdentity(reference)));
    const candidates = resolveReference(reference, canonicalSnapshot.entries);
    if (candidates.length === 0) {
      issues.push({ kind: "ORPHAN", requestedType, identityHash, locationHash: reference.locationHash });
    } else if (candidates.length > 1) {
      issues.push({ kind: "AMBIGUOUS", requestedType, identityHash, locationHash: reference.locationHash });
    } else if (!candidates[0]!.active) {
      issues.push({ kind: "INACTIVE", requestedType, identityHash, locationHash: reference.locationHash });
    } else {
      resolvedCount += 1;
    }
  }

  issues.sort((left, right) => `${left.kind}|${left.identityHash}|${left.locationHash}`.localeCompare(`${right.kind}|${right.identityHash}|${right.locationHash}`, "en"));
  const distinctReferenceCount = new Set(
    references.map((reference) => sha256(canonicalJson(referenceIdentity(reference))))
  ).size;
  const base = {
    format: "hoibot-asset-reference-validation-v1" as const,
    catalogVersion: canonicalSnapshot.catalogVersion,
    stagingCatalogVersion: stagingManifest.catalogVersion,
    stagingSha256: stagingManifest.stagingSha256,
    canonicalSha256: canonicalSnapshotHash(canonicalSnapshot),
    generatedAt: new Date().toISOString(),
    payloadFileCount,
    referenceCount: references.length,
    distinctReferenceCount,
    resolvedCount,
    orphanCount: issues.filter((issue) => issue.kind === "ORPHAN").length,
    ambiguousCount: issues.filter((issue) => issue.kind === "AMBIGUOUS").length,
    inactiveCount: issues.filter((issue) => issue.kind === "INACTIVE").length,
    canonicalDuplicateCount,
    canonicalCollisionCount,
    referenceCountsByType: Object.fromEntries(Object.entries(referenceCountsByType).sort(([left], [right]) => left.localeCompare(right, "en"))),
    issues
  };
  const reportSha256 = sha256(canonicalJson({ ...base, generatedAt: undefined }));
  return {
    ...base,
    reportSha256,
    dataMigrationReady:
      references.length > 0 && issues.length === 0 && canonicalDuplicateCount === 0 && canonicalCollisionCount === 0
  };
}

export { canonicalSnapshotHash };
