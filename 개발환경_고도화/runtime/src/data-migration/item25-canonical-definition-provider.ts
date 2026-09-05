import { createHash } from "node:crypto";
import { isLosslessNumber, parse as parseLossless } from "lossless-json";
import type { DatabaseClient, DatabaseTransaction, ReadOnlySnapshotTransaction } from "../database.js";
import { hasDatabaseTransactionCapabilities } from "../database.js";
import {
  OBJECT_IDENTITY_MAX_ATTEMPTS,
  assertObjectIdentityCandidate,
  createObjectAuditValues,
  createObjectIdentityCandidate,
  type ObjectIdentityCandidateGenerator
} from "../identity/object-identity-audit-provider.js";
import type { CommonStagingRecord } from "./common-staging-extractor.js";
import { calculateObjectDomainParityImportSha256 } from "./object-domain-parity-verifier.js";

export const ITEM25_DEFINITION_COUNT = 25;
export const ITEM25_IMPORT_SOURCE_SYSTEM = "LEGACY_JSON" as const;
export const ITEM25_IMPORT_SOURCE_NAMESPACE = "itemInfo.json" as const;
export const ITEM25_IDENTITY_SOURCE_NAMESPACE = "object-import.item.canonical_item_definitions" as const;

const HASH = /^[0-9a-f]{64}$/;
const CUID = /^[a-z0-9]{8}$/;
const OBJECT_TYPE = "CANONICAL_ITEM_DEFINITIONS";
const LOGICAL_SOURCE_NAME = "data/itemInfo.json";
const AUTHORITATIVE_SOURCE_PATH_SHA256 = "7345a0090df04e40e3d40478622d4ee246d179c03367c960df6b2de19fb78478";
const AUTHORITATIVE_SOURCE_CONTENT_SHA256 = "49ef9f7b39ffa5fab57c0d3759f8a682c7be759e4708f76744ae095fc673ffdc";
const AUTHORITATIVE_MANIFEST_SHA256 = "20fbb0ff6e780968c19b1fd94ecf2608f1f9a0567527bfd77b28fab5f6f9a1fd";
const AUTHORITATIVE_TARGET_SCHEMA_SHA256 = "2d0229891ffaaf486ec9fe7f786d362b90d219bfb915ed2cdf54c1937fe4cf3a";
const ACCEPTED_IMPORT_CONTRACT_SHA256 = [
  "67cf9e7c3d5811148e78a2b3eb87db768692aa85ac30b5bc58f7315dad4cb73b",
  "487f098d9d8357bbe636b91766dd07f24618b350e449510f52f266fd2b80a861"
] as const;
const APPROVED_SCOPE_SHA256 = {
  RAID_SPECIAL: "d505b493502a08173763c86f6d3b9fc3048bfa6fcf34cebe9915bb04c14b8259",
  TERRITORY_TICKET: "b73af65e9e0545c2d44a38c95b23466726b02febfff81332af230a160dbb027a",
  CASTLE_UNIT: "329b2cab1cee71cc558606312d871a747c2b51f6a1effd9c932f0db24d22f9c3"
} as const;

type Item25Kind = "RAID_SPECIAL" | "TERRITORY_TICKET" | "CASTLE_UNIT";

interface AuthoritativeEntry {
  sourcePointer: string;
  sourceLocatorSha256: string;
  sourcePayloadFingerprint: string;
  itemKind: Item25Kind;
}

// WBS742가 승인한 itemInfo source seal과 선행 3개 catalog slice의 exact locator/payload allowlist입니다.
const AUTHORITATIVE_ENTRIES: readonly AuthoritativeEntry[] = [
  ["/castleItem/item_0","ed57195b6167afd3f4a2bbc6090d24c3f1687caf9cadf222bbf62ae690c2e4da","23d93b1f6add844868f32fc3031c71db1ffa378527312544519fd64acaf04f67","CASTLE_UNIT"],
  ["/castleItem/item_1","d5edc3922f01bb6b53a472615a69d4b53b96cb78f9ccc1123bcdc0b79dbd065b","33291f16fa5b63e40ced721e2a72ea95ac3805ae7312c693813934e24932ddf0","CASTLE_UNIT"],
  ["/castleItem/item_2","bd9f2342603cc69e0c5105587f1dd926a772db2eb55fec50e47a1da046e704bd","12a4d1c54d575315feef728dd22371aa9083ebd8947cf608e0a6b607b51ef077","CASTLE_UNIT"],
  ["/castleItem/item_3","e189b29b7df1a8804107b2621862dfdf8211bee74e84778c88c228694701bbd2","58974ce36267c8a5707b841afbe27ffb36ec5b455088d76fd793d82fc00cfe9f","CASTLE_UNIT"],
  ["/castleItem/item_4","647cbde890939373d040b75a35f5d945072140189ce2689b59aeb09869de9763","2a62ee704177c0eb31dd6fbea1c79a17229183d42499b3623111501bbbbcdafe","CASTLE_UNIT"],
  ["/castleItem/item_5","409d62442bb8d9567ed3423858dcf81c877c0152d2144c32e684283870e93d01","a3902932bd419230483a38c31128affea9a106fe29d79c28e7a3fb5af142541b","CASTLE_UNIT"],
  ["/castleItem/item_6","aeac521810720c589a5897254925a2607a76a81814ba0403671513784265f118","0a73acda3107d43fd2d2c983501d3723abf7e7598d7f9d0b042a8fed38cd3a37","CASTLE_UNIT"],
  ["/castleItem/item_7","b63cc85a7d0cee20f34db3ae2140fcfe60eb505010cdd1c79a6a6f82197aee74","ff0425fdfd5912f300be82a15cce9051f510f0ee7fa8e127963ff0608cb2b1c3","CASTLE_UNIT"],
  ["/castleItem/item_8","77c66f610ef0ab2072f52372fff7c85e52d98f614b353c9757523c8bb0297a3a","64356d71255f7cd6f87628cc05b442b58e32dd7c6d0f05f7643053e3994e99a3","CASTLE_UNIT"],
  ["/castleItem/item_9","4f0f1a710f7582927bebee8c0bf02411a8b838dcf0ed3875a5cba83cab1abab1","5f7693897b9114bec76bc0a41e576032d89be91a5f6ac6eb40b6ef5e1cc30988","CASTLE_UNIT"],
  ["/castlePremiumItem/defense/item_0","8113260064cee82167ecc082a2cc8721e98663ae53de461a6d01a92a89275350","ffffee0a42417d74619adeaa75eb0519ac16bf9d7cde2a0751c37ba285ac4f0b","TERRITORY_TICKET"],
  ["/castlePremiumItem/defense/item_1","9fefd5cb6aa6dbf7debfc5100c8995ab10845874f9b51ea0cbad3ec37a2a891a","12bf5336112b4190bcb3bc76293bf9cd85ef7bdaab50a4292d8634468cf0b839","TERRITORY_TICKET"],
  ["/castlePremiumItem/defense/item_2","a03a4f429b886ef466df22d97fe2b921dead90abcef4e395ab1fe8cedb73d29d","6372dcff989691209c40806d94f435f414c0e1bff459ee717f3eb96c7d1363ac","TERRITORY_TICKET"],
  ["/castlePremiumItem/offense/item_0","d11654782bf9215265ec5634cde659f19b40c3ed2ff66fe33aa9e2abc9713cfa","6cfc7c7f7cf86cdaebe460f643a0141ad986f14412b7f9b82021bab6915bb931","TERRITORY_TICKET"],
  ["/castlePremiumItem/offense/item_1","ee39bf2d9fbc9c26180f31723bbda8304f053665053f421853ae1900d5b45452","7566199a8dc3c413d3da321f1ff3b260df97fdbd0613c8fb268ee7863a15a7db","TERRITORY_TICKET"],
  ["/castlePremiumItem/offense/item_2","31425b80cf2f78ead7d5b69e4589c63c6d3690a32f5cc37811f373aa4cb17f1d","6de70ebe9a02990925a456a7902fd8cf3097382e7e123fa1a5d07776dcd5ed4c","TERRITORY_TICKET"],
  ["/raidSpecialItem/dept1/item_0","6c1e631db44a4a93eec500a74f9bd8d4e3cffd3d3c941c6353c2f99bf268333d","1dd1e9404b18b44aeff91cf4c13c7f9fe0d1e7bf1aa2d5ed09d9a47b4179184f","RAID_SPECIAL"],
  ["/raidSpecialItem/dept1/item_1","1803017a1c2adc07c593a048ceaecab4a611c36ec663ab622791ba6a32543243","8e70c62fcf4045f0aefaea4990631729fbdd0927d12eee2ac41ee5a828a201a1","RAID_SPECIAL"],
  ["/raidSpecialItem/dept1/item_2","2f8341032ef44269f7c11b782312c0669e9ec1863a35435ebc2bae3f595b1a50","17f4a0a8a9c167057e386dde71fb4a0b40f706ff1750c620dfcaa30a4f6daaf6","RAID_SPECIAL"],
  ["/raidSpecialItem/dept1/item_3","861226c471b6c4f2ebeea0b718da2beff2f0095653af8e7383fd36a4d26b0fab","cf59d7f65a51b3ea565d4bb68137e8efda606d453841188e2cbffa6df37bc147","RAID_SPECIAL"],
  ["/raidSpecialItem/dept1/item_4","6957b1cb101cfb69e3f13be1a9f8795abbf4a2ab5bb3cb1945484d9f51530581","af0fa690ad85cc69a02b1a91e18607c1d34f05238f81805ba8329a926d43e304","RAID_SPECIAL"],
  ["/raidSpecialItem/dept1/item_5","534059111229846d641c3f3b47a96374167151838cb5d101efb97efa9332b96e","531c2d3ba7bafa8f7a624fbd62d0f80c8e3c9b057871fa89c3f6a41506616652","RAID_SPECIAL"],
  ["/raidSpecialItem/dept1/item_6","d53bbe01c983c85b35e0856ef599a7a1105e30ec7d4a97055a46fe9c32926162","554608eb810cec1743038aff55422d5b76de316204d9fadd3a21cf8a770f82f9","RAID_SPECIAL"],
  ["/raidSpecialItem/dept1/item_7","56ee841f78b109d2539d823a189ee797c8b5de62efd824d482a2189b9d085fc9","16bd07b5a914e70d037b567da396af2bf04febceb2f0c4949c8f737736de7678","RAID_SPECIAL"],
  ["/raidSpecialItem/dept2/item_0","064bcb1971ffce549b2d5f00810b58d3bcc0bec937d89b5bb232f40037c9f8bf","77cb001679d3e915622e91a872848c4c53b388479d4c88ca68760361e18c6ee9","RAID_SPECIAL"]
].map(([sourcePointer,sourceLocatorSha256,sourcePayloadFingerprint,itemKind]) => ({ sourcePointer,sourceLocatorSha256,sourcePayloadFingerprint,itemKind: itemKind as Item25Kind })) as readonly AuthoritativeEntry[];
const AUTHORITATIVE_BY_POINTER = new Map(AUTHORITATIVE_ENTRIES.map((entry) => [entry.sourcePointer, entry]));

