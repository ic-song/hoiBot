import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult, ReadOnlySnapshotTransaction } from "../src/database.js";
import type { CommonStagingRecord } from "../src/data-migration/common-staging-extractor.js";
import { calculateObjectDomainParityImportSha256 } from "../src/data-migration/object-domain-parity-verifier.js";
import {
  assertItem25CanonicalDefinitionManifest,
  buildItem25CanonicalDefinitionManifest,
  ITEM25_DEFINITION_COUNT,
  ITEM25_IDENTITY_SOURCE_NAMESPACE,
  ITEM25_IMPORT_SOURCE_NAMESPACE,
  ITEM25_USED_SCHEMA_CONTRACT,
  MariaItem25CanonicalDefinitionProvider,
  type Item25CanonicalDefinitionManifest
} from "../src/data-migration/item25-canonical-definition-provider.js";

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const approvalByKind = { RAID_SPECIAL: "d505b493502a08173763c86f6d3b9fc3048bfa6fcf34cebe9915bb04c14b8259", TERRITORY_TICKET: "b73af65e9e0545c2d44a38c95b23466726b02febfff81332af230a160dbb027a", CASTLE_UNIT: "329b2cab1cee71cc558606312d871a747c2b51f6a1effd9c932f0db24d22f9c3" } as const;
function stable(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${stable(row[key])}`).join(",")}}`;
}
function stringNumbers(value: unknown): unknown { if (typeof value === "number") return String(value); if (Array.isArray(value)) return value.map(stringNumbers); if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, stringNumbers(child)])); return value; }

function records(): CommonStagingRecord[] {
  const definitions = [
    ...Array.from({ length: 9 }, (_, index) => ({ sourcePointer: `/raidSpecialItem/dept${index < 8 ? "1" : "2"}/item_${index < 8 ? index : 0}`, recordKind: "RAID_ITEM_DEFINITION" })),
    ...Array.from({ length: 6 }, (_, index) => ({ sourcePointer: `/castlePremiumItem/${index < 3 ? "offense" : "defense"}/item_${index % 3}`, recordKind: "TERRITORY_ITEM_DEFINITION" })),
    ...Array.from({ length: 10 }, (_, index) => ({ sourcePointer: `/castleItem/item_${index}`, recordKind: "CASTLE_ITEM_DEFINITION" }))
  ];
  const source = JSON.parse(readFileSync(new URL("../../../data/itemInfo.json", import.meta.url), "utf8")) as Record<string, unknown>;
  return definitions.map((definition, occurrenceIndex) => {
    const payload = definition.sourcePointer.split("/").slice(1).reduce<unknown>((value, key) => (value as Record<string, unknown>)[key], source);
    const payloadJson = JSON.stringify(payload);
    return {
      sourceSystem: "LEGACY_JSON",
      sourceNamespace: "itemInfo.json",
      sourcePathSha256: sha256("data/itemInfo.json"),
      sourceContentSha256: "49ef9f7b39ffa5fab57c0d3759f8a682c7be759e4708f76744ae095fc673ffdc",
      logicalSourceName: "data/itemInfo.json",
      sourcePointer: definition.sourcePointer,
      identityPointer: definition.sourcePointer,
      sourceLocatorSha256: sha256(`data/itemInfo.json\0${definition.sourcePointer}\0${definition.recordKind}\0${definition.sourcePointer}`),
      ownerLocatorSha256: null,
      occurrenceIndex,
      projectionLocator: definition.sourcePointer,
      recordDomain: "ITEM",
      recordKind: definition.recordKind,
      projectionStatus: "PROJECT",
      quarantineReason: null,
      quantityValue: null,
      observedTime: null,
      payloadJson,
      payloadFingerprint: sha256(stable(JSON.parse(payloadJson)))
    };
  });
}

type ImportRow = { item_definition_import_id: string; item_id: string; source_identifier: string };

