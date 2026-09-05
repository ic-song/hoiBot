import { createHash } from "node:crypto";
import { isLosslessNumber, parse as parseLossless } from "lossless-json";
import type { DatabaseClient, DatabaseTransaction, ReadOnlySnapshotTransaction } from "../database.js";
import { hasDatabaseTransactionCapabilities } from "../database.js";
import {
  createObjectAuditValues,
  MariaObjectIdentityAuditProvider,
  type ObjectIdentityCandidateGenerator
} from "../identity/object-identity-audit-provider.js";
import { calculateEquipmentGradeCommonStagingPayloadFingerprint, type EquipmentGradeSourceRecord } from "./equipment-grade-definition-adapter.js";

export const ELEMENTAL_GRADE_BRIDGE_COUNT = 61;
export const ELEMENTAL_GRADE_BRIDGE_SOURCE_NAMESPACE = "object-import.pet-equipment.canonical_equipment_grade_definitions" as const;
export const ELEMENTAL_GRADE_BRIDGE_IDENTITY_NAMESPACE = "elemental-grade-definition.bridge.v1" as const;
const HASH = /^[0-9a-f]{64}$/;
const OBJECT_TYPE = "ELEMENTAL_GRADE_DEFINITION_BRIDGE";
const NUMERIC_KEYS = [
  "upgrade", "drop", "itemCost", "pointCost", "maxLevel", "battleExp", "battleUpgradeExp",
  "raidExp", "raidUpgradeExp", "castleExp", "castleUpgradeExp"
] as const;

export interface ElementalGradeBridgeStagingRecord extends EquipmentGradeSourceRecord { gradeOrder: number; }
export interface ElementalGradeBridgeManifestEntry {
  gradeOrder: number;
  sourceIdentifier: string;
  numericTupleSha256: string;
  bindingFingerprint: string;
}
export interface ElementalGradeBridgeManifest {
  format: "hoibot-elemental-grade-definition-bridge-manifest-v1";
  catalogVersion: "SC-20260902-1";
  sourceNamespace: typeof ELEMENTAL_GRADE_BRIDGE_SOURCE_NAMESPACE;
  expectedCount: 61;
  entries: ElementalGradeBridgeManifestEntry[];
  numericOrderSha256: string;
  manifestSha256: string;
}
export interface ElementalGradeBridgeResult { insertedRows: number; replayed: boolean; manifestSha256: string; }

interface NumericRow {
  success_rate?: unknown; drop_rate?: unknown; item_cost?: unknown; point_cost?: unknown; max_level?: unknown;
  battle_exp?: unknown; battle_upgrade_exp?: unknown; raid_exp?: unknown; raid_upgrade_exp?: unknown;
  castle_exp?: unknown; castle_upgrade_exp?: unknown;
  enhancement_success_probability?: unknown; enhancement_drop_probability?: unknown; item_cost_quantity?: unknown;
  point_cost_amount?: unknown; maximum_enhancement_level?: unknown; battle_base_experience_amount?: unknown;
  battle_experience_per_enhancement_amount?: unknown; raid_base_experience_amount?: unknown;
  raid_experience_per_enhancement_amount?: unknown; castle_base_experience_amount?: unknown;
  castle_experience_per_enhancement_amount?: unknown;
}
interface LegacyRow extends NumericRow { elemental_grade_order: number | bigint | string; }
interface CanonicalRow extends NumericRow {
  equipment_grade_definition_id: string;
  equipment_family: string;
  source_identifier: string | null;
  object_type: string | null;
  payload_fingerprint: string | null;
}
interface BridgeRow {
  elemental_grade_definition_bridge_id: string;
  equipment_grade_definition_id: string;
  elemental_grade_order: number | bigint | string;
  source_identifier_sha256: string;
  binding_fingerprint: string;
  numeric_tuple_sha256: string;
  numeric_order_sha256: string;
  bridge_manifest_sha256: string;
}
interface BridgeIdentityRow {
  object_identity_id: string;
  source_identifier: string;
  payload_fingerprint: string | null;
  object_type: string;
  crosswalk_count?: number | bigint | string;
}
type QueryOnly = Pick<DatabaseTransaction, "query"> | ReadOnlySnapshotTransaction;

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
function stable(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (typeof value === "object") {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${stable(row[key])}`).join(",")}}`;
  }
  throw new Error("ELEMENTAL_GRADE_BRIDGE_VALUE_INVALID");
}