export interface Item25CanonicalDefinitionManifestEntry {
  sourcePointer: string;
  sourceLocatorSha256: string;
  sourcePayloadFingerprint: string;
  definitionOptionsSha256: string;
  itemKind: Item25Kind;
  bindingFingerprint: string;
}

export interface Item25CanonicalDefinitionManifest {
  format: "hoibot-item25-canonical-definition-binding-manifest-v1";
  catalogVersion: "SC-20260902-1";
  sourceSystem: typeof ITEM25_IMPORT_SOURCE_SYSTEM;
  sourceNamespace: typeof ITEM25_IMPORT_SOURCE_NAMESPACE;
  identitySourceNamespace: typeof ITEM25_IDENTITY_SOURCE_NAMESPACE;
  sourcePathSha256: string;
  sourceContentSha256: string;
  expectedCount: 25;
  expectedKinds: { RAID_SPECIAL: 9; TERRITORY_TICKET: 6; CASTLE_UNIT: 10 };
  entries: Item25CanonicalDefinitionManifestEntry[];
  manifestSha256: string;
}

export interface Item25CanonicalDefinitionResult {
  insertedBindings: number;
  replayed: boolean;
  manifestSha256: string;
}

interface SchemaRow {
  table_name: string;
  column_name: string;
  column_type: string;
  is_nullable: string;
  character_set_name: string | null;
  collation_name: string | null;
}

interface KeyRow {
  table_name: string;
  constraint_name: string;
  constraint_type: string;
  column_name: string;
  ordinal_position: number | bigint | string;
  referenced_table_name: string | null;
  referenced_column_name: string | null;
}

interface LineageRow {
  item_id: string;
  item_name: string;
  item_description: string | null;
  item_kind: string;
  item_grade: string | null;
  price_amount: string | null;
  price_currency_source_identifier: string | null;
  stackable_flag: number | bigint | boolean | string;
  active_flag: number | bigint | boolean | string;
  definition_options: string;
  object_type: string;
  crosswalk_source_identifier: string;
  crosswalk_payload_fingerprint: string | null;
  object_domain_import_record_id: string | null;
  receipt_binding_fingerprint: string | null;
  imported_row_fingerprint: string | null;
  run_status: string | null;
  projection_locator: string | null;
  identity_locator_sha256: string | null;
  identity_mode: string | null;
  target_table_name: string | null;
  target_pk_column_name: string | null;
  target_object_type: string | null;
  target_source_namespace: string | null;
  approval_kind: string | null;
  approval_sha256: string | null;
  target_payload_json: string | null;
  target_payload_fingerprint: string | null;
  value_origins_json: string | null;
  value_origins_fingerprint: string | null;
  reference_bindings_json: string | null;
  reference_bindings_fingerprint: string | null;
  decision_source_locator_sha256: string | null;
  decision_source_payload_fingerprint: string | null;
  decision_status: string | null;
  decision_projected_row_count: number | bigint | string | null;
  staging_common_staging_run_id: string | null;
  staging_source_system: string | null;
  staging_source_namespace: string | null;
  source_path_sha256: string | null;
  source_content_sha256: string | null;
  logical_source_name: string | null;
  source_pointer: string | null;
  identity_pointer: string | null;
  staging_source_locator_sha256: string | null;
  projection_status: string | null;
  record_domain: string | null;
  record_kind: string | null;
  payload_json: string | null;
  staging_payload_fingerprint: string | null;
}

interface ImportRow {
  item_definition_import_id: string;
  item_id: string;
  source_identifier: string;
}

interface ProjectionRunEvidence {
  catalog_projection_run_id: string; common_staging_run_id: string; catalog_version: string;
  projection_manifest_sha256: string; target_schema_sha256: string; projection_sha256: string; upstream_envelope_sha256: string;
  expected_source_count: number | bigint | string; projected_source_count: number | bigint | string;
  quarantined_source_count: number | bigint | string; ignored_source_count: number | bigint | string;
  projected_row_count: number | bigint | string; run_status: string;
}
interface StagingRunEvidence {
  common_staging_run_id: string; raw_bundle_sha256: string; snapshot_manifest_sha256: string; extraction_manifest_sha256: string; staging_sha256: string;
  expected_file_count: number | bigint | string; expected_total_bytes: string; projected_file_count: number | bigint | string; ignored_file_count: number | bigint | string; run_status: string;
}
interface DecisionEvidence {
  catalog_source_decision_id: string; source_locator_sha256: string; source_payload_fingerprint: string; record_domain: string;
  decision_status: string; decision_reason: string | null; projected_row_count: number | bigint | string; decision_fingerprint: string;
}
interface ProjectionEvidence {
  catalog_projection_record_id: string; catalog_source_decision_id: string; projection_locator: string; identity_locator_sha256: string; identity_mode: string;
  target_table_name: string; target_pk_column_name: string; target_object_type: string; target_source_namespace: string; source_role: string | null;
  approval_kind: string | null; approval_sha256: string | null; target_payload_json: string; target_payload_fingerprint: string;
  value_origins_json: string; value_origins_fingerprint: string; reference_bindings_json: string; reference_bindings_fingerprint: string;
}
interface ImportRunEvidence {
  object_domain_import_run_id: string; catalog_version: string; catalog_projection_sha256: string; upstream_envelope_sha256: string; target_schema_sha256: string;
  import_contract_sha256: string; import_sha256: string; expected_source_count: number | bigint | string; projected_source_count: number | bigint | string;
  quarantined_source_count: number | bigint | string; ignored_source_count: number | bigint | string; expected_row_count: number | bigint | string;
  imported_row_count: number | bigint | string; run_status: string;
}
interface DecisionReceiptEvidence {
  catalog_source_decision_id: string; source_locator_sha256: string; decision_status: string; decision_reason: string | null;
  projected_row_count: number | bigint | string; decision_fingerprint: string;
}

type QueryOnly = Pick<DatabaseTransaction, "query"> | ReadOnlySnapshotTransaction;

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

function stable(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (isLosslessNumber(value)) return value.toString();
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("ITEM25_VALUE_INVALID");
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (typeof value === "object") {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${stable(row[key])}`).join(",")}}`;
  }
  throw new Error("ITEM25_VALUE_INVALID");
}

function normalizeLossless(value: unknown): unknown {
  if (isLosslessNumber(value)) return value.toString();
  if (Array.isArray(value)) return value.map(normalizeLossless);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, normalizeLossless(child)]));
  }
  return value;
}

function parseObject(text: string, code: string): Record<string, unknown> {
  let parsed: unknown;
  try { parsed = parseLossless(text); } catch { throw new Error(code); }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(code);
  return parsed as Record<string, unknown>;
}