const schemaRows = ITEM25_USED_SCHEMA_CONTRACT.flatMap((table) => table.columns.map((column) => ({ table_name: table.table, column_name: column.name, column_type: column.columnType, is_nullable: column.nullable, character_set_name: column.charset, collation_name: column.collation })));
const keyRows = ITEM25_USED_SCHEMA_CONTRACT.flatMap((table) => table.keySignatures.flatMap((signature, constraintIndex) => {
  const [kind, body] = signature.split(":", 2) as ["PRIMARY" | "UNIQUE" | "FOREIGN", string];
  const [columnList, target] = body.split("->", 2);
  const columns = (columnList ?? "").split(",");
  const targetMatch = target?.match(/^([^()]+)\(([^)]+)\)$/);
  const referencedColumns = targetMatch?.[2]!.split(",") ?? [];
  return columns.map((column_name, index) => ({ table_name: table.table, constraint_name: `${kind}_${constraintIndex}`, constraint_type: kind === "PRIMARY" ? "PRIMARY KEY" : kind === "FOREIGN" ? "FOREIGN KEY" : kind, column_name, ordinal_position: index + 1, referenced_table_name: targetMatch?.[1] ?? null, referenced_column_name: referencedColumns[index] ?? null }));
}));

function lineageRows(manifest: Item25CanonicalDefinitionManifest): Array<Record<string, unknown>> {
  const source = new Map(records().map((record) => [record.sourcePointer, record]));
  return manifest.entries.map((entry, index) => {
    const itemId = `i${String(index + 1).padStart(7, "0")}`;
    const sourceRecord = source.get(entry.sourcePointer)!;
    const options = stringNumbers(JSON.parse(sourceRecord.payloadJson)) as Record<string, unknown>;
    const payload = { active_flag: true, definition_options: options, item_description: null, item_grade: null, item_kind: entry.itemKind, item_name: options.name, price_amount: null, price_currency_source_identifier: null, stackable_flag: true };
    const origins = { active_flag: "APPROVED_CATALOG", definition_options: "SOURCE_EXACT", item_description: "SOURCE_ABSENT", item_grade: "SOURCE_ABSENT", item_kind: "APPROVED_CATALOG", item_name: "SOURCE_EXACT", price_amount: "SOURCE_ABSENT", price_currency_source_identifier: "SOURCE_ABSENT", stackable_flag: "APPROVED_CATALOG" };
    const targetPayloadJson = stable(payload);
    const originsJson = stable(origins);
    const referencesJson = "[]";
    const approval = approvalByKind[entry.itemKind];
    const binding = sha256(stable({ targetTable: "canonical_item_definitions", targetPkColumn: "item_id", targetObjectType: "CANONICAL_ITEM_DEFINITIONS", targetSourceNamespace: ITEM25_IDENTITY_SOURCE_NAMESPACE, identityLocatorSha256: entry.sourceLocatorSha256, targetPayloadFingerprint: sha256(targetPayloadJson), valueOriginsFingerprint: sha256(originsJson), referenceBindingsFingerprint: sha256(referencesJson), approvalKind: "CATALOG_PROVENANCE", approvalSha256: approval }));
    return {
      item_id: itemId, item_name: payload.item_name, item_description: null, item_kind: entry.itemKind, item_grade: null,
      price_amount: null, price_currency_source_identifier: null, stackable_flag: 1, active_flag: 1,
      definition_options: stable(options), object_type: "CANONICAL_ITEM_DEFINITIONS",
      crosswalk_source_identifier: entry.sourceLocatorSha256, crosswalk_payload_fingerprint: binding,
      object_domain_import_record_id: `r${String(index + 1).padStart(7, "0")}`, receipt_binding_fingerprint: binding,
      imported_row_fingerprint: sha256(stable({ table: "canonical_item_definitions", pkColumn: "item_id", pk: itemId, payload, references: {} })), run_status: "COMPLETE",
      projection_locator: entry.sourcePointer, identity_locator_sha256: entry.sourceLocatorSha256, identity_mode: "GENERATED",
      target_table_name: "canonical_item_definitions", target_pk_column_name: "item_id", target_object_type: "CANONICAL_ITEM_DEFINITIONS", target_source_namespace: ITEM25_IDENTITY_SOURCE_NAMESPACE,
      approval_kind: "CATALOG_PROVENANCE", approval_sha256: approval, target_payload_json: targetPayloadJson, target_payload_fingerprint: sha256(targetPayloadJson),
      value_origins_json: originsJson, value_origins_fingerprint: sha256(originsJson), reference_bindings_json: referencesJson, reference_bindings_fingerprint: sha256(referencesJson),
      decision_source_locator_sha256: entry.sourceLocatorSha256, decision_source_payload_fingerprint: entry.sourcePayloadFingerprint, decision_status: "PROJECT", decision_projected_row_count: 1,
      staging_source_system: "LEGACY_JSON", staging_source_namespace: "itemInfo.json", source_path_sha256: sourceRecord.sourcePathSha256, source_content_sha256: sourceRecord.sourceContentSha256,
      logical_source_name: "data/itemInfo.json", source_pointer: entry.sourcePointer, identity_pointer: entry.sourcePointer, staging_source_locator_sha256: entry.sourceLocatorSha256,
      projection_status: "PROJECT", record_domain: "ITEM", record_kind: sourceRecord.recordKind, payload_json: sourceRecord.payloadJson, staging_payload_fingerprint: entry.sourcePayloadFingerprint
    };
  });
}