function normalizeDecimal(value: unknown): string {
  const raw = isLosslessNumber(value) ? value.toString() : typeof value === "bigint" ? value.toString() : String(value);
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(raw);
  if (match === null || match[1] === "-") throw new Error("ELEMENTAL_GRADE_BRIDGE_NUMERIC_INVALID");
  const exponent = Number(match[4] ?? "0");
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000) throw new Error("ELEMENTAL_GRADE_BRIDGE_NUMERIC_INVALID");
  let digits = `${match[2]}${match[3] ?? ""}`;
  let point = match[2]!.length + exponent;
  if (point <= 0) { digits = `${"0".repeat(-point)}${digits}`; point = 0; }
  if (point >= digits.length) digits = `${digits}${"0".repeat(point - digits.length)}`;
  let normalized = point === digits.length ? digits : `${digits.slice(0, point) || "0"}.${digits.slice(point)}`;
  let [whole, fraction] = normalized.split(".");
  whole = whole!.replace(/^0+(?=\d)/, "");
  if (fraction !== undefined) fraction = fraction.replace(/0+$/, "");
  normalized = fraction ? `${whole}.${fraction}` : whole!;
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalized)) throw new Error("ELEMENTAL_GRADE_BRIDGE_NUMERIC_INVALID");
  return normalized;
}

function stagingTuple(payloadJson: string): string[] {
  let parsed: unknown;
  try { parsed = parseLossless(payloadJson); } catch { throw new Error("ELEMENTAL_GRADE_BRIDGE_STAGING_PAYLOAD_INVALID"); }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("ELEMENTAL_GRADE_BRIDGE_STAGING_PAYLOAD_INVALID");
  const row = parsed as Record<string, unknown>;
  return NUMERIC_KEYS.map((key) => {
    if (!isLosslessNumber(row[key])) throw new Error("ELEMENTAL_GRADE_BRIDGE_STAGING_NUMERIC_INVALID");
    return normalizeDecimal(row[key]);
  });
}
function legacyTuple(row: LegacyRow): string[] {
  return [row.success_rate,row.drop_rate,row.item_cost,row.point_cost,row.max_level,row.battle_exp,row.battle_upgrade_exp,row.raid_exp,row.raid_upgrade_exp,row.castle_exp,row.castle_upgrade_exp].map(normalizeDecimal);
}
function canonicalTuple(row: CanonicalRow): string[] {
  return [row.enhancement_success_probability,row.enhancement_drop_probability,row.item_cost_quantity,row.point_cost_amount,row.maximum_enhancement_level,row.battle_base_experience_amount,row.battle_experience_per_enhancement_amount,row.raid_base_experience_amount,row.raid_experience_per_enhancement_amount,row.castle_base_experience_amount,row.castle_experience_per_enhancement_amount].map(normalizeDecimal);
}
function sourceIdentifier(record: ElementalGradeBridgeStagingRecord): string {
  return sha256(`${record.sourceLocatorSha256}\0${record.sourcePointer}\0canonical_equipment_grade_definitions`);
}
function numericOrderSha(entries: ReadonlyArray<Pick<ElementalGradeBridgeManifestEntry,"gradeOrder"|"numericTupleSha256">>): string {
  return sha256(stable(entries.map((entry) => ({ gradeOrder: entry.gradeOrder, numericTupleSha256: entry.numericTupleSha256 }))));
}
function bindingFingerprint(entry: Pick<ElementalGradeBridgeManifestEntry,"gradeOrder"|"sourceIdentifier"|"numericTupleSha256">, orderSha: string): string {
  return sha256(stable({ catalogVersion:"SC-20260902-1", gradeOrder:entry.gradeOrder, numericOrderSha256:orderSha, numericTupleSha256:entry.numericTupleSha256, sourceIdentifier:entry.sourceIdentifier }));
}
function manifestHash(manifest: Omit<ElementalGradeBridgeManifest,"manifestSha256">): string { return sha256(stable(manifest)); }
function bridgePayloadFingerprint(entry: ElementalGradeBridgeManifestEntry, manifest: ElementalGradeBridgeManifest): string {
  return sha256(stable({ ...entry, numericOrderSha256:manifest.numericOrderSha256, bridgeManifestSha256:manifest.manifestSha256 }));
}