function kindFor(recordKind: string, sourcePointer: string): Item25Kind {
  if (recordKind === "RAID_ITEM_DEFINITION" && /^\/raidSpecialItem\/[^/]+\/item_(?:0|[1-9]\d*)$/.test(sourcePointer)) return "RAID_SPECIAL";
  if (recordKind === "TERRITORY_ITEM_DEFINITION" && /^\/castlePremiumItem\/[^/]+\/item_(?:0|[1-9]\d*)$/.test(sourcePointer)) return "TERRITORY_TICKET";
  if (recordKind === "CASTLE_ITEM_DEFINITION" && /^\/castleItem\/[^/]+$/.test(sourcePointer)) return "CASTLE_UNIT";
  throw new Error("ITEM25_STAGING_SCOPE_INVALID");
}

function entryFingerprint(entry: Omit<Item25CanonicalDefinitionManifestEntry, "bindingFingerprint">): string {
  return sha256(stable({ catalogVersion: "SC-20260902-1", ...entry }));
}

function manifestFingerprint(manifest: Omit<Item25CanonicalDefinitionManifest, "manifestSha256">): string {
  return sha256(stable(manifest));
}

// 봉인된 Common Staging의 25개 ITEM occurrence만 사용하며 표시명이나 legacy CODE를 identity로 사용하지 않습니다.
export function buildItem25CanonicalDefinitionManifest(records: CommonStagingRecord[]): Item25CanonicalDefinitionManifest {
  if (records.length !== ITEM25_DEFINITION_COUNT) throw new Error("ITEM25_COUNT_INVALID");
  if (new Set(records.map((record) => record.sourcePathSha256)).size !== 1 || new Set(records.map((record) => record.sourceContentSha256)).size !== 1) throw new Error("ITEM25_STAGING_SOURCE_SEAL_DRIFT");
  if (records[0]!.sourcePathSha256 !== AUTHORITATIVE_SOURCE_PATH_SHA256 || records[0]!.sourceContentSha256 !== AUTHORITATIVE_SOURCE_CONTENT_SHA256) throw new Error("ITEM25_AUTHORITATIVE_SOURCE_SEAL_DRIFT");
  const entries = records.map((record) => {
    if (record.sourceSystem !== ITEM25_IMPORT_SOURCE_SYSTEM || record.sourceNamespace !== ITEM25_IMPORT_SOURCE_NAMESPACE || record.logicalSourceName !== LOGICAL_SOURCE_NAME || !HASH.test(record.sourcePathSha256) || !HASH.test(record.sourceContentSha256)) throw new Error("ITEM25_STAGING_SOURCE_INVALID");
    if (record.recordDomain !== "ITEM" || record.projectionStatus !== "PROJECT" || record.quarantineReason !== null || record.identityPointer !== record.sourcePointer || record.projectionLocator !== record.sourcePointer || record.ownerLocatorSha256 !== null || record.quantityValue !== null || record.observedTime !== null) throw new Error("ITEM25_STAGING_SCOPE_INVALID");
    if ([...record.sourcePointer].length === 0 || [...record.sourcePointer].length > 191) throw new Error("ITEM25_SOURCE_POINTER_INVALID");
    const itemKind = kindFor(record.recordKind, record.sourcePointer);
    const authoritative = AUTHORITATIVE_BY_POINTER.get(record.sourcePointer);
    if (authoritative === undefined || authoritative.itemKind !== itemKind) throw new Error("ITEM25_AUTHORITATIVE_POINTER_REJECTED");
    const expectedLocator = sha256(`${LOGICAL_SOURCE_NAME}\0${record.sourcePointer}\0${record.recordKind}\0${record.sourcePointer}`);
    if (!HASH.test(record.sourceLocatorSha256) || record.sourceLocatorSha256 !== expectedLocator) throw new Error("ITEM25_SOURCE_LOCATOR_DRIFT");
    const payload = parseObject(record.payloadJson, "ITEM25_STAGING_PAYLOAD_INVALID");
    if (typeof payload.name !== "string" || payload.name.length === 0) throw new Error("ITEM25_STAGING_PAYLOAD_INVALID");
    if (!HASH.test(record.payloadFingerprint) || sha256(stable(payload)) !== record.payloadFingerprint) throw new Error("ITEM25_SOURCE_PAYLOAD_FINGERPRINT_DRIFT");
    if (record.sourceLocatorSha256 !== authoritative.sourceLocatorSha256 || record.payloadFingerprint !== authoritative.sourcePayloadFingerprint) throw new Error("ITEM25_AUTHORITATIVE_ENTRY_DRIFT");
    const draft = {
      sourcePointer: record.sourcePointer,
      sourceLocatorSha256: record.sourceLocatorSha256,
      sourcePayloadFingerprint: record.payloadFingerprint,
      definitionOptionsSha256: sha256(stable(normalizeLossless(payload))),
      itemKind
    };
    return { ...draft, bindingFingerprint: entryFingerprint(draft) };
  }).sort((left, right) => left.sourcePointer.localeCompare(right.sourcePointer, "en"));
  if (new Set(entries.map((entry) => entry.sourcePointer)).size !== ITEM25_DEFINITION_COUNT || new Set(entries.map((entry) => entry.sourceLocatorSha256)).size !== ITEM25_DEFINITION_COUNT) throw new Error("ITEM25_SOURCE_DUPLICATE");
  const counts = { RAID_SPECIAL: 0, TERRITORY_TICKET: 0, CASTLE_UNIT: 0 };
  for (const entry of entries) counts[entry.itemKind] += 1;
  if (counts.RAID_SPECIAL !== 9 || counts.TERRITORY_TICKET !== 6 || counts.CASTLE_UNIT !== 10) throw new Error("ITEM25_KIND_COUNT_INVALID");
  const withoutHash = {
    format: "hoibot-item25-canonical-definition-binding-manifest-v1" as const,
    catalogVersion: "SC-20260902-1" as const,
    sourceSystem: ITEM25_IMPORT_SOURCE_SYSTEM,
    sourceNamespace: ITEM25_IMPORT_SOURCE_NAMESPACE,
    identitySourceNamespace: ITEM25_IDENTITY_SOURCE_NAMESPACE,
    sourcePathSha256: records[0]!.sourcePathSha256,
    sourceContentSha256: records[0]!.sourceContentSha256,
    expectedCount: ITEM25_DEFINITION_COUNT as 25,
    expectedKinds: { RAID_SPECIAL: 9 as const, TERRITORY_TICKET: 6 as const, CASTLE_UNIT: 10 as const },
    entries
  };
  return { ...withoutHash, manifestSha256: manifestFingerprint(withoutHash) };
}

export function assertItem25CanonicalDefinitionManifest(manifest: Item25CanonicalDefinitionManifest): void {
  if (manifest.format !== "hoibot-item25-canonical-definition-binding-manifest-v1" || manifest.catalogVersion !== "SC-20260902-1" || manifest.sourceSystem !== ITEM25_IMPORT_SOURCE_SYSTEM || manifest.sourceNamespace !== ITEM25_IMPORT_SOURCE_NAMESPACE || manifest.identitySourceNamespace !== ITEM25_IDENTITY_SOURCE_NAMESPACE || !HASH.test(manifest.sourcePathSha256) || !HASH.test(manifest.sourceContentSha256) || manifest.expectedCount !== ITEM25_DEFINITION_COUNT || manifest.entries.length !== ITEM25_DEFINITION_COUNT) throw new Error("ITEM25_MANIFEST_INVALID");
  if (manifest.expectedKinds.RAID_SPECIAL !== 9 || manifest.expectedKinds.TERRITORY_TICKET !== 6 || manifest.expectedKinds.CASTLE_UNIT !== 10) throw new Error("ITEM25_MANIFEST_KIND_COUNT_INVALID");
  if (manifest.sourcePathSha256 !== AUTHORITATIVE_SOURCE_PATH_SHA256 || manifest.sourceContentSha256 !== AUTHORITATIVE_SOURCE_CONTENT_SHA256) throw new Error("ITEM25_AUTHORITATIVE_SOURCE_SEAL_DRIFT");
  const sorted = [...manifest.entries].sort((left, right) => left.sourcePointer.localeCompare(right.sourcePointer, "en"));
  const counts = { RAID_SPECIAL: 0, TERRITORY_TICKET: 0, CASTLE_UNIT: 0 };
  for (const entry of sorted) {
    if ([...entry.sourcePointer].length === 0 || [...entry.sourcePointer].length > 191 || !HASH.test(entry.sourceLocatorSha256) || !HASH.test(entry.sourcePayloadFingerprint) || !HASH.test(entry.definitionOptionsSha256) || !HASH.test(entry.bindingFingerprint)) throw new Error("ITEM25_MANIFEST_ENTRY_INVALID");
    if (kindFor(entry.itemKind === "RAID_SPECIAL" ? "RAID_ITEM_DEFINITION" : entry.itemKind === "TERRITORY_TICKET" ? "TERRITORY_ITEM_DEFINITION" : "CASTLE_ITEM_DEFINITION", entry.sourcePointer) !== entry.itemKind) throw new Error("ITEM25_MANIFEST_ENTRY_SCOPE_INVALID");
    const authoritative = AUTHORITATIVE_BY_POINTER.get(entry.sourcePointer);
    if (authoritative === undefined || authoritative.itemKind !== entry.itemKind || authoritative.sourceLocatorSha256 !== entry.sourceLocatorSha256 || authoritative.sourcePayloadFingerprint !== entry.sourcePayloadFingerprint) throw new Error("ITEM25_AUTHORITATIVE_ENTRY_DRIFT");
    const { bindingFingerprint, ...draft } = entry;
    if (entryFingerprint(draft) !== bindingFingerprint) throw new Error("ITEM25_BINDING_FINGERPRINT_DRIFT");
    counts[entry.itemKind] += 1;
  }
  if (new Set(sorted.map((entry) => entry.sourcePointer)).size !== ITEM25_DEFINITION_COUNT || new Set(sorted.map((entry) => entry.sourceLocatorSha256)).size !== ITEM25_DEFINITION_COUNT) throw new Error("ITEM25_MANIFEST_DUPLICATE");
  if (counts.RAID_SPECIAL !== 9 || counts.TERRITORY_TICKET !== 6 || counts.CASTLE_UNIT !== 10) throw new Error("ITEM25_MANIFEST_KIND_COUNT_INVALID");
  const { manifestSha256, ...withoutHash } = manifest;
  if (!HASH.test(manifestSha256) || manifestFingerprint(withoutHash) !== manifestSha256) throw new Error("ITEM25_MANIFEST_DRIFT");
  if (manifestSha256 !== AUTHORITATIVE_MANIFEST_SHA256) throw new Error("ITEM25_AUTHORITATIVE_MANIFEST_DRIFT");
}