function pipelineEvidence(manifest: Item25CanonicalDefinitionManifest, lineages: Array<Record<string, unknown>>) {
  const projections = manifest.entries.map((entry, index) => {
    const row = lineages[index]!;
    return { catalog_projection_record_id: `p${String(index + 1).padStart(7, "0")}`, catalog_source_decision_id: `q${String(index + 1).padStart(7, "0")}`, projection_locator: entry.sourcePointer, identity_locator_sha256: entry.sourceLocatorSha256, identity_mode: "GENERATED", target_table_name: "canonical_item_definitions", target_pk_column_name: "item_id", target_object_type: "CANONICAL_ITEM_DEFINITIONS", target_source_namespace: ITEM25_IDENTITY_SOURCE_NAMESPACE, source_role: null, approval_kind: "CATALOG_PROVENANCE", approval_sha256: row.approval_sha256, target_payload_json: row.target_payload_json, target_payload_fingerprint: row.target_payload_fingerprint, value_origins_json: row.value_origins_json, value_origins_fingerprint: row.value_origins_fingerprint, reference_bindings_json: row.reference_bindings_json, reference_bindings_fingerprint: row.reference_bindings_fingerprint };
  });
  const decisions = manifest.entries.map((entry, index) => {
    const projection = projections[index]!;
    const outputs = [{ projectionLocator: projection.projection_locator, identityLocatorSha256: projection.identity_locator_sha256, identityMode: projection.identity_mode, targetTable: projection.target_table_name, targetPkColumn: projection.target_pk_column_name, targetObjectType: projection.target_object_type, targetSourceNamespace: projection.target_source_namespace, sourceRole: projection.source_role, approvalKind: projection.approval_kind, approvalSha256: projection.approval_sha256, targetPayloadJson: projection.target_payload_json, targetPayloadFingerprint: projection.target_payload_fingerprint, valueOriginsJson: projection.value_origins_json, valueOriginsFingerprint: projection.value_origins_fingerprint, referenceBindingsJson: projection.reference_bindings_json, referenceBindingsFingerprint: projection.reference_bindings_fingerprint }];
    const body = { sourceLocatorSha256: entry.sourceLocatorSha256, sourcePayloadFingerprint: entry.sourcePayloadFingerprint, recordDomain: "ITEM", decisionStatus: "PROJECT", decisionReason: null, outputs };
    return { catalog_source_decision_id: projection.catalog_source_decision_id, source_locator_sha256: entry.sourceLocatorSha256, source_payload_fingerprint: entry.sourcePayloadFingerprint, record_domain: "ITEM", decision_status: "PROJECT", decision_reason: null, projected_row_count: 1, decision_fingerprint: sha256(stable(body)) };
  });
  const projectionSha256 = sha256(stable(decisions.map((decision, index) => ({ sourceLocatorSha256: decision.source_locator_sha256, sourcePayloadFingerprint: decision.source_payload_fingerprint, recordDomain: decision.record_domain, decisionStatus: decision.decision_status, decisionReason: decision.decision_reason, outputs: [{ projectionLocator: projections[index]!.projection_locator, identityLocatorSha256: projections[index]!.identity_locator_sha256, identityMode: projections[index]!.identity_mode, targetTable: projections[index]!.target_table_name, targetPkColumn: projections[index]!.target_pk_column_name, targetObjectType: projections[index]!.target_object_type, targetSourceNamespace: projections[index]!.target_source_namespace, sourceRole: projections[index]!.source_role, approvalKind: projections[index]!.approval_kind, approvalSha256: projections[index]!.approval_sha256, targetPayloadJson: projections[index]!.target_payload_json, targetPayloadFingerprint: projections[index]!.target_payload_fingerprint, valueOriginsJson: projections[index]!.value_origins_json, valueOriginsFingerprint: projections[index]!.value_origins_fingerprint, referenceBindingsJson: projections[index]!.reference_bindings_json, referenceBindingsFingerprint: projections[index]!.reference_bindings_fingerprint }], decisionFingerprint: decision.decision_fingerprint })).sort((left, right) => left.sourceLocatorSha256.localeCompare(right.sourceLocatorSha256, "en"))));
  const staging = { common_staging_run_id: "s2556000", raw_bundle_sha256: sha256("raw"), snapshot_manifest_sha256: sha256("snapshot"), extraction_manifest_sha256: sha256("extraction"), staging_sha256: sha256("staging"), expected_file_count: 1, expected_total_bytes: "31177", projected_file_count: 1, ignored_file_count: 0, run_status: "COMPLETE" };
  const upstreamEnvelopeSha256 = sha256(stable({ expectedFileCount: 1, expectedTotalBytes: "31177", extractionManifestSha256: staging.extraction_manifest_sha256, ignoredFileCount: 0, projectedFileCount: 1, rawBundleSha256: staging.raw_bundle_sha256, snapshotManifestSha256: staging.snapshot_manifest_sha256, stagingSha256: staging.staging_sha256 }));
  const run = { catalog_projection_run_id: "c2556000", common_staging_run_id: staging.common_staging_run_id, catalog_version: "SC-20260902-1", projection_manifest_sha256: sha256("projection-manifest"), target_schema_sha256: "2d0229891ffaaf486ec9fe7f786d362b90d219bfb915ed2cdf54c1937fe4cf3a", projection_sha256: projectionSha256, upstream_envelope_sha256: upstreamEnvelopeSha256, expected_source_count: 25, projected_source_count: 25, quarantined_source_count: 0, ignored_source_count: 0, projected_row_count: 25, run_status: "COMPLETE" };
  const contract = "67cf9e7c3d5811148e78a2b3eb87db768692aa85ac30b5bc58f7315dad4cb73b";
  const importSha256 = calculateObjectDomainParityImportSha256({ catalogProjectionRunId: run.catalog_projection_run_id, projectionManifestSha256: run.projection_manifest_sha256, projectionSha256, upstreamEnvelopeSha256, targetSchemaSha256: run.target_schema_sha256, decisions: decisions.map((decision) => ({ id: decision.catalog_source_decision_id, fingerprint: decision.decision_fingerprint })), rows: projections.map((projection, index) => ({ id: projection.catalog_projection_record_id, fingerprint: String(lineages[index]!.receipt_binding_fingerprint) })) }, contract);
  const importRun = { object_domain_import_run_id: "d2556000", catalog_version: "SC-20260902-1", catalog_projection_sha256: projectionSha256, upstream_envelope_sha256: upstreamEnvelopeSha256, target_schema_sha256: run.target_schema_sha256, import_contract_sha256: contract, import_sha256: importSha256, expected_source_count: 25, projected_source_count: 25, quarantined_source_count: 0, ignored_source_count: 0, expected_row_count: 25, imported_row_count: 25, run_status: "COMPLETE" };
  const receipts = decisions.map(({ source_payload_fingerprint: _payload, record_domain: _domain, ...decision }) => decision);
  return { projections, decisions, staging, run, importRun, receipts };
}