// 봉인된 Common Staging 레코드에서 표시명 없는 61행 bridge manifest를 생성합니다.
export function buildElementalGradeBridgeManifest(records: ElementalGradeBridgeStagingRecord[]): ElementalGradeBridgeManifest {
  if (records.length !== ELEMENTAL_GRADE_BRIDGE_COUNT) throw new Error("ELEMENTAL_GRADE_BRIDGE_COUNT_INVALID");
  const draft = records.map((record) => {
    if (record.gradeOrder < 1 || record.gradeOrder > ELEMENTAL_GRADE_BRIDGE_COUNT || !Number.isInteger(record.gradeOrder)) throw new Error("ELEMENTAL_GRADE_BRIDGE_ORDER_INVALID");
    if (record.recordDomain !== "pet-equipment" || record.recordKind !== "EQUIPMENT_GRADE_DEFINITION" || record.projectionStatus !== "PROJECT" || !/^\/elemental\/[^/]+$/.test(record.sourcePointer)) throw new Error("ELEMENTAL_GRADE_BRIDGE_STAGING_SCOPE_INVALID");
    if (!HASH.test(record.sourceLocatorSha256) || record.payloadFingerprint !== calculateEquipmentGradeCommonStagingPayloadFingerprint(record.payloadJson)) throw new Error("ELEMENTAL_GRADE_BRIDGE_STAGING_FINGERPRINT_INVALID");
    return { gradeOrder:record.gradeOrder, sourceIdentifier:sourceIdentifier(record), numericTupleSha256:sha256(stable(stagingTuple(record.payloadJson))) };
  }).sort((left,right) => left.gradeOrder-right.gradeOrder);
  if (new Set(draft.map((entry) => entry.gradeOrder)).size !== ELEMENTAL_GRADE_BRIDGE_COUNT || draft.some((entry,index) => entry.gradeOrder !== index+1)) throw new Error("ELEMENTAL_GRADE_BRIDGE_ORDER_COVERAGE_INVALID");
  if (new Set(draft.map((entry) => entry.sourceIdentifier)).size !== ELEMENTAL_GRADE_BRIDGE_COUNT) throw new Error("ELEMENTAL_GRADE_BRIDGE_SOURCE_DUPLICATE");
  const numericOrderSha256 = numericOrderSha(draft);
  const entries = draft.map((entry) => ({ ...entry, bindingFingerprint:bindingFingerprint(entry,numericOrderSha256) }));
  const withoutHash = { format:"hoibot-elemental-grade-definition-bridge-manifest-v1" as const, catalogVersion:"SC-20260902-1" as const, sourceNamespace:ELEMENTAL_GRADE_BRIDGE_SOURCE_NAMESPACE, expectedCount:ELEMENTAL_GRADE_BRIDGE_COUNT as 61, entries, numericOrderSha256 };
  return { ...withoutHash, manifestSha256:manifestHash(withoutHash) };
}

// 외부에서 전달된 hash-only manifest 전체를 재계산해 drift를 차단합니다.
export function assertElementalGradeBridgeManifest(manifest: ElementalGradeBridgeManifest): void {
  if (manifest.format !== "hoibot-elemental-grade-definition-bridge-manifest-v1" || manifest.catalogVersion !== "SC-20260902-1" || manifest.sourceNamespace !== ELEMENTAL_GRADE_BRIDGE_SOURCE_NAMESPACE || manifest.expectedCount !== ELEMENTAL_GRADE_BRIDGE_COUNT || manifest.entries.length !== ELEMENTAL_GRADE_BRIDGE_COUNT) throw new Error("ELEMENTAL_GRADE_BRIDGE_MANIFEST_INVALID");
  const sorted = [...manifest.entries].sort((left,right) => left.gradeOrder-right.gradeOrder);
  if (sorted.some((entry,index) => entry.gradeOrder !== index+1 || !HASH.test(entry.sourceIdentifier) || !HASH.test(entry.numericTupleSha256) || !HASH.test(entry.bindingFingerprint))) throw new Error("ELEMENTAL_GRADE_BRIDGE_MANIFEST_ENTRY_INVALID");
  if (new Set(sorted.map((entry) => entry.sourceIdentifier)).size !== ELEMENTAL_GRADE_BRIDGE_COUNT || new Set(sorted.map((entry) => entry.bindingFingerprint)).size !== ELEMENTAL_GRADE_BRIDGE_COUNT) throw new Error("ELEMENTAL_GRADE_BRIDGE_MANIFEST_DUPLICATE");
  if (numericOrderSha(sorted) !== manifest.numericOrderSha256) throw new Error("ELEMENTAL_GRADE_BRIDGE_NUMERIC_ORDER_DRIFT");
  for (const entry of sorted) if (bindingFingerprint(entry,manifest.numericOrderSha256) !== entry.bindingFingerprint) throw new Error("ELEMENTAL_GRADE_BRIDGE_BINDING_DRIFT");
  const { manifestSha256, ...withoutHash } = manifest;
  if (!HASH.test(manifestSha256) || manifestHash(withoutHash) !== manifestSha256) throw new Error("ELEMENTAL_GRADE_BRIDGE_MANIFEST_DRIFT");
}