type SchemaColumnContract = { name: string; columnType: string; nullable: "YES" | "NO"; charset: string | null; collation: string | null };
type SchemaTableContract = { table: string; columns: readonly SchemaColumnContract[]; keySignatures: readonly string[] };
const c = (name: string, columnType: string, nullable: "YES" | "NO", charset: string | null = null, collation: string | null = null): SchemaColumnContract => ({ name, columnType, nullable, charset, collation });
const a = (name: string, columnType: string, nullable: "YES" | "NO" = "NO") => c(name, columnType, nullable, "ascii", "ascii_bin");
const u = (name: string, columnType: string, nullable: "YES" | "NO" = "NO", collation = "utf8mb4_bin") => c(name, columnType, nullable, "utf8mb4", collation);

export const ITEM25_USED_SCHEMA_CONTRACT: readonly SchemaTableContract[] = [
  { table: "canonical_item_definitions", columns: [a("item_id","char(8)"),u("item_name","varchar(255)"),u("item_description","text","YES","utf8mb4_unicode_ci"),a("item_kind","varchar(50)"),a("item_grade","varchar(50)","YES"),c("price_amount","decimal(30,3)","YES"),u("price_currency_source_identifier","varchar(191)","YES"),c("stackable_flag","tinyint(1)","NO"),c("active_flag","tinyint(1)","NO"),u("definition_options","longtext","YES")], keySignatures: ["PRIMARY:item_id"] },
  { table: "canonical_item_definition_imports", columns: [a("item_definition_import_id","char(8)"),a("item_id","char(8)"),a("source_system","varchar(50)"),a("source_namespace","varchar(100)"),u("source_identifier","varchar(191)"),u("INSERT_USER","varchar(100)","NO","utf8mb4_unicode_ci"),u("INSERT_TIME","char(19)","NO","utf8mb4_unicode_ci"),u("UPDATE_USER","varchar(100)","NO","utf8mb4_unicode_ci"),u("UPDATE_TIME","char(19)","NO","utf8mb4_unicode_ci")], keySignatures: ["PRIMARY:item_definition_import_id","UNIQUE:source_system,source_namespace,source_identifier","FOREIGN:item_id->canonical_item_definitions(item_id)"] },
  { table: "object_identities", columns: [a("object_identity_id","char(8)"),a("object_type","varchar(50)")], keySignatures: ["PRIMARY:object_identity_id"] },
  { table: "object_identity_crosswalks", columns: [a("object_identity_crosswalk_id","char(8)"),a("object_identity_id","char(8)"),a("source_system","varchar(50)"),a("source_namespace","varchar(100)"),u("source_identifier","varchar(191)"),a("payload_fingerprint","char(64)","YES")], keySignatures: ["PRIMARY:object_identity_crosswalk_id","UNIQUE:source_system,source_namespace,source_identifier","FOREIGN:object_identity_id->object_identities(object_identity_id)"] },
  { table: "data_migration_common_staging_runs", columns: [a("common_staging_run_id","char(8)"),a("raw_bundle_sha256","char(64)"),a("snapshot_manifest_sha256","char(64)"),a("extraction_manifest_sha256","char(64)"),a("staging_sha256","char(64)"),c("expected_file_count","int(10) unsigned","NO"),c("expected_total_bytes","bigint(20) unsigned","NO"),c("projected_file_count","int(10) unsigned","NO"),c("ignored_file_count","int(10) unsigned","NO"),a("run_status","varchar(16)")], keySignatures: ["PRIMARY:common_staging_run_id","UNIQUE:raw_bundle_sha256,extraction_manifest_sha256"] },
  { table: "data_migration_common_staging_records", columns: [a("common_staging_record_id","char(8)"),a("common_staging_run_id","char(8)"),a("source_system","varchar(50)"),a("source_namespace","varchar(100)"),a("source_path_sha256","char(64)"),a("source_content_sha256","char(64)"),u("logical_source_name","varchar(191)"),u("source_pointer","varchar(1024)"),u("identity_pointer","varchar(1024)"),a("source_locator_sha256","char(64)"),a("projection_status","varchar(16)"),a("record_domain","varchar(50)"),a("record_kind","varchar(50)"),u("payload_json","longtext"),a("payload_fingerprint","char(64)")], keySignatures: ["PRIMARY:common_staging_record_id","UNIQUE:common_staging_run_id,source_locator_sha256","FOREIGN:common_staging_run_id->data_migration_common_staging_runs(common_staging_run_id)"] },
  { table: "data_migration_catalog_projection_runs", columns: [a("catalog_projection_run_id","char(8)"),a("common_staging_run_id","char(8)"),a("catalog_version","varchar(50)"),a("projection_manifest_sha256","char(64)"),a("target_schema_sha256","char(64)"),a("projection_sha256","char(64)"),a("upstream_envelope_sha256","char(64)"),c("expected_source_count","int(10) unsigned","NO"),c("projected_source_count","int(10) unsigned","NO"),c("quarantined_source_count","int(10) unsigned","NO"),c("ignored_source_count","int(10) unsigned","NO"),c("projected_row_count","int(10) unsigned","NO"),a("run_status","varchar(16)")], keySignatures: ["PRIMARY:catalog_projection_run_id","UNIQUE:common_staging_run_id,catalog_version,projection_manifest_sha256","FOREIGN:common_staging_run_id->data_migration_common_staging_runs(common_staging_run_id)"] },
  { table: "data_migration_catalog_source_decisions", columns: [a("catalog_source_decision_id","char(8)"),a("catalog_projection_run_id","char(8)"),a("common_staging_record_id","char(8)"),a("source_locator_sha256","char(64)"),a("source_payload_fingerprint","char(64)"),a("record_domain","varchar(50)"),a("decision_status","varchar(16)"),a("decision_reason","varchar(191)","YES"),c("projected_row_count","int(10) unsigned","NO"),a("decision_fingerprint","char(64)")], keySignatures: ["PRIMARY:catalog_source_decision_id","UNIQUE:catalog_source_decision_id,catalog_projection_run_id","UNIQUE:catalog_projection_run_id,common_staging_record_id","UNIQUE:catalog_projection_run_id,source_locator_sha256","FOREIGN:catalog_projection_run_id->data_migration_catalog_projection_runs(catalog_projection_run_id)","FOREIGN:common_staging_record_id->data_migration_common_staging_records(common_staging_record_id)"] },
  { table: "data_migration_catalog_projection_records", columns: [a("catalog_projection_record_id","char(8)"),a("catalog_projection_run_id","char(8)"),a("catalog_source_decision_id","char(8)"),u("projection_locator","varchar(191)"),a("identity_locator_sha256","char(64)"),a("identity_mode","varchar(16)"),a("target_table_name","varchar(100)"),a("target_pk_column_name","varchar(100)"),a("target_object_type","varchar(50)"),a("target_source_namespace","varchar(100)"),a("source_role","varchar(50)","YES"),a("approval_kind","varchar(32)","YES"),a("approval_sha256","char(64)","YES"),u("target_payload_json","longtext"),a("target_payload_fingerprint","char(64)"),u("value_origins_json","longtext"),a("value_origins_fingerprint","char(64)"),u("reference_bindings_json","longtext"),a("reference_bindings_fingerprint","char(64)")], keySignatures: ["PRIMARY:catalog_projection_record_id","UNIQUE:catalog_source_decision_id,projection_locator,target_table_name","UNIQUE:catalog_projection_run_id,target_source_namespace,identity_locator_sha256","FOREIGN:catalog_projection_run_id->data_migration_catalog_projection_runs(catalog_projection_run_id)","FOREIGN:catalog_source_decision_id->data_migration_catalog_source_decisions(catalog_source_decision_id)","FOREIGN:catalog_source_decision_id,catalog_projection_run_id->data_migration_catalog_source_decisions(catalog_source_decision_id,catalog_projection_run_id)"] },
  { table: "data_migration_object_domain_import_runs", columns: [a("object_domain_import_run_id","char(8)"),a("catalog_projection_run_id","char(8)"),a("catalog_version","varchar(50)"),a("catalog_projection_sha256","char(64)"),a("upstream_envelope_sha256","char(64)"),a("target_schema_sha256","char(64)"),a("import_contract_sha256","char(64)"),a("import_sha256","char(64)"),c("expected_source_count","int(10) unsigned","NO"),c("projected_source_count","int(10) unsigned","NO"),c("quarantined_source_count","int(10) unsigned","NO"),c("ignored_source_count","int(10) unsigned","NO"),c("expected_row_count","int(10) unsigned","NO"),c("imported_row_count","int(10) unsigned","NO"),a("run_status","varchar(16)")], keySignatures: ["PRIMARY:object_domain_import_run_id","UNIQUE:catalog_projection_run_id,catalog_version,import_contract_sha256","FOREIGN:catalog_projection_run_id->data_migration_catalog_projection_runs(catalog_projection_run_id)"] },
  { table: "data_migration_object_domain_import_decisions", columns: [a("object_domain_import_decision_id","char(8)"),a("object_domain_import_run_id","char(8)"),a("catalog_source_decision_id","char(8)"),a("source_locator_sha256","char(64)"),a("decision_status","varchar(16)"),a("decision_reason","varchar(191)","YES"),c("projected_row_count","int(10) unsigned","NO"),a("decision_fingerprint","char(64)")], keySignatures: ["PRIMARY:object_domain_import_decision_id","UNIQUE:object_domain_import_run_id,catalog_source_decision_id","FOREIGN:object_domain_import_run_id->data_migration_object_domain_import_runs(object_domain_import_run_id)","FOREIGN:catalog_source_decision_id->data_migration_catalog_source_decisions(catalog_source_decision_id)"] },
  { table: "data_migration_object_domain_import_records", columns: [a("object_domain_import_record_id","char(8)"),a("object_domain_import_run_id","char(8)"),a("catalog_projection_record_id","char(8)"),a("target_table_name","varchar(100)"),a("target_pk_column_name","varchar(100)"),a("target_pk_value","char(8)"),a("identity_locator_sha256","char(64)"),c("import_order","int(10) unsigned","NO"),a("binding_fingerprint","char(64)"),a("imported_row_fingerprint","char(64)")], keySignatures: ["PRIMARY:object_domain_import_record_id","UNIQUE:object_domain_import_run_id,catalog_projection_record_id","UNIQUE:object_domain_import_run_id,import_order","UNIQUE:object_domain_import_run_id,target_table_name,target_pk_value","FOREIGN:object_domain_import_run_id->data_migration_object_domain_import_runs(object_domain_import_run_id)","FOREIGN:catalog_projection_record_id->data_migration_catalog_projection_records(catalog_projection_record_id)"] }
] as const;

