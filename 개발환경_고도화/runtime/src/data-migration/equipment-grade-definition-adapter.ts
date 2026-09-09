import { createHash } from "node:crypto";
import { isLosslessNumber, parse as parseLossless } from "lossless-json";
import type { CatalogProjectionManifest, CatalogProjectionOutputDirective } from "./catalog-projection-provider.js";
import type { CommonStagingRecord } from "./common-staging-extractor.js";

export const EQUIPMENT_GRADE_SOURCE_KEYS = [
  "nameList", "emoji", "upgrade", "drop", "itemCost", "pointCost", "maxLevel",
  "battleExp", "battleUpgradeExp", "raidExp", "raidUpgradeExp", "castleExp", "castleUpgradeExp"
] as const;
export const EQUIPMENT_GRADE_NUMERIC_SOURCE_KEYS = EQUIPMENT_GRADE_SOURCE_KEYS.filter((key) => key !== "nameList" && key !== "emoji");

export type EquipmentGradeSourceRecord = Pick<CommonStagingRecord,
  "sourcePointer" | "sourceLocatorSha256" | "payloadFingerprint" | "payloadJson" | "recordDomain" | "recordKind" | "projectionStatus"
>;

export interface EquipmentGradeProjectionEnvelope {
  commonStagingRunId: string;
  commonStagingSha256: string;
  rawBundleSha256: string;
  snapshotManifestSha256: string;
  extractionManifestSha256: string;
  targetSchemaSha256: string;
  actor: string;
  expectedFileCount: number;
  expectedTotalBytes: string;
  projectedFileCount: number;
  ignoredFileCount: number;
}

export interface EquipmentGradeExpectedCounts {
  definitions: number;
  aliases: number;
  elementalDefinitions: number;
  elementalAliases: number;
  ringDefinitions: number;
  ringAliases: number;
}

export const EQUIPMENT_GRADE_PRODUCTION_COUNTS: EquipmentGradeExpectedCounts = {
  definitions: 106, aliases: 124, elementalDefinitions: 61, elementalAliases: 79, ringDefinitions: 45, ringAliases: 45
};

const HASH = /^[a-f0-9]{64}$/;
const UNSIGNED_INTEGER = /^(?:0|[1-9]\d*)$/;
const INTEGER = /^(?:0|[1-9]\d*)$/;
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const CONTRACT_APPROVAL_SHA256 = createHash("sha256").update("SC-20260902-1|migration475|itemInfo-equipment-grade-13-key-lossless", "utf8").digest("hex");
const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

function stableJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  throw new Error("EQUIPMENT_GRADE_UNSUPPORTED_VALUE");
}

function stableCommonStagingJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (isLosslessNumber(value)) return value.toString();
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("EQUIPMENT_GRADE_NON_FINITE_NUMBER");
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableCommonStagingJson).join(",")}]`;
  if (typeof value === "object") {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${stableCommonStagingJson(row[key])}`).join(",")}}`;
  }
  throw new Error("EQUIPMENT_GRADE_UNSUPPORTED_VALUE");
}

export function calculateEquipmentGradeCommonStagingPayloadFingerprint(payloadJson: string): string {
  let value: unknown;
  try { value = parseLossless(payloadJson); } catch { throw new Error("EQUIPMENT_GRADE_DEFINITION_INVALID"); }
  return sha256(stableCommonStagingJson(value));
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("EQUIPMENT_GRADE_DEFINITION_INVALID");
  return value as Record<string, unknown>;
}

function decodePointerToken(token: string): string {
  if (/~(?:[^01]|$)/.test(token)) throw new Error("EQUIPMENT_GRADE_POINTER_INVALID");
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

function normalizeDecimal(value: unknown, integerOnly: boolean): string {
  if (!isLosslessNumber(value)) throw new Error("EQUIPMENT_GRADE_NUMBER_INVALID");
  const raw = value.toString();
  const match = /^(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(raw);
  if (match === null) throw new Error("EQUIPMENT_GRADE_NUMBER_INVALID");
  const exponent = Number(match[3] ?? "0");
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000) throw new Error("EQUIPMENT_GRADE_NUMBER_INVALID");
  let digits = `${match[1]}${match[2] ?? ""}`;
  let point = match[1]!.length + exponent;
  if (point <= 0) { digits = `${"0".repeat(-point)}${digits}`; point = 0; }
  if (point >= digits.length) digits = `${digits}${"0".repeat(point - digits.length)}`;
  let normalized = point === digits.length ? digits : `${digits.slice(0, point) || "0"}.${digits.slice(point)}`;
  let [whole, fraction] = normalized.split(".");
  whole = whole!.replace(/^0+(?=\d)/, "");
  if (fraction !== undefined) fraction = fraction.replace(/0+$/, "");
  normalized = fraction ? `${whole}.${fraction}` : whole!;
  if (integerOnly && !INTEGER.test(normalized)) throw new Error("EQUIPMENT_GRADE_INTEGER_REQUIRED");
  if (!DECIMAL.test(normalized)) throw new Error("EQUIPMENT_GRADE_NUMBER_INVALID");
  return normalized;
}

function probability(value: unknown): string {
  const normalized = normalizeDecimal(value, false);
  const [whole] = normalized.split(".");
  if (BigInt(whole!) > 1n || (whole === "1" && normalized !== "1")) throw new Error("EQUIPMENT_GRADE_PROBABILITY_RANGE_INVALID");
  return normalized;
}

function identityLocator(sourceLocatorSha256: string, projectionLocator: string, targetTable: string): string {
  return sha256(`${sourceLocatorSha256}\0${projectionLocator}\0${targetTable}`);
}

function gradeOutput(record: EquipmentGradeSourceRecord, family: "elemental" | "ring", gradeName: string, definition: Record<string, unknown>): CatalogProjectionOutputDirective {
  const payload = {
    source_definition_pointer: record.sourcePointer,
    equipment_family: family,
    equipment_grade_name: gradeName,
    equipment_grade_emoji: definition.emoji,
    enhancement_success_probability: probability(definition.upgrade),
    enhancement_drop_probability: probability(definition.drop),
    item_cost_quantity: normalizeDecimal(definition.itemCost, true),
    point_cost_amount: normalizeDecimal(definition.pointCost, true),
    maximum_enhancement_level: normalizeDecimal(definition.maxLevel, true),
    battle_base_experience_amount: normalizeDecimal(definition.battleExp, true),
    battle_experience_per_enhancement_amount: normalizeDecimal(definition.battleUpgradeExp, true),
    raid_base_experience_amount: normalizeDecimal(definition.raidExp, true),
    raid_experience_per_enhancement_amount: normalizeDecimal(definition.raidUpgradeExp, true),
    castle_base_experience_amount: normalizeDecimal(definition.castleExp, true),
    castle_experience_per_enhancement_amount: normalizeDecimal(definition.castleUpgradeExp, true),
    active_flag: true
  };
  if (typeof payload.equipment_grade_emoji !== "string" || [...payload.equipment_grade_emoji].length < 1 || [...payload.equipment_grade_emoji].length > 32) throw new Error("EQUIPMENT_GRADE_EMOJI_INVALID");
  const valueOrigins = Object.fromEntries(Object.keys(payload).map((key) => [key,
    ["source_definition_pointer", "equipment_family", "equipment_grade_name"].includes(key) ? "DERIVED_INDEX" :
      key === "active_flag" ? "CONSTANT_CONTRACT" : key === "equipment_grade_emoji" ? "SOURCE_EXACT" : "EXPLICIT_RULE"
  ])) as CatalogProjectionOutputDirective["valueOrigins"];
  const sourceBindings = { equipment_grade_emoji: "/emoji" };
  return {
    projectionLocator: record.sourcePointer, identityMode: "GENERATED", targetTable: "canonical_equipment_grade_definitions",
    targetPkColumn: "equipment_grade_definition_id", targetObjectType: "CANONICAL_EQUIPMENT_GRADE_DEFINITION",
    targetSourceNamespace: "object-import.pet-equipment.canonical_equipment_grade_definitions", sourceRole: "EQUIPMENT_GRADE_DEFINITION",
    payload, valueOrigins, sourceBindings, referenceBindings: [], approvalKind: "RULE_PROVENANCE", approvalSha256: CONTRACT_APPROVAL_SHA256
  };
}

function aliasOutput(record: EquipmentGradeSourceRecord, alias: string, aliasOrder: number): CatalogProjectionOutputDirective {
  const projectionLocator = `${record.sourcePointer}/nameList/${aliasOrder}`;
  return {
    projectionLocator, identityMode: "GENERATED", targetTable: "canonical_equipment_grade_aliases",
    targetPkColumn: "equipment_grade_alias_id", targetObjectType: "CANONICAL_EQUIPMENT_GRADE_ALIAS",
    targetSourceNamespace: "object-import.pet-equipment.canonical_equipment_grade_aliases", sourceRole: "EQUIPMENT_GRADE_ALIAS_REFERENCE",
    payload: { alias_order: String(aliasOrder), equipment_name: alias },
    valueOrigins: { alias_order: "DERIVED_INDEX", equipment_name: "SOURCE_EXACT" },
    sourceBindings: { equipment_name: `/nameList/${aliasOrder}` },
    referenceBindings: [{
      column: "equipment_grade_definition_id", targetTable: "canonical_equipment_grade_definitions",
      targetPkColumn: "equipment_grade_definition_id",
      identityLocatorSha256: identityLocator(record.sourceLocatorSha256, record.sourcePointer, "canonical_equipment_grade_definitions"),
      bindingScope: "MANIFEST"
    }], approvalKind: "SOURCE_DIRECT", approvalSha256: CONTRACT_APPROVAL_SHA256
  };
}

export function buildEquipmentGradeProjectionManifest(
  records: EquipmentGradeSourceRecord[], envelope: EquipmentGradeProjectionEnvelope,
  expected: EquipmentGradeExpectedCounts = EQUIPMENT_GRADE_PRODUCTION_COUNTS
): CatalogProjectionManifest {
  const counts = { definitions: 0, aliases: 0, elementalDefinitions: 0, elementalAliases: 0, ringDefinitions: 0, ringAliases: 0 };
  const sources = records.map((record) => {
    if (!HASH.test(record.sourceLocatorSha256) || !HASH.test(record.payloadFingerprint)) throw new Error("EQUIPMENT_GRADE_SOURCE_HASH_INVALID");
    if (record.payloadFingerprint !== calculateEquipmentGradeCommonStagingPayloadFingerprint(record.payloadJson)) throw new Error("EQUIPMENT_GRADE_PAYLOAD_FINGERPRINT_MISMATCH");
    if (record.recordDomain !== "pet-equipment" || record.recordKind !== "EQUIPMENT_GRADE_DEFINITION" || record.projectionStatus !== "PROJECT") throw new Error("EQUIPMENT_GRADE_STAGING_RECORD_SCOPE_INVALID");
    const pointer = /^\/(elemental|ring)\/([^/]+)$/.exec(record.sourcePointer);
    if (pointer === null) throw new Error("EQUIPMENT_GRADE_POINTER_INVALID");
    const family = pointer[1] as "elemental" | "ring";
    const gradeName = decodePointerToken(pointer[2]!);
    if ([...gradeName].length < 1 || [...gradeName].length > 255) throw new Error("EQUIPMENT_GRADE_NAME_INVALID");
    const definition = asRecord(parseLossless(record.payloadJson));
    const actualKeys = Object.keys(definition).sort();
    if (stableJson(actualKeys) !== stableJson([...EQUIPMENT_GRADE_SOURCE_KEYS].sort())) throw new Error("EQUIPMENT_GRADE_SOURCE_KEY_COVERAGE_INVALID");
    const names = definition.nameList;
    if (!Array.isArray(names) || names.length === 0 || names.some((name) => typeof name !== "string" || [...name].length < 1 || [...name].length > 255)) throw new Error("EQUIPMENT_GRADE_ALIAS_LIST_INVALID");
    counts.definitions++; counts.aliases += names.length;
    if (family === "elemental") { counts.elementalDefinitions++; counts.elementalAliases += names.length; }
    else { counts.ringDefinitions++; counts.ringAliases += names.length; }
    return {
      sourceLocatorSha256: record.sourceLocatorSha256, sourcePayloadFingerprint: record.payloadFingerprint,
      recordDomain: "pet-equipment", decisionStatus: "PROJECT" as const,
      outputs: [gradeOutput(record, family, gradeName, definition), ...names.map((name, index) => aliasOutput(record, name as string, index))]
    };
  });
  if (stableJson(counts) !== stableJson(expected)) throw new Error(`EQUIPMENT_GRADE_COUNT_DRIFT:${stableJson(counts)}`);
  if (new Set(records.map((record) => record.sourcePointer)).size !== records.length || new Set(records.map((record) => record.sourceLocatorSha256)).size !== records.length) throw new Error("EQUIPMENT_GRADE_DUPLICATE_SOURCE_IDENTITY");
  if (![envelope.commonStagingSha256, envelope.rawBundleSha256, envelope.snapshotManifestSha256, envelope.extractionManifestSha256, envelope.targetSchemaSha256].every((value) => HASH.test(value))) throw new Error("EQUIPMENT_GRADE_STAGING_ENVELOPE_HASH_INVALID");
  if (![envelope.expectedFileCount, envelope.projectedFileCount, envelope.ignoredFileCount].every((value) => Number.isSafeInteger(value) && value >= 0) || envelope.expectedFileCount === 0 || envelope.projectedFileCount + envelope.ignoredFileCount !== envelope.expectedFileCount || !UNSIGNED_INTEGER.test(envelope.expectedTotalBytes)) throw new Error("EQUIPMENT_GRADE_STAGING_ENVELOPE_COUNT_INVALID");
  return {
    format: "hoibot-catalog-projection-manifest-v1", catalogVersion: "SC-20260902-1",
    commonStagingRunId: envelope.commonStagingRunId, commonStagingSha256: envelope.commonStagingSha256,
    commonStagingEnvelope: { rawBundleSha256: envelope.rawBundleSha256, snapshotManifestSha256: envelope.snapshotManifestSha256, extractionManifestSha256: envelope.extractionManifestSha256, expectedFileCount: envelope.expectedFileCount, expectedTotalBytes: envelope.expectedTotalBytes, projectedFileCount: envelope.projectedFileCount, ignoredFileCount: envelope.ignoredFileCount },
    targetSchemaSha256: envelope.targetSchemaSha256, actor: envelope.actor, sources
  };
}