class MemoryDatabase implements DatabaseClient {
  imports: ImportRow[] = [];
  writes = 0;
  failAtWrite = 0;
  readonly lineages: Array<Record<string, unknown>>;
  readonly evidence: ReturnType<typeof pipelineEvidence>;
  readonly stagingLineageRuns: Array<{ catalog_source_decision_id: string; common_staging_run_id: string }>;
  schema = structuredClone(schemaRows);
  keys = structuredClone(keyRows);
  readonly preserved = { definitions: 25, crosswalks: 25, stacks: 1 };
  constructor(manifest: Item25CanonicalDefinitionManifest) { this.lineages = lineageRows(manifest); this.evidence = pipelineEvidence(manifest, this.lineages); this.stagingLineageRuns = this.evidence.decisions.map((row) => ({ catalog_source_decision_id: row.catalog_source_decision_id, common_staging_run_id: this.evidence.run.common_staging_run_id })); }
  async ping(): Promise<void> {}
  async verifyRollback(): Promise<boolean> { return true; }
  async close(): Promise<void> {}
  async query<T>(sql: string): Promise<T> { return this.handleQuery(sql) as T; }
  async execute(sql: string, values: readonly unknown[] = []): Promise<DatabaseWriteResult> { return this.handleExecute(sql, values); }
  async withTransaction<T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> {
    const snapshot = structuredClone(this.imports);
    try { return await work({ query: async <R>(sql: string) => this.handleQuery(sql) as R, execute: (sql, values = []) => this.handleExecute(sql, values) }); }
    catch (error) { this.imports = snapshot; throw error; }
  }
  async withReadOnlySnapshot<T>(work: (transaction: ReadOnlySnapshotTransaction) => Promise<T>): Promise<T> {
    return work({ query: async <R>(sql: string) => this.handleQuery(sql) as R });
  }
  async withControlledTransaction<T>(): Promise<T> { throw new Error("unused"); }
  private handleQuery(sql: string): unknown[] {
    if (sql.includes("information_schema.COLUMNS")) return this.schema;
    if (sql.includes("information_schema.TABLE_CONSTRAINTS")) return this.keys;
    if (sql.startsWith("SELECT DISTINCT run.catalog_projection_run_id")) return [this.evidence.run];
    if (sql.includes("FROM data_migration_common_staging_runs")) return [this.evidence.staging];
    if (sql.startsWith("SELECT decision.catalog_source_decision_id,staging.common_staging_run_id")) return this.stagingLineageRuns;
    if (sql.includes("FROM data_migration_catalog_source_decisions WHERE")) return this.evidence.decisions;
    if (sql.includes("FROM data_migration_catalog_projection_records WHERE catalog_projection_run_id")) return this.evidence.projections;
    if (sql.includes("FROM data_migration_object_domain_import_runs WHERE")) return [this.evidence.importRun];
    if (sql.includes("FROM data_migration_object_domain_import_decisions WHERE")) return this.evidence.receipts;
    if (sql.includes("FROM object_identity_crosswalks crosswalk")) return this.lineages;
    if (sql.includes("FROM canonical_item_definition_imports")) return [...this.imports].sort((a, b) => a.source_identifier.localeCompare(b.source_identifier, "en"));
    throw new Error(`UNEXPECTED_QUERY:${sql}`);
  }
  private async handleExecute(sql: string, values: readonly unknown[]): Promise<DatabaseWriteResult> {
    this.writes += 1;
    if (this.failAtWrite > 0 && this.writes === this.failAtWrite) throw new Error("ITEM25_FORCED_FAILURE");
    if (sql.startsWith("INSERT INTO canonical_item_definition_imports")) {
      this.imports.push({ item_definition_import_id: String(values[0]), item_id: String(values[1]), source_identifier: String(values[4]) });
      return { affectedRows: 1n, insertId: 0n };
    }
    if (sql.startsWith("DELETE FROM canonical_item_definition_imports")) {
      const count = this.imports.length;
      this.imports = [];
      return { affectedRows: BigInt(count), insertId: 0n };
    }
    throw new Error(`UNEXPECTED_EXECUTE:${sql}`);
  }
}