async function assertSchema(transaction: QueryOnly): Promise<void> {
  const schemaTables = ITEM25_USED_SCHEMA_CONTRACT.map((entry) => entry.table);
  const columns = await transaction.query<SchemaRow[]>(`SELECT TABLE_NAME table_name,COLUMN_NAME column_name,COLUMN_TYPE column_type,IS_NULLABLE is_nullable,CHARACTER_SET_NAME character_set_name,COLLATION_NAME collation_name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${schemaTables.map(() => "?").join(",")})`, schemaTables);
  const byColumn = new Map(columns.map((row) => [`${row.table_name}.${row.column_name}`, row]));
  for (const table of ITEM25_USED_SCHEMA_CONTRACT) for (const expected of table.columns) {
    const key = `${table.table}.${expected.name}`;
    const actual = byColumn.get(key);
    if (actual === undefined) throw new Error(`ITEM25_SCHEMA_CONTRACT_COLUMN_MISSING:${key}`);
    if (actual.column_type.toLowerCase() !== expected.columnType || actual.is_nullable !== expected.nullable || actual.character_set_name !== expected.charset || actual.collation_name !== expected.collation) throw new Error(`ITEM25_SCHEMA_COLUMN_DRIFT:${key}`);
  }
  const keys = await transaction.query<KeyRow[]>(`SELECT tc.TABLE_NAME table_name,tc.CONSTRAINT_NAME constraint_name,tc.CONSTRAINT_TYPE constraint_type,kcu.COLUMN_NAME column_name,kcu.ORDINAL_POSITION ordinal_position,kcu.REFERENCED_TABLE_NAME referenced_table_name,kcu.REFERENCED_COLUMN_NAME referenced_column_name FROM information_schema.TABLE_CONSTRAINTS tc JOIN information_schema.KEY_COLUMN_USAGE kcu ON kcu.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA AND kcu.TABLE_NAME=tc.TABLE_NAME AND kcu.CONSTRAINT_NAME=tc.CONSTRAINT_NAME WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.TABLE_NAME IN (${schemaTables.map(() => "?").join(",")})`, schemaTables);
  for (const table of ITEM25_USED_SCHEMA_CONTRACT) {
    const groups = new Map<string, KeyRow[]>();
    for (const row of keys.filter((candidate) => candidate.table_name === table.table && ["PRIMARY KEY","UNIQUE","FOREIGN KEY"].includes(candidate.constraint_type))) {
      const grouped = groups.get(row.constraint_name) ?? []; grouped.push(row); groups.set(row.constraint_name, grouped);
    }
    const actual = [...groups.values()].map((rows) => {
      const ordered = rows.sort((left, right) => Number(left.ordinal_position) - Number(right.ordinal_position));
      const columns = ordered.map((row) => row.column_name).join(",");
      if (ordered[0]!.constraint_type === "PRIMARY KEY") return `PRIMARY:${columns}`;
      if (ordered[0]!.constraint_type === "UNIQUE") return `UNIQUE:${columns}`;
      return `FOREIGN:${columns}->${ordered[0]!.referenced_table_name}(${ordered.map((row) => row.referenced_column_name).join(",")})`;
    }).sort();
    if (stable(actual) !== stable([...table.keySignatures].sort())) throw new Error(`ITEM25_SCHEMA_KEY_SET_DRIFT:${table.table}`);
  }
}