// migration119와 migration475의 numeric 계약을 잠근 뒤 bridge 상태를 분류합니다.
async function inspect(transaction: QueryOnly, manifest: ElementalGradeBridgeManifest, lock: boolean): Promise<{ canonicalBySource: Map<string,CanonicalRow>; bridges: BridgeRow[]; identities: BridgeIdentityRow[] }> {
  assertElementalGradeBridgeManifest(manifest);
  const lockSql = lock ? " FOR UPDATE" : "";
  const legacy = await transaction.query<LegacyRow[]>(`SELECT grade_order AS elemental_grade_order,success_rate,drop_rate,item_cost,point_cost,max_level,battle_exp,battle_upgrade_exp,raid_exp,raid_upgrade_exp,castle_exp,castle_upgrade_exp FROM elemental_enhancement_grades ORDER BY grade_order${lockSql}`);
  if (legacy.length !== ELEMENTAL_GRADE_BRIDGE_COUNT) throw new Error("ELEMENTAL_GRADE_BRIDGE_LEGACY_COUNT_DRIFT");
  const legacyByOrder = new Map<number,LegacyRow>();
  for (const row of legacy) {
    const order = Number(row.elemental_grade_order);
    if (!Number.isInteger(order) || order < 1 || order > ELEMENTAL_GRADE_BRIDGE_COUNT || legacyByOrder.has(order)) throw new Error("ELEMENTAL_GRADE_BRIDGE_LEGACY_ORDER_DRIFT");
    legacyByOrder.set(order,row);
  }
  const canonical = await transaction.query<CanonicalRow[]>(`SELECT definition.equipment_grade_definition_id,definition.equipment_family,crosswalk.source_identifier,crosswalk.payload_fingerprint,identity.object_type,definition.enhancement_success_probability,definition.enhancement_drop_probability,definition.item_cost_quantity,definition.point_cost_amount,definition.maximum_enhancement_level,definition.battle_base_experience_amount,definition.battle_experience_per_enhancement_amount,definition.raid_base_experience_amount,definition.raid_experience_per_enhancement_amount,definition.castle_base_experience_amount,definition.castle_experience_per_enhancement_amount FROM canonical_equipment_grade_definitions definition LEFT JOIN object_identity_crosswalks crosswalk ON crosswalk.object_identity_id=definition.equipment_grade_definition_id AND crosswalk.source_system='LEGACY_JSON' AND crosswalk.source_namespace=? LEFT JOIN object_identities identity ON identity.object_identity_id=definition.equipment_grade_definition_id ORDER BY definition.equipment_grade_definition_id${lockSql}`, [manifest.sourceNamespace]);
  const elemental = canonical.filter((row) => row.equipment_family === "elemental");
  const canonicalBySource = new Map<string,CanonicalRow>();
  for (const row of canonical) if (row.source_identifier !== null) {
    if (canonicalBySource.has(row.source_identifier)) throw new Error("ELEMENTAL_GRADE_BRIDGE_CANONICAL_SOURCE_DUPLICATE");
    canonicalBySource.set(row.source_identifier,row);
  }
  if (manifest.entries.some((entry) => canonicalBySource.get(entry.sourceIdentifier)?.equipment_family === "ring")) throw new Error("ELEMENTAL_GRADE_BRIDGE_RING_FAMILY_DRIFT");
  if (elemental.length !== ELEMENTAL_GRADE_BRIDGE_COUNT) throw new Error("ELEMENTAL_GRADE_BRIDGE_CANONICAL_COUNT_DRIFT");
  if (elemental.some((row) => row.source_identifier === null || row.object_type !== "CANONICAL_EQUIPMENT_GRADE_DEFINITION" || row.payload_fingerprint === null)) throw new Error("ELEMENTAL_GRADE_BRIDGE_NAMESPACE_DRIFT");
  for (const entry of manifest.entries) {
    const oldRow = legacyByOrder.get(entry.gradeOrder);
    const newRow = canonicalBySource.get(entry.sourceIdentifier);
    if (oldRow === undefined || newRow === undefined) throw new Error("ELEMENTAL_GRADE_BRIDGE_BINDING_MISSING");
    if (newRow.equipment_family !== "elemental") throw new Error("ELEMENTAL_GRADE_BRIDGE_FAMILY_DRIFT");
    const oldHash = sha256(stable(legacyTuple(oldRow)));
    const newHash = sha256(stable(canonicalTuple(newRow)));
    if (oldHash !== entry.numericTupleSha256 || newHash !== entry.numericTupleSha256) throw new Error("ELEMENTAL_GRADE_BRIDGE_NUMERIC_TUPLE_DRIFT");
  }
  if (numericOrderSha(manifest.entries) !== manifest.numericOrderSha256) throw new Error("ELEMENTAL_GRADE_BRIDGE_NUMERIC_ORDER_DRIFT");
  const bridges = await transaction.query<BridgeRow[]>(`SELECT elemental_grade_definition_bridge_id,equipment_grade_definition_id,elemental_grade_order,source_identifier_sha256,binding_fingerprint,numeric_tuple_sha256,numeric_order_sha256,bridge_manifest_sha256 FROM canonical_elemental_grade_definition_bridges ORDER BY elemental_grade_order${lockSql}`);
  const identities = await transaction.query<BridgeIdentityRow[]>(`SELECT crosswalk.object_identity_id,crosswalk.source_identifier,crosswalk.payload_fingerprint,identity.object_type FROM object_identity_crosswalks crosswalk JOIN object_identities identity ON identity.object_identity_id=crosswalk.object_identity_id WHERE crosswalk.source_system='CATALOG_MANIFEST' AND crosswalk.source_namespace=? ORDER BY crosswalk.source_identifier${lockSql}`, [ELEMENTAL_GRADE_BRIDGE_IDENTITY_NAMESPACE]);
  return { canonicalBySource, bridges, identities };
}