test("sealed Common Staging produces an exact name/CODE-free 9+6+10 manifest", () => {
  const manifest = buildItem25CanonicalDefinitionManifest(records());
  assert.equal(manifest.entries.length, ITEM25_DEFINITION_COUNT);
  assert.deepEqual(Object.fromEntries(["RAID_SPECIAL", "TERRITORY_TICKET", "CASTLE_UNIT"].map((kind) => [kind, manifest.entries.filter((entry) => entry.itemKind === kind).length])), { RAID_SPECIAL: 9, TERRITORY_TICKET: 6, CASTLE_UNIT: 10 });
  assert.doesNotThrow(() => assertItem25CanonicalDefinitionManifest(manifest));
  const serialized = JSON.stringify(manifest);
  assert.doesNotMatch(serialized, /synthetic-display|itemCode|bonusCode|ticketCode|unitCode|displayName|\bCODE\b/);
});

test("manifest generation fails closed on pointer, locator, payload and count drift", () => {
  const wrongCount = records().slice(1);
  assert.throws(() => buildItem25CanonicalDefinitionManifest(wrongCount), /COUNT_INVALID/);
  const wrongPointer = records(); wrongPointer[0] = { ...wrongPointer[0]!, sourcePointer: "/wrong/item_0", identityPointer: "/wrong/item_0", projectionLocator: "/wrong/item_0" };
  assert.throws(() => buildItem25CanonicalDefinitionManifest(wrongPointer), /STAGING_SCOPE_INVALID/);
  const wrongLocator = records(); wrongLocator[0] = { ...wrongLocator[0]!, sourceLocatorSha256: sha256("drift") };
  assert.throws(() => buildItem25CanonicalDefinitionManifest(wrongLocator), /SOURCE_LOCATOR_DRIFT/);
  const wrongPayload = records(); wrongPayload[0] = { ...wrongPayload[0]!, payloadFingerprint: sha256("drift") };
  assert.throws(() => buildItem25CanonicalDefinitionManifest(wrongPayload), /SOURCE_PAYLOAD_FINGERPRINT_DRIFT/);
  const manifest = buildItem25CanonicalDefinitionManifest(records());
  const changed = structuredClone(manifest); changed.entries[0]!.bindingFingerprint = sha256("drift");
  assert.throws(() => assertItem25CanonicalDefinitionManifest(changed), /BINDING_FINGERPRINT_DRIFT/);
});