async function assertCompleteLineageEnvelopes(transaction: QueryOnly, manifest: Item25CanonicalDefinitionManifest): Promise<void> {
  const placeholders = manifest.entries.map(() => "?").join(",");
  const runs = await transaction.query<ProjectionRunEvidence[]>(`SELECT DISTINCT run.catalog_projection_run_id,run.common_staging_run_id,run.catalog_version,run.projection_manifest_sha256,run.target_schema_sha256,run.projection_sha256,run.upstream_envelope_sha256,run.expected_source_count,run.projected_source_count,run.quarantined_source_count,run.ignored_source_count,run.projected_row_count,run.run_status FROM data_migration_catalog_projection_records record JOIN data_migration_catalog_projection_runs run ON run.catalog_projection_run_id=record.catalog_projection_run_id WHERE record.projection_locator IN (${placeholders})`, manifest.entries.map((entry) => entry.sourcePointer));
  if (runs.length !== 1) throw new Error("ITEM25_PROJECTION_RUN_AMBIGUOUS");
  const run = runs[0]!;
  if (run.run_status !== "COMPLETE" || run.catalog_version !== manifest.catalogVersion || run.target_schema_sha256 !== AUTHORITATIVE_TARGET_SCHEMA_SHA256 || !HASH.test(run.projection_manifest_sha256) || !HASH.test(run.projection_sha256) || !HASH.test(run.upstream_envelope_sha256)) throw new Error("ITEM25_PROJECTION_RUN_INVALID");

  const stagingRuns = await transaction.query<StagingRunEvidence[]>("SELECT common_staging_run_id,raw_bundle_sha256,snapshot_manifest_sha256,extraction_manifest_sha256,staging_sha256,expected_file_count,CAST(expected_total_bytes AS CHAR) expected_total_bytes,projected_file_count,ignored_file_count,run_status FROM data_migration_common_staging_runs WHERE common_staging_run_id=?", [run.common_staging_run_id]);
  if (stagingRuns.length !== 1 || stagingRuns[0]!.run_status !== "COMPLETE") throw new Error("ITEM25_STAGING_RUN_INVALID");
  const staging = stagingRuns[0]!;
  for (const value of [staging.raw_bundle_sha256, staging.snapshot_manifest_sha256, staging.extraction_manifest_sha256, staging.staging_sha256]) if (!HASH.test(value)) throw new Error("ITEM25_STAGING_RUN_HASH_INVALID");
  const expectedEnvelope = sha256(stable({ expectedFileCount: Number(staging.expected_file_count), expectedTotalBytes: String(staging.expected_total_bytes), extractionManifestSha256: staging.extraction_manifest_sha256, ignoredFileCount: Number(staging.ignored_file_count), projectedFileCount: Number(staging.projected_file_count), rawBundleSha256: staging.raw_bundle_sha256, snapshotManifestSha256: staging.snapshot_manifest_sha256, stagingSha256: staging.staging_sha256 }));
  if (expectedEnvelope !== run.upstream_envelope_sha256) throw new Error("ITEM25_UPSTREAM_ENVELOPE_DRIFT");

  const decisions = await transaction.query<DecisionEvidence[]>("SELECT catalog_source_decision_id,source_locator_sha256,source_payload_fingerprint,record_domain,decision_status,decision_reason,projected_row_count,decision_fingerprint FROM data_migration_catalog_source_decisions WHERE catalog_projection_run_id=? ORDER BY catalog_source_decision_id", [run.catalog_projection_run_id]);
  const stagingLineageRuns = await transaction.query<Array<{ catalog_source_decision_id: string; common_staging_run_id: string }>>("SELECT decision.catalog_source_decision_id,staging.common_staging_run_id FROM data_migration_catalog_source_decisions decision JOIN data_migration_common_staging_records staging ON staging.common_staging_record_id=decision.common_staging_record_id WHERE decision.catalog_projection_run_id=? ORDER BY decision.catalog_source_decision_id", [run.catalog_projection_run_id]);
  if (stagingLineageRuns.length !== ITEM25_DEFINITION_COUNT || stagingLineageRuns.some((row) => row.common_staging_run_id !== run.common_staging_run_id) || new Set(stagingLineageRuns.map((row) => row.catalog_source_decision_id)).size !== ITEM25_DEFINITION_COUNT) throw new Error("ITEM25_STAGING_RUN_LINEAGE_DRIFT");
  const projections = await transaction.query<ProjectionEvidence[]>("SELECT catalog_projection_record_id,catalog_source_decision_id,projection_locator,identity_locator_sha256,identity_mode,target_table_name,target_pk_column_name,target_object_type,target_source_namespace,source_role,approval_kind,approval_sha256,CAST(target_payload_json AS CHAR) target_payload_json,target_payload_fingerprint,CAST(value_origins_json AS CHAR) value_origins_json,value_origins_fingerprint,CAST(reference_bindings_json AS CHAR) reference_bindings_json,reference_bindings_fingerprint FROM data_migration_catalog_projection_records WHERE catalog_projection_run_id=? ORDER BY catalog_projection_record_id", [run.catalog_projection_run_id]);
  const counts = { PROJECT: 0, QUARANTINE: 0, IGNORE: 0 };
  const projectionsByDecision = new Map<string, ProjectionEvidence[]>();
  for (const projection of projections) {
    if (sha256(projection.target_payload_json) !== projection.target_payload_fingerprint || sha256(projection.value_origins_json) !== projection.value_origins_fingerprint || sha256(projection.reference_bindings_json) !== projection.reference_bindings_fingerprint) throw new Error("ITEM25_PROJECTION_RECORD_FINGERPRINT_DRIFT");
    const current = projectionsByDecision.get(projection.catalog_source_decision_id) ?? [];
    current.push(projection); projectionsByDecision.set(projection.catalog_source_decision_id, current);
  }
  const projectedDecisions = decisions.map((decision) => {
    if (!(decision.decision_status in counts)) throw new Error("ITEM25_DECISION_STATUS_INVALID");
    counts[decision.decision_status as keyof typeof counts] += 1;
    const outputs = (projectionsByDecision.get(decision.catalog_source_decision_id) ?? []).sort((left, right) => `${left.target_table_name}\0${left.projection_locator}`.localeCompare(`${right.target_table_name}\0${right.projection_locator}`, "en")).map((row) => ({ projectionLocator: row.projection_locator, identityLocatorSha256: row.identity_locator_sha256, identityMode: row.identity_mode, targetTable: row.target_table_name, targetPkColumn: row.target_pk_column_name, targetObjectType: row.target_object_type, targetSourceNamespace: row.target_source_namespace, sourceRole: row.source_role, approvalKind: row.approval_kind, approvalSha256: row.approval_sha256, targetPayloadJson: row.target_payload_json, targetPayloadFingerprint: row.target_payload_fingerprint, valueOriginsJson: row.value_origins_json, valueOriginsFingerprint: row.value_origins_fingerprint, referenceBindingsJson: row.reference_bindings_json, referenceBindingsFingerprint: row.reference_bindings_fingerprint }));
    if (outputs.length !== Number(decision.projected_row_count) || (decision.decision_status !== "PROJECT" && outputs.length !== 0)) throw new Error("ITEM25_DECISION_ROW_COUNT_INVALID");
    const body = { sourceLocatorSha256: decision.source_locator_sha256, sourcePayloadFingerprint: decision.source_payload_fingerprint, recordDomain: decision.record_domain, decisionStatus: decision.decision_status, decisionReason: decision.decision_reason, outputs };
    if (sha256(stable(body)) !== decision.decision_fingerprint) throw new Error("ITEM25_DECISION_FINGERPRINT_DRIFT");
    return { ...body, decisionFingerprint: decision.decision_fingerprint };
  }).sort((left, right) => left.sourceLocatorSha256.localeCompare(right.sourceLocatorSha256, "en"));
  if (decisions.length !== Number(run.expected_source_count) || counts.PROJECT !== Number(run.projected_source_count) || counts.QUARANTINE !== Number(run.quarantined_source_count) || counts.IGNORE !== Number(run.ignored_source_count) || projections.length !== Number(run.projected_row_count) || sha256(stable(projectedDecisions)) !== run.projection_sha256) throw new Error("ITEM25_PROJECTION_ENVELOPE_DRIFT");

  const importRuns = await transaction.query<ImportRunEvidence[]>("SELECT object_domain_import_run_id,catalog_version,catalog_projection_sha256,upstream_envelope_sha256,target_schema_sha256,import_contract_sha256,import_sha256,expected_source_count,projected_source_count,quarantined_source_count,ignored_source_count,expected_row_count,imported_row_count,run_status FROM data_migration_object_domain_import_runs WHERE catalog_projection_run_id=?", [run.catalog_projection_run_id]);
  if (importRuns.length !== 1) throw new Error("ITEM25_DOMAIN_IMPORT_RUN_INVALID");
  const importRun = importRuns[0]!;
  if (importRun.run_status !== "COMPLETE" || importRun.catalog_version !== manifest.catalogVersion || importRun.catalog_projection_sha256 !== run.projection_sha256 || importRun.upstream_envelope_sha256 !== run.upstream_envelope_sha256 || importRun.target_schema_sha256 !== AUTHORITATIVE_TARGET_SCHEMA_SHA256 || !ACCEPTED_IMPORT_CONTRACT_SHA256.includes(importRun.import_contract_sha256 as typeof ACCEPTED_IMPORT_CONTRACT_SHA256[number]) || Number(importRun.expected_source_count) !== decisions.length || Number(importRun.projected_source_count) !== counts.PROJECT || Number(importRun.quarantined_source_count) !== counts.QUARANTINE || Number(importRun.ignored_source_count) !== counts.IGNORE || Number(importRun.expected_row_count) !== projections.length || Number(importRun.imported_row_count) !== projections.length) throw new Error("ITEM25_DOMAIN_IMPORT_RUN_INVALID");
  const calculatedImport = calculateObjectDomainParityImportSha256({ catalogProjectionRunId: run.catalog_projection_run_id, projectionManifestSha256: run.projection_manifest_sha256, projectionSha256: run.projection_sha256, upstreamEnvelopeSha256: run.upstream_envelope_sha256, targetSchemaSha256: run.target_schema_sha256, decisions: decisions.map((decision) => ({ id: decision.catalog_source_decision_id, fingerprint: decision.decision_fingerprint })), rows: projections.map((projection) => ({ id: projection.catalog_projection_record_id, fingerprint: sha256(stable({ targetTable: projection.target_table_name, targetPkColumn: projection.target_pk_column_name, targetObjectType: projection.target_object_type, targetSourceNamespace: projection.target_source_namespace, identityLocatorSha256: projection.identity_locator_sha256, targetPayloadFingerprint: projection.target_payload_fingerprint, valueOriginsFingerprint: projection.value_origins_fingerprint, referenceBindingsFingerprint: projection.reference_bindings_fingerprint, approvalKind: projection.approval_kind, approvalSha256: projection.approval_sha256 })) })) }, importRun.import_contract_sha256);
  if (calculatedImport !== importRun.import_sha256) throw new Error("ITEM25_DOMAIN_IMPORT_FINGERPRINT_DRIFT");
  const receipts = await transaction.query<DecisionReceiptEvidence[]>("SELECT catalog_source_decision_id,source_locator_sha256,decision_status,decision_reason,projected_row_count,decision_fingerprint FROM data_migration_object_domain_import_decisions WHERE object_domain_import_run_id=? ORDER BY catalog_source_decision_id", [importRun.object_domain_import_run_id]);
  const normalizedReceipts = receipts.map((row) => ({ ...row, projected_row_count: Number(row.projected_row_count) }));
  const expectedReceipts = decisions.map(({ catalog_source_decision_id, source_locator_sha256, decision_status, decision_reason, projected_row_count, decision_fingerprint }) => ({ catalog_source_decision_id, source_locator_sha256, decision_status, decision_reason, projected_row_count: Number(projected_row_count), decision_fingerprint }));
  if (stable(normalizedReceipts) !== stable(expectedReceipts)) throw new Error("ITEM25_DOMAIN_DECISION_RECEIPT_DRIFT");
  const itemLocators = new Set(manifest.entries.map((entry) => entry.sourceLocatorSha256));
  const itemReceipts = receipts.filter((receipt) => itemLocators.has(receipt.source_locator_sha256));
  if (itemReceipts.length !== ITEM25_DEFINITION_COUNT || new Set(manifest.entries.map((entry) => entry.itemKind)).size !== 3) throw new Error("ITEM25_DOMAIN_DECISION_RECEIPT_COVERAGE_INVALID");
}