function assertExactExisting(state: Awaited<ReturnType<typeof inspect>>, manifest: ElementalGradeBridgeManifest): void {
  if (state.bridges.length !== ELEMENTAL_GRADE_BRIDGE_COUNT || state.identities.length !== ELEMENTAL_GRADE_BRIDGE_COUNT) throw new Error("ELEMENTAL_GRADE_BRIDGE_PARTIAL_STATE");
  const identityById = new Map(state.identities.map((row) => [row.object_identity_id,row]));
  for (const entry of manifest.entries) {
    const row = state.bridges.find((candidate) => Number(candidate.elemental_grade_order) === entry.gradeOrder);
    if (row === undefined || row.equipment_grade_definition_id !== state.canonicalBySource.get(entry.sourceIdentifier)!.equipment_grade_definition_id || row.source_identifier_sha256 !== entry.sourceIdentifier || row.binding_fingerprint !== entry.bindingFingerprint || row.numeric_tuple_sha256 !== entry.numericTupleSha256 || row.numeric_order_sha256 !== manifest.numericOrderSha256 || row.bridge_manifest_sha256 !== manifest.manifestSha256) throw new Error("ELEMENTAL_GRADE_BRIDGE_ROW_DRIFT");
    const identity = identityById.get(row.elemental_grade_definition_bridge_id);
    if (identity === undefined || identity.object_type !== OBJECT_TYPE || identity.source_identifier !== entry.bindingFingerprint || identity.payload_fingerprint !== bridgePayloadFingerprint(entry,manifest)) throw new Error("ELEMENTAL_GRADE_BRIDGE_IDENTITY_DRIFT");
  }
}

export class MariaElementalGradeDefinitionBridgeProvider {
  constructor(
    private readonly database: DatabaseClient,
    private readonly generate?: ObjectIdentityCandidateGenerator,
    private readonly now: () => Date = () => new Date()
  ) {}