test("provider binds exact pointers to existing CUIDs, replays DML0, shadows and rolls back only owned imports", async () => {
  const manifest = buildItem25CanonicalDefinitionManifest(records());
  const database = new MemoryDatabase(manifest);
  let sequence = 0;
  const provider = new MariaItem25CanonicalDefinitionProvider(database, () => `b${String(++sequence).padStart(7, "0")}`, 8, () => new Date("2026-09-05T10:30:00.000Z"));
  assert.deepEqual(await provider.apply(manifest, "lease2556-test"), { insertedBindings: 25, replayed: false, manifestSha256: manifest.manifestSha256 });
  const afterFirst = database.writes;
  assert.deepEqual(await provider.apply(manifest, "lease2556-replay"), { insertedBindings: 0, replayed: true, manifestSha256: manifest.manifestSha256 });
  assert.equal(database.writes, afterFirst);
  assert.deepEqual(await provider.shadow(manifest), { exactBindings: 25, manifestSha256: manifest.manifestSha256 });
  assert.equal(database.writes, afterFirst);
  assert.equal(await provider.rollback(manifest), 25);
  assert.deepEqual(database.preserved, { definitions: 25, crosswalks: 25, stacks: 1 });
  assert.equal(await provider.rollback(manifest), 0);
});

test("lineage drift fails before DML and an insert failure rolls back the whole binding set", async () => {
  const manifest = buildItem25CanonicalDefinitionManifest(records());
  const drifted = new MemoryDatabase(manifest);
  drifted.lineages[0]!.decision_source_payload_fingerprint = sha256("drift");
  const driftProvider = new MariaItem25CanonicalDefinitionProvider(drifted, () => "a1234567");
  await assert.rejects(() => driftProvider.apply(manifest, "lease2556-drift"), /CATALOG_DECISION_DRIFT/);
  assert.equal(drifted.writes, 0);

  const failed = new MemoryDatabase(manifest);
  failed.failAtWrite = 2;
  let sequence = 0;
  const failedProvider = new MariaItem25CanonicalDefinitionProvider(failed, () => `f${String(++sequence).padStart(7, "0")}`);
  await assert.rejects(() => failedProvider.apply(manifest, "lease2556-failure"), /ITEM25_FORCED_FAILURE/);
  assert.equal(failed.imports.length, 0);
  assert.deepEqual(failed.preserved, { definitions: 25, crosswalks: 25, stacks: 1 });
});