function expectedTargetPayload(entry: Item25CanonicalDefinitionManifestEntry, row: LineageRow): Record<string, unknown> {
  const payload = parseObject(row.target_payload_json!, "ITEM25_PROJECTION_PAYLOAD_INVALID");
  const options = payload.definition_options;
  if (options === null || typeof options !== "object" || Array.isArray(options) || sha256(stable(options)) !== entry.definitionOptionsSha256) throw new Error("ITEM25_DEFINITION_OPTIONS_DRIFT");
  if (payload.item_kind !== entry.itemKind || payload.item_description !== null || payload.item_grade !== null || payload.price_amount !== null || payload.price_currency_source_identifier !== null || payload.stackable_flag !== true || payload.active_flag !== true || typeof payload.item_name !== "string" || payload.item_name.length === 0) throw new Error("ITEM25_PROJECTION_PAYLOAD_DRIFT");
  return payload;
}

async function inspect(transaction: QueryOnly, manifest: Item25CanonicalDefinitionManifest, lock: boolean): Promise<{ itemByPointer: Map<string, string>; imports: ImportRow[] }> {
  assertItem25CanonicalDefinitionManifest(manifest);
  await assertSchema(transaction);
  await assertCompleteLineageEnvelopes(transaction, manifest);
  const placeholders = manifest.entries.map(() => "?").join(",");
  const lockSql = lock ? " FOR UPDATE" : "";
  const lineage = await transaction.query<LineageRow[]>(`SELECT definition.item_id,definition.item_name,definition.item_description,definition.item_kind,definition.item_grade,CAST(definition.price_amount AS CHAR) price_amount,definition.price_currency_source_identifier,definition.stackable_flag,definition.active_flag,CAST(definition.definition_options AS CHAR) definition_options,identity.object_type,crosswalk.source_identifier crosswalk_source_identifier,crosswalk.payload_fingerprint crosswalk_payload_fingerprint,receipt.object_domain_import_record_id,receipt.binding_fingerprint receipt_binding_fingerprint,receipt.imported_row_fingerprint,import_run.run_status,projection.projection_locator,projection.identity_locator_sha256,projection.identity_mode,projection.target_table_name,projection.target_pk_column_name,projection.target_object_type,projection.target_source_namespace,projection.approval_kind,projection.approval_sha256,CAST(projection.target_payload_json AS CHAR) target_payload_json,projection.target_payload_fingerprint,CAST(projection.value_origins_json AS CHAR) value_origins_json,projection.value_origins_fingerprint,CAST(projection.reference_bindings_json AS CHAR) reference_bindings_json,projection.reference_bindings_fingerprint,decision.source_locator_sha256 decision_source_locator_sha256,decision.source_payload_fingerprint decision_source_payload_fingerprint,decision.decision_status,decision.projected_row_count decision_projected_row_count,staging.source_system staging_source_system,staging.source_namespace staging_source_namespace,staging.source_path_sha256,staging.source_content_sha256,staging.logical_source_name,staging.source_pointer,staging.identity_pointer,staging.source_locator_sha256 staging_source_locator_sha256,staging.projection_status,staging.record_domain,staging.record_kind,CAST(staging.payload_json AS CHAR) payload_json,staging.payload_fingerprint staging_payload_fingerprint FROM object_identity_crosswalks crosswalk JOIN object_identities identity ON identity.object_identity_id=crosswalk.object_identity_id JOIN canonical_item_definitions definition ON definition.item_id=crosswalk.object_identity_id LEFT JOIN data_migration_object_domain_import_records receipt ON receipt.target_table_name='canonical_item_definitions' AND receipt.target_pk_column_name='item_id' AND receipt.target_pk_value=definition.item_id AND receipt.identity_locator_sha256=crosswalk.source_identifier LEFT JOIN data_migration_object_domain_import_runs import_run ON import_run.object_domain_import_run_id=receipt.object_domain_import_run_id LEFT JOIN data_migration_catalog_projection_records projection ON projection.catalog_projection_record_id=receipt.catalog_projection_record_id LEFT JOIN data_migration_catalog_source_decisions decision ON decision.catalog_source_decision_id=projection.catalog_source_decision_id LEFT JOIN data_migration_common_staging_records staging ON staging.common_staging_record_id=decision.common_staging_record_id WHERE crosswalk.source_system='LEGACY_JSON' AND crosswalk.source_namespace=? AND crosswalk.source_identifier IN (${placeholders}) ORDER BY crosswalk.source_identifier,receipt.object_domain_import_record_id${lockSql}`, [manifest.identitySourceNamespace, ...manifest.entries.map((entry) => entry.sourceLocatorSha256)]);
  if (lineage.length !== ITEM25_DEFINITION_COUNT) throw new Error("ITEM25_CANONICAL_LINEAGE_COUNT_DRIFT");
  const byLocator = new Map<string, LineageRow>();
  const itemByPointer = new Map<string, string>();
  for (const row of lineage) {
    if (byLocator.has(row.crosswalk_source_identifier)) throw new Error("ITEM25_CANONICAL_LINEAGE_AMBIGUOUS");
    byLocator.set(row.crosswalk_source_identifier, row);
  }
  for (const entry of manifest.entries) {
    const row = byLocator.get(entry.sourceLocatorSha256);
    if (row === undefined || !CUID.test(row.item_id) || row.object_type !== OBJECT_TYPE || row.item_kind !== entry.itemKind || row.crosswalk_payload_fingerprint === null || !HASH.test(row.crosswalk_payload_fingerprint)) throw new Error("ITEM25_CANONICAL_BINDING_DRIFT");
    if (row.object_domain_import_record_id === null || row.run_status !== "COMPLETE" || row.receipt_binding_fingerprint === null || row.crosswalk_payload_fingerprint !== row.receipt_binding_fingerprint || row.imported_row_fingerprint === null || !HASH.test(row.imported_row_fingerprint)) throw new Error("ITEM25_DOMAIN_RECEIPT_DRIFT");
    if (row.projection_locator !== entry.sourcePointer || row.identity_locator_sha256 !== entry.sourceLocatorSha256 || row.identity_mode !== "GENERATED" || row.target_table_name !== "canonical_item_definitions" || row.target_pk_column_name !== "item_id" || row.target_object_type !== OBJECT_TYPE || row.target_source_namespace !== manifest.identitySourceNamespace || row.approval_kind !== "CATALOG_PROVENANCE" || row.approval_sha256 !== APPROVED_SCOPE_SHA256[entry.itemKind]) throw new Error("ITEM25_PROJECTION_RECEIPT_DRIFT");
    if (row.target_payload_json === null || row.target_payload_fingerprint !== sha256(row.target_payload_json) || row.value_origins_json === null || row.value_origins_fingerprint !== sha256(row.value_origins_json) || row.reference_bindings_json === null || row.reference_bindings_fingerprint !== sha256(row.reference_bindings_json)) throw new Error("ITEM25_PROJECTION_FINGERPRINT_DRIFT");
    const payload = expectedTargetPayload(entry, row);
    const definitionOptions = parseObject(row.definition_options, "ITEM25_DEFINITION_OPTIONS_INVALID");
    if (sha256(stable(definitionOptions)) !== entry.definitionOptionsSha256 || stable(definitionOptions) !== stable(payload.definition_options)) throw new Error("ITEM25_DEFINITION_OPTIONS_DRIFT");
    if (row.item_name !== payload.item_name || row.item_description !== payload.item_description || row.item_grade !== payload.item_grade || row.price_amount !== payload.price_amount || row.price_currency_source_identifier !== payload.price_currency_source_identifier || ![true, 1, 1n, "1"].includes(row.stackable_flag) || ![true, 1, 1n, "1"].includes(row.active_flag)) throw new Error("ITEM25_CANONICAL_DEFINITION_DRIFT");
    const origins = parseObject(row.value_origins_json, "ITEM25_VALUE_ORIGINS_INVALID");
    const references = parseLossless(row.reference_bindings_json);
    if (!Array.isArray(references) || references.length !== 0 || origins.definition_options !== "SOURCE_EXACT" || origins.item_name !== "SOURCE_EXACT" || origins.item_kind !== "APPROVED_CATALOG") throw new Error("ITEM25_PROJECTION_CONTRACT_DRIFT");
    const binding = sha256(stable({ targetTable: "canonical_item_definitions", targetPkColumn: "item_id", targetObjectType: OBJECT_TYPE, targetSourceNamespace: manifest.identitySourceNamespace, identityLocatorSha256: entry.sourceLocatorSha256, targetPayloadFingerprint: row.target_payload_fingerprint, valueOriginsFingerprint: row.value_origins_fingerprint, referenceBindingsFingerprint: row.reference_bindings_fingerprint, approvalKind: row.approval_kind, approvalSha256: row.approval_sha256 }));
    if (binding !== row.receipt_binding_fingerprint) throw new Error("ITEM25_DOMAIN_RECEIPT_BINDING_DRIFT");
    if (sha256(stable({ table: "canonical_item_definitions", pkColumn: "item_id", pk: row.item_id, payload, references: {} })) !== row.imported_row_fingerprint) throw new Error("ITEM25_DOMAIN_RECEIPT_ROW_DRIFT");
    if (row.decision_source_locator_sha256 !== entry.sourceLocatorSha256 || row.decision_source_payload_fingerprint !== entry.sourcePayloadFingerprint || row.decision_status !== "PROJECT" || Number(row.decision_projected_row_count) !== 1) throw new Error("ITEM25_CATALOG_DECISION_DRIFT");
    if (row.staging_source_system !== manifest.sourceSystem || row.staging_source_namespace !== manifest.sourceNamespace || row.source_path_sha256 !== manifest.sourcePathSha256 || row.source_content_sha256 !== manifest.sourceContentSha256 || row.logical_source_name !== LOGICAL_SOURCE_NAME || row.source_pointer !== entry.sourcePointer || row.identity_pointer !== entry.sourcePointer || row.staging_source_locator_sha256 !== entry.sourceLocatorSha256 || row.projection_status !== "PROJECT" || row.record_domain !== "ITEM" || row.staging_payload_fingerprint !== entry.sourcePayloadFingerprint || row.payload_json === null || sha256(stable(parseObject(row.payload_json, "ITEM25_STAGING_PAYLOAD_INVALID"))) !== entry.sourcePayloadFingerprint || kindFor(row.record_kind ?? "", entry.sourcePointer) !== entry.itemKind) throw new Error("ITEM25_STAGING_RECEIPT_DRIFT");
    itemByPointer.set(entry.sourcePointer, row.item_id);
  }
  if (new Set(itemByPointer.values()).size !== ITEM25_DEFINITION_COUNT) throw new Error("ITEM25_CANONICAL_ITEM_ID_DUPLICATE");
  const imports = await transaction.query<ImportRow[]>(`SELECT item_definition_import_id,item_id,source_identifier FROM canonical_item_definition_imports WHERE source_system=? AND source_namespace=? AND source_identifier IN (${placeholders}) ORDER BY source_identifier${lockSql}`, [manifest.sourceSystem, manifest.sourceNamespace, ...manifest.entries.map((entry) => entry.sourcePointer)]);
  return { itemByPointer, imports };
}