  // 모든 source 검증이 끝난 뒤 bridge와 bridge-owned identity를 한 transaction으로 생성합니다.
  async apply(manifest: ElementalGradeBridgeManifest, actor: string): Promise<ElementalGradeBridgeResult> {
    return this.database.withTransaction(async (transaction) => {
      const state = await inspect(transaction,manifest,true);
      if (state.bridges.length > 0 || state.identities.length > 0) {
        assertExactExisting(state,manifest);
        return { insertedRows:0, replayed:true, manifestSha256:manifest.manifestSha256 };
      }
      const audit = createObjectAuditValues(actor,this.now());
      const identity = new MariaObjectIdentityAuditProvider(this.database,this.generate,8,this.now);
      for (const entry of manifest.entries) {
        const registered = await identity.registerImportBinding(transaction,{
          actor, objectType:OBJECT_TYPE, sourceSystem:"CATALOG_MANIFEST", sourceNamespace:ELEMENTAL_GRADE_BRIDGE_IDENTITY_NAMESPACE,
          sourceLocatorSha256:entry.bindingFingerprint, payloadFingerprint:bridgePayloadFingerprint(entry,manifest)
        });
        if (registered.replayed) throw new Error("ELEMENTAL_GRADE_BRIDGE_PREEXISTING_IDENTITY");
        const result = await transaction.execute("INSERT INTO canonical_elemental_grade_definition_bridges(elemental_grade_definition_bridge_id,equipment_grade_definition_id,elemental_grade_order,source_identifier_sha256,binding_fingerprint,numeric_tuple_sha256,numeric_order_sha256,bridge_manifest_sha256,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", [registered.objectIdentityId,state.canonicalBySource.get(entry.sourceIdentifier)!.equipment_grade_definition_id,entry.gradeOrder,entry.sourceIdentifier,entry.bindingFingerprint,entry.numericTupleSha256,manifest.numericOrderSha256,manifest.manifestSha256,audit.INSERT_USER,audit.INSERT_TIME,audit.UPDATE_USER,audit.UPDATE_TIME]);
        if (result.affectedRows !== 1n) throw new Error("ELEMENTAL_GRADE_BRIDGE_INSERT_COUNT_INVALID");
      }
      return { insertedRows:ELEMENTAL_GRADE_BRIDGE_COUNT,replayed:false,manifestSha256:manifest.manifestSha256 };
    });
  }

  // read-only snapshot에서 exact bridge parity를 확인하며 DML capability를 노출하지 않습니다.
  async shadow(manifest: ElementalGradeBridgeManifest): Promise<{ exactRows:61; manifestSha256:string }> {
    if (!hasDatabaseTransactionCapabilities(this.database)) throw new Error("ELEMENTAL_GRADE_BRIDGE_READ_ONLY_CAPABILITY_REQUIRED");
    return this.database.withReadOnlySnapshot(async (transaction) => {
      const state = await inspect(transaction,manifest,false);
      assertExactExisting(state,manifest);
      return { exactRows:ELEMENTAL_GRADE_BRIDGE_COUNT, manifestSha256:manifest.manifestSha256 };
    });
  }

  // exact manifest 소유분만 제거하고 migration119·475 데이터는 보존합니다.
  async rollback(manifest: ElementalGradeBridgeManifest): Promise<number> {
    return this.database.withTransaction(async (transaction) => {
      const state = await inspect(transaction,manifest,true);
      if (state.bridges.length === 0 && state.identities.length === 0) return 0;
      assertExactExisting(state,manifest);
      const ids = state.bridges.map((row) => row.elemental_grade_definition_bridge_id);
      const placeholders = ids.map(() => "?").join(",");
      const crosswalkCounts = await transaction.query<BridgeIdentityRow[]>(`SELECT object_identity_id,COUNT(*) crosswalk_count,'' source_identifier,NULL payload_fingerprint,'' object_type FROM object_identity_crosswalks WHERE object_identity_id IN (${placeholders}) GROUP BY object_identity_id FOR UPDATE`,ids);
      if (crosswalkCounts.length !== ELEMENTAL_GRADE_BRIDGE_COUNT || crosswalkCounts.some((row) => Number(row.crosswalk_count) !== 1)) throw new Error("ELEMENTAL_GRADE_BRIDGE_SHARED_IDENTITY");
      const deletedBridge = await transaction.execute(`DELETE FROM canonical_elemental_grade_definition_bridges WHERE elemental_grade_definition_bridge_id IN (${placeholders})`,ids);
      const deletedCrosswalk = await transaction.execute("DELETE FROM object_identity_crosswalks WHERE source_system='CATALOG_MANIFEST' AND source_namespace=?",[ELEMENTAL_GRADE_BRIDGE_IDENTITY_NAMESPACE]);
      const deletedIdentity = await transaction.execute(`DELETE FROM object_identities WHERE object_identity_id IN (${placeholders})`,ids);
      if (deletedBridge.affectedRows !== 61n || deletedCrosswalk.affectedRows !== 61n || deletedIdentity.affectedRows !== 61n) throw new Error("ELEMENTAL_GRADE_BRIDGE_ROLLBACK_COUNT_INVALID");
      return ELEMENTAL_GRADE_BRIDGE_COUNT;
    });
  }
}