test("run envelope, exact domain decision receipts and approved scope hashes fail closed before DML", async () => {
  const manifest = buildItem25CanonicalDefinitionManifest(records());
  const missingReceipt = new MemoryDatabase(manifest);
  missingReceipt.evidence.receipts.pop();
  await assert.rejects(() => new MariaItem25CanonicalDefinitionProvider(missingReceipt).apply(manifest, "missing-receipt"), /DOMAIN_DECISION_RECEIPT_DRIFT/);
  assert.equal(missingReceipt.writes, 0);

  const envelopeDrift = new MemoryDatabase(manifest);
  envelopeDrift.evidence.run.upstream_envelope_sha256 = sha256("drift");
  await assert.rejects(() => new MariaItem25CanonicalDefinitionProvider(envelopeDrift).apply(manifest, "envelope-drift"), /UPSTREAM_ENVELOPE_DRIFT/);
  assert.equal(envelopeDrift.writes, 0);

  const mixedStagingRun = new MemoryDatabase(manifest);
  mixedStagingRun.stagingLineageRuns[0]!.common_staging_run_id = "s9999999";
  await assert.rejects(() => new MariaItem25CanonicalDefinitionProvider(mixedStagingRun).apply(manifest, "mixed-staging-run"), /STAGING_RUN_LINEAGE_DRIFT/);
  assert.equal(mixedStagingRun.writes, 0);

  const approvalDrift = new MemoryDatabase(manifest);
  approvalDrift.lineages[0]!.approval_sha256 = sha256("unapproved");
  await assert.rejects(() => new MariaItem25CanonicalDefinitionProvider(approvalDrift).apply(manifest, "approval-drift"), /PROJECTION_RECEIPT_DRIFT/);
  assert.equal(approvalDrift.writes, 0);

  const nullableVarchar = new MemoryDatabase(manifest);
  const column = nullableVarchar.schema.find((row) => row.table_name === "data_migration_common_staging_runs" && row.column_name === "expected_file_count")!;
  Object.assign(column, { column_type: "varchar(255)", is_nullable: "YES", character_set_name: "utf8mb4", collation_name: "utf8mb4_bin" });
  await assert.rejects(() => new MariaItem25CanonicalDefinitionProvider(nullableVarchar).apply(manifest, "schema-column-drift"), /SCHEMA_COLUMN_DRIFT/);
  assert.equal(nullableVarchar.writes, 0);

  const missingUnique = new MemoryDatabase(manifest);
  missingUnique.keys = missingUnique.keys.filter((row) => !(row.table_name === "data_migration_catalog_source_decisions" && row.constraint_name === "UNIQUE_2"));
  await assert.rejects(() => new MariaItem25CanonicalDefinitionProvider(missingUnique).apply(manifest, "schema-unique-drift"), /SCHEMA_KEY_SET_DRIFT/);

  const missingForeignKey = new MemoryDatabase(manifest);
  missingForeignKey.keys = missingForeignKey.keys.filter((row) => !(row.table_name === "data_migration_object_domain_import_records" && row.constraint_type === "FOREIGN KEY"));
  await assert.rejects(() => new MariaItem25CanonicalDefinitionProvider(missingForeignKey).apply(manifest, "schema-fk-drift"), /SCHEMA_KEY_SET_DRIFT/);
});

test("contract reuses existing schema and excludes operating migration and semantic decisions", async () => {
  const contract = JSON.parse(await readFile(new URL("../../migration-control/contracts/item25-canonical-definition-binding.v1.json", import.meta.url), "utf8"));
  assert.equal(contract.schemaChange, false);
  assert.equal(contract.migration, null);
  assert.equal(contract.expectedCount, 25);
  assert.deepEqual(contract.expectedKinds, { RAID_SPECIAL: 9, TERRITORY_TICKET: 6, CASTLE_UNIT: 10 });
  assert.equal(contract.source.identityPolicy, "EXACT_RFC6901_SOURCE_POINTER_NOT_DISPLAY_NAME_OR_CODE");
  assert.equal(contract.authoritativeSeal.sourceContentSha256, "49ef9f7b39ffa5fab57c0d3759f8a682c7be759e4708f76744ae095fc673ffdc");
  assert.equal(contract.authoritativeSeal.item25ManifestSha256, buildItem25CanonicalDefinitionManifest(records()).manifestSha256);
  assert.equal(contract.authoritativeSeal.selfDeclaredHashAccepted, false);
  assert.equal(contract.schemaBinding.allReadWriteTables.length, 12);
  assert.equal(contract.schemaBinding.allUsedColumnsRequired, true);
  assert.deepEqual(contract.schemaBinding.tables, ITEM25_USED_SCHEMA_CONTRACT.map((table) => ({ table: table.table, columns: table.columns.map((column) => [column.name,column.columnType,column.nullable,column.charset ?? "null",column.collation ?? "null"].join("|")), keySignatures: table.keySignatures })));
  assert.equal(contract.inventoryPath.includes("CanonicalItemInventoryRepository"), true);
  assert.equal(contract.operationalDataAllowed, false);
  assert.equal(contract.featureProdAllowed, false);
});