function assertExactImports(state: Awaited<ReturnType<typeof inspect>>, manifest: Item25CanonicalDefinitionManifest): void {
  if (state.imports.length !== ITEM25_DEFINITION_COUNT) throw new Error("ITEM25_IMPORT_BINDING_PARTIAL_STATE");
  const byPointer = new Map(state.imports.map((row) => [row.source_identifier, row]));
  if (byPointer.size !== ITEM25_DEFINITION_COUNT) throw new Error("ITEM25_IMPORT_BINDING_DUPLICATE");
  for (const entry of manifest.entries) {
    const row = byPointer.get(entry.sourcePointer);
    if (row === undefined || !CUID.test(row.item_definition_import_id) || row.item_id !== state.itemByPointer.get(entry.sourcePointer)) throw new Error("ITEM25_IMPORT_BINDING_DRIFT");
  }
}

async function insertWithCuidRetry(transaction: DatabaseTransaction, values: (candidate: string) => readonly unknown[], generate: ObjectIdentityCandidateGenerator, maximumAttempts: number): Promise<void> {
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    const candidate = generate();
    assertObjectIdentityCandidate(candidate);
    try {
      const result = await transaction.execute("INSERT INTO canonical_item_definition_imports(item_definition_import_id,item_id,source_system,source_namespace,source_identifier,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES(?,?,?,?,?,?,?,?,?)", values(candidate));
      if (result.affectedRows !== 1n) throw new Error("ITEM25_IMPORT_BINDING_INSERT_COUNT_INVALID");
      return;
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
      const message = typeof error === "object" && error !== null && "message" in error ? String(error.message) : "";
      if (code !== "ER_DUP_ENTRY" || !/(?:for key|key) ['"`](?:[a-z0-9_]+\.)?PRIMARY['"`]/i.test(message)) throw error;
    }
  }
  throw new Error("ITEM25_IMPORT_BINDING_CUID_COLLISION_RETRY_EXHAUSTED");
}

function isRetryableConcurrentConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? String(error.code) : "";
  const message = "message" in error ? String(error.message) : "";
  return ["ER_CHECKREAD", "ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(code) || (code === "ER_DUP_ENTRY" && !/(?:for key|key) ['"`](?:[a-z0-9_]+\.)?PRIMARY['"`]/i.test(message));
}

export class MariaItem25CanonicalDefinitionProvider {
  constructor(
    private readonly database: DatabaseClient,
    private readonly generate: ObjectIdentityCandidateGenerator = createObjectIdentityCandidate,
    private readonly maximumAttempts = OBJECT_IDENTITY_MAX_ATTEMPTS,
    private readonly now: () => Date = () => new Date()
  ) {
    if (!Number.isInteger(maximumAttempts) || maximumAttempts < 1) throw new Error("ITEM25_MAXIMUM_ATTEMPTS_INVALID");
  }

  // lineage·schema·receipt 전수 검증을 끝낸 뒤 exact source-pointer import binding만 한 transaction으로 추가합니다.
  async apply(manifest: Item25CanonicalDefinitionManifest, actor: string): Promise<Item25CanonicalDefinitionResult> {
    for (let attempt = 0; attempt < this.maximumAttempts; attempt += 1) {
      try {
        return await this.database.withTransaction(async (transaction) => {
          const state = await inspect(transaction, manifest, true);
          if (state.imports.length > 0) {
            assertExactImports(state, manifest);
            return { insertedBindings: 0, replayed: true, manifestSha256: manifest.manifestSha256 };
          }
          const audit = createObjectAuditValues(actor, this.now());
          for (const entry of manifest.entries) {
            await insertWithCuidRetry(transaction, (candidate) => [candidate, state.itemByPointer.get(entry.sourcePointer)!, manifest.sourceSystem, manifest.sourceNamespace, entry.sourcePointer, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME], this.generate, this.maximumAttempts);
          }
          const inserted = await inspect(transaction, manifest, true);
          assertExactImports(inserted, manifest);
          return { insertedBindings: ITEM25_DEFINITION_COUNT, replayed: false, manifestSha256: manifest.manifestSha256 };
        });
      } catch (error) {
        if (!isRetryableConcurrentConflict(error) || attempt + 1 === this.maximumAttempts) throw error;
      }
    }
    throw new Error("ITEM25_IMPORT_BINDING_CONCURRENT_REPLAY_EXHAUSTED");
  }

  // DML capability가 없는 repeatable-read snapshot에서 exact CUID binding과 upstream 영수증을 재검증합니다.
  async shadow(manifest: Item25CanonicalDefinitionManifest): Promise<{ exactBindings: 25; manifestSha256: string }> {
    if (!hasDatabaseTransactionCapabilities(this.database)) throw new Error("ITEM25_READ_ONLY_CAPABILITY_REQUIRED");
    return this.database.withReadOnlySnapshot(async (transaction) => {
      const state = await inspect(transaction, manifest, false);
      assertExactImports(state, manifest);
      return { exactBindings: ITEM25_DEFINITION_COUNT, manifestSha256: manifest.manifestSha256 };
    });
  }

  // provider가 소유한 exact import tuple만 제거하며 canonical 정의·identity·crosswalk·보유 stack은 보존합니다.
  async rollback(manifest: Item25CanonicalDefinitionManifest): Promise<number> {
    return this.database.withTransaction(async (transaction) => {
      const state = await inspect(transaction, manifest, true);
      if (state.imports.length === 0) return 0;
      assertExactImports(state, manifest);
      const result = await transaction.execute(`DELETE FROM canonical_item_definition_imports WHERE source_system=? AND source_namespace=? AND source_identifier IN (${manifest.entries.map(() => "?").join(",")})`, [manifest.sourceSystem, manifest.sourceNamespace, ...manifest.entries.map((entry) => entry.sourcePointer)]);
      if (result.affectedRows !== BigInt(ITEM25_DEFINITION_COUNT)) throw new Error("ITEM25_IMPORT_BINDING_ROLLBACK_COUNT_INVALID");
      return ITEM25_DEFINITION_COUNT;
    });
  }
}
