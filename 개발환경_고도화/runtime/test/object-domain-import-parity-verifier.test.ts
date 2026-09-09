import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { calculateCatalogTargetSchemaSha256 } from "../src/data-migration/catalog-projection-provider.js";
import {
  assertObjectDomainImportDatabaseName,
  calculateObjectDomainImportComponentSemanticSha256,
  calculateObjectDomainImportContractSemanticSha256,
  OBJECT_DOMAIN_IMPORT_PRE_466_COMPATIBLE_CONTRACT_SHA256,
  type DomainImportPolicy
} from "../src/data-migration/object-domain-importer.js";
import {
  assertObjectDomainParityImportFingerprint,
  calculateObjectDomainParityImportSha256,
  ObjectDomainParityVerifier,
  type ObjectDomainParityImportFingerprintInput
} from "../src/data-migration/object-domain-parity-verifier.js";

const base = "../../migration-control/contracts/";
const schemaText = readFileSync(new URL(`${base}object-domain-import-target-schema.v1.json`, import.meta.url), "utf8");
const identityText = readFileSync(new URL(`${base}object-domain-import-identity-bindings.v1.json`, import.meta.url), "utf8");
const objectModelText = readFileSync(new URL(`${base}object-data-model-standard.v1.json`, import.meta.url), "utf8");
const dispositionText = readFileSync(new URL(`${base}object-domain-import-disposition.v1.json`, import.meta.url), "utf8");
const fieldMapText = readFileSync(new URL(`${base}object-domain-import-field-map.v1.json`, import.meta.url), "utf8");
const contractText = readFileSync(new URL(`${base}data-migration-object-domain-import.v1.json`, import.meta.url), "utf8");
const schema = JSON.parse(schemaText) as { catalogVersion: "SC-20260902-1"; columns: DomainImportPolicy["columns"] };
const identity = JSON.parse(identityText) as { generatedCuidBindings: DomainImportPolicy["generatedBindings"]; reusedPrimaryKeys: DomainImportPolicy["reusedBindings"] };
const objectModel = JSON.parse(objectModelText) as { tables: Array<{ table: string; foreignKeys?: Array<{ column: string; referencesTable: string; referencesColumn: string }> }> };
const disposition = JSON.parse(dispositionText) as { definitionSeed: string[]; stateImport: string[]; initialLedger: string[]; quarantineOnly: string[] };
const fieldMap = JSON.parse(fieldMapText) as { mappings: Array<{ domain: string; targetTables: string[] }>; recordQuarantine: string[] };
const contract = JSON.parse(contractText) as { componentSemanticSha256: DomainImportPolicy["contractComponentSemanticSha256"]; semanticHashPolicy: { acceptedCompatibleImportContractSha256: string[] } };
const fixture = JSON.parse(readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/data-migration-object-domain-import-v1.json", import.meta.url), "utf8")) as { syntheticProjectionRowCount: number; directTargetCount: number; targetColumnCount: number; gate6SourceDecisionCount: number; gate6ProjectedDecisionCount: number; gate6QuarantinedDecisionCount: number; gate6IgnoredDecisionCount: number; gate6ComparedFieldValueCount: number };
const expectations = { projectionRowCount: 47, directTargetCount: 45, schemaFieldCount: 241, definitionTargetCount: 23, comparedFieldValueCount: 250 } as const;
const directTargets = [...disposition.definitionSeed, ...disposition.stateImport, ...disposition.initialLedger, ...disposition.quarantineOnly];
const policy: DomainImportPolicy = {
  catalogVersion: schema.catalogVersion,
  targetSchemaSha256: calculateCatalogTargetSchemaSha256(schemaText),
  importContractSha256: calculateObjectDomainImportContractSemanticSha256(contractText),
  acceptedImportContractSha256: [calculateObjectDomainImportContractSemanticSha256(contractText), OBJECT_DOMAIN_IMPORT_PRE_466_COMPATIBLE_CONTRACT_SHA256],
  componentSemanticSha256: {
    identityBindings: calculateObjectDomainImportComponentSemanticSha256("identityBindings", identityText, directTargets),
    objectModel: calculateObjectDomainImportComponentSemanticSha256("objectModel", objectModelText, directTargets),
    disposition: calculateObjectDomainImportComponentSemanticSha256("disposition", dispositionText, directTargets),
    fieldMap: calculateObjectDomainImportComponentSemanticSha256("fieldMap", fieldMapText, directTargets)
  },
  contractComponentSemanticSha256: contract.componentSemanticSha256,
  columns: schema.columns,
  generatedBindings: identity.generatedCuidBindings,
  reusedBindings: identity.reusedPrimaryKeys,
  foreignKeys: objectModel.tables.flatMap((table) => (table.foreignKeys ?? []).map((foreignKey) => ({ table: table.table, ...foreignKey }))),
  directTargets,
  definitionTargets: disposition.definitionSeed,
  domainTargets: Object.fromEntries(fieldMap.mappings.map((mapping) => [mapping.domain, mapping.targetTables])),
  quarantineReasons: fieldMap.recordQuarantine
};

describe("object domain import Gate 6 parity contract", () => {
  it("freezes an independent 47-row, 45-target, 241-field oracle", () => {
    const source = readFileSync(new URL("../src/data-migration/object-domain-parity-verifier.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /\.verifyReplay\s*\(|buildObjectDomainImportPlan\s*\(/);
    assert.deepEqual([fixture.syntheticProjectionRowCount, fixture.directTargetCount, fixture.targetColumnCount, fixture.gate6ComparedFieldValueCount], [47, 45, 241, 250]);
    assert.deepEqual([fixture.gate6SourceDecisionCount, fixture.gate6ProjectedDecisionCount, fixture.gate6QuarantinedDecisionCount, fixture.gate6IgnoredDecisionCount], [14, 12, 1, 1]);
  });

  it("accepts current and pre-466 contract identities but rejects unknown identity and fingerprint drift", () => {
    const fingerprintInput: ObjectDomainParityImportFingerprintInput = {
      catalogProjectionRunId: "projection01",
      projectionManifestSha256: "1".repeat(64),
      projectionSha256: "2".repeat(64),
      upstreamEnvelopeSha256: "3".repeat(64),
      targetSchemaSha256: policy.targetSchemaSha256,
      decisions: [{ id: "decision02", fingerprint: "5".repeat(64) }, { id: "decision01", fingerprint: "4".repeat(64) }],
      rows: [{ id: "record01", fingerprint: "6".repeat(64) }]
    };
    const currentRun = {
      import_contract_sha256: policy.importContractSha256,
      import_sha256: calculateObjectDomainParityImportSha256(fingerprintInput, policy.importContractSha256)
    };
    assert.doesNotThrow(() => assertObjectDomainParityImportFingerprint(currentRun, policy, fingerprintInput));

    const compatibleRun = {
      import_contract_sha256: OBJECT_DOMAIN_IMPORT_PRE_466_COMPATIBLE_CONTRACT_SHA256,
      import_sha256: calculateObjectDomainParityImportSha256(fingerprintInput, OBJECT_DOMAIN_IMPORT_PRE_466_COMPATIBLE_CONTRACT_SHA256)
    };
    assert.doesNotThrow(() => assertObjectDomainParityImportFingerprint(compatibleRun, policy, fingerprintInput));

    const unknownContract = "f".repeat(64);
    assert.throws(() => assertObjectDomainParityImportFingerprint({
      import_contract_sha256: unknownContract,
      import_sha256: calculateObjectDomainParityImportSha256(fingerprintInput, unknownContract)
    }, policy, fingerprintInput), /OBJECT_DOMAIN_PARITY_IMPORT_CONTRACT_IDENTITY_INCOMPATIBLE/);
    assert.throws(() => assertObjectDomainParityImportFingerprint({
      import_contract_sha256: OBJECT_DOMAIN_IMPORT_PRE_466_COMPATIBLE_CONTRACT_SHA256,
      import_sha256: currentRun.import_sha256
    }, policy, fingerprintInput), /OBJECT_DOMAIN_PARITY_IMPORT_FINGERPRINT_DRIFT/);
  });

  it("requires the caller's sealed parity cardinalities before reading persisted rows", async () => {
    const verifier = new ObjectDomainParityVerifier();
    await assert.rejects(verifier.verify({} as DatabaseTransaction, "p1234567", policy, { ...expectations, directTargetCount: 44 }), /OBJECT_DOMAIN_PARITY_POLICY_SCOPE_INVALID/);
  });
});

async function writeCounters(database: DatabaseClient): Promise<Record<string, string>> {
  const rows = await database.query<Array<{ Variable_name: string; Value: string }>>("SHOW GLOBAL STATUS WHERE Variable_name IN ('Com_insert','Com_update','Com_delete','Com_replace')");
  return Object.fromEntries(rows.map((row) => [row.Variable_name, String(row.Value)]));
}

async function targetPk(transaction: DatabaseTransaction, table: string, primaryKey: string): Promise<string> {
  if (!/^[a-z_]+$/.test(table) || !/^[a-z_]+$/.test(primaryKey)) throw new Error("GATE6_TEST_IDENTIFIER_INVALID");
  const rows = await transaction.query<Array<Record<string, unknown>>>(`SELECT ${primaryKey} FROM ${table} ORDER BY ${primaryKey} LIMIT 1`);
  if (rows.length === 0) throw new Error(`GATE6_TEST_TARGET_MISSING:${table}`);
  return String(rows[0]![primaryKey]);
}

if (process.env.OBJECT_DOMAIN_GATE6_PHASE === "verify") describe("object domain import Gate 6 independent parity", () => {
  it("compares projection and canonical rows with a zero-write independent oracle and rejects target, decision, and order drift", async () => {
    const config = loadConfig();
    assertObjectDomainImportDatabaseName(config.database.name);
    const gate7 = process.env.WBS742_GATE7_COMBINED === "true";
    assert.deepEqual([config.database.host, config.database.port, config.database.name], gate7 ? ["127.0.0.1", 3323, "hoibot_rehearsal_wbs742_gate7"] : ["127.0.0.1", 3321, "hoibot_rehearsal_wbs742_gate6"]);
    const database = createDatabaseClient(config.database);
    const verifier = new ObjectDomainParityVerifier();
    try {
      const writesBefore = await writeCounters(database);
      const result = await database.withTransaction((transaction) => verifier.verify(transaction, "p1234567", policy, expectations));
      const writesAfter = await writeCounters(database);
      assert.deepEqual(writesAfter, writesBefore);
      assert.deepEqual([result.projectionRowCount, result.targetRowCount, result.directTargetCount, result.schemaFieldCount, result.comparedFieldValueCount, result.decisionCount, result.projectedDecisionCount, result.quarantinedDecisionCount, result.ignoredDecisionCount, result.rowDiffCount], [fixture.syntheticProjectionRowCount, fixture.syntheticProjectionRowCount, fixture.directTargetCount, fixture.targetColumnCount, fixture.gate6ComparedFieldValueCount, fixture.gate6SourceDecisionCount, fixture.gate6ProjectedDecisionCount, fixture.gate6QuarantinedDecisionCount, fixture.gate6IgnoredDecisionCount, 0]);
      assert.equal(result.projectionSha256, result.targetSha256);
      assert.deepEqual(result.targetTableCounts, result.projectionTableCounts);
      assert.ok(result.lastDefinitionImportOrder < result.firstNonDefinitionImportOrder);

      const componentDriftPolicy: DomainImportPolicy = { ...policy, componentSemanticSha256: { ...policy.componentSemanticSha256, fieldMap: "f".repeat(64) } };
      await assert.rejects(database.withTransaction((transaction) => verifier.verify(transaction, "p1234567", componentDriftPolicy, expectations)), /OBJECT_DOMAIN_PARITY_COMPONENT_CONTRACT_DRIFT/);

      const persistedHashDrifts = [
        { table: "data_migration_catalog_projection_runs", column: "target_schema_sha256", key: "catalog_projection_run_id" },
        { table: "data_migration_catalog_projection_runs", column: "projection_sha256", key: "catalog_projection_run_id" },
        { table: "data_migration_catalog_projection_runs", column: "projection_manifest_sha256", key: "catalog_projection_run_id" },
        { table: "data_migration_catalog_projection_runs", column: "upstream_envelope_sha256", key: "catalog_projection_run_id" },
        { table: "data_migration_object_domain_import_runs", column: "catalog_projection_sha256", key: "catalog_projection_run_id" },
        { table: "data_migration_object_domain_import_runs", column: "upstream_envelope_sha256", key: "catalog_projection_run_id" },
        { table: "data_migration_object_domain_import_runs", column: "target_schema_sha256", key: "catalog_projection_run_id" },
        { table: "data_migration_object_domain_import_runs", column: "import_contract_sha256", key: "catalog_projection_run_id" },
        { table: "data_migration_object_domain_import_runs", column: "import_sha256", key: "catalog_projection_run_id" }
      ];
      for (const drift of persistedHashDrifts) await assert.rejects(database.withTransaction(async (transaction) => {
        assert.match(`${drift.table}.${drift.column}.${drift.key}`, /^[a-z0-9_.]+$/);
        await transaction.execute(`UPDATE ${drift.table} SET ${drift.column}=? WHERE ${drift.key}=?`, ["f".repeat(64), "p1234567"]);
        await verifier.verify(transaction, "p1234567", policy, expectations);
      }), /OBJECT_DOMAIN_PARITY_/);

      for (const column of ["identity_locator_sha256", "imported_row_fingerprint"]) await assert.rejects(database.withTransaction(async (transaction) => {
        assert.match(column, /^[a-z0-9_]+$/);
        await transaction.execute(`UPDATE data_migration_object_domain_import_records SET ${column}=? WHERE object_domain_import_run_id=(SELECT object_domain_import_run_id FROM data_migration_object_domain_import_runs WHERE catalog_projection_run_id=?) ORDER BY import_order LIMIT 1`, ["f".repeat(64), "p1234567"]);
        await verifier.verify(transaction, "p1234567", policy, expectations);
      }), /OBJECT_DOMAIN_PARITY_IMPORT_RECORD_MISMATCH/);

      await assert.rejects(database.withTransaction(async (transaction) => {
        const pk = await targetPk(transaction, "canonical_currency_ledger_entries", "currency_ledger_entry_id");
        await transaction.execute("DELETE FROM canonical_currency_ledger_entries WHERE currency_ledger_entry_id=?", [pk]);
        await verifier.verify(transaction, "p1234567", policy, expectations);
      }), /OBJECT_DOMAIN_PARITY_TARGET_ROW_MISSING/);

      await assert.rejects(database.withTransaction(async (transaction) => {
        const pk = await targetPk(transaction, "canonical_item_definitions", "item_id");
        await transaction.execute("INSERT INTO canonical_item_definitions(item_id,item_name,item_description,item_kind,item_grade,price_amount,price_currency_source_identifier,stackable_flag,active_flag,definition_options,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) SELECT 'z1234567',item_name,item_description,item_kind,item_grade,price_amount,price_currency_source_identifier,stackable_flag,active_flag,definition_options,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME FROM canonical_item_definitions WHERE item_id=?", [pk]);
        await verifier.verify(transaction, "p1234567", policy, expectations);
      }), /OBJECT_DOMAIN_PARITY_TARGET_ROW_EXTRA/);

      await assert.rejects(database.withTransaction(async (transaction) => {
        const pk = await targetPk(transaction, "canonical_item_definitions", "item_id");
        await transaction.execute("UPDATE canonical_item_definitions SET item_name=CONCAT(item_name,'-DRIFT') WHERE item_id=?", [pk]);
        await verifier.verify(transaction, "p1234567", policy, expectations);
      }), /OBJECT_DOMAIN_PARITY_TARGET_ROW_DRIFT/);

      await assert.rejects(database.withTransaction(async (transaction) => {
        const nested = (await transaction.query<Array<{ package_reward_entry_id: string; package_id: string }>>("SELECT package_reward_entry_id,package_id FROM canonical_package_nested_rewards"))[0]!;
        const redirected = (await transaction.query<Array<{ package_id: string }>>("SELECT package_id FROM canonical_package_definitions WHERE package_id<>? ORDER BY package_id LIMIT 1", [nested.package_id]))[0]!;
        await transaction.execute("UPDATE canonical_package_nested_rewards SET package_id=? WHERE package_reward_entry_id=?", [redirected.package_id, nested.package_reward_entry_id]);
        await verifier.verify(transaction, "p1234567", policy, expectations);
      }), /OBJECT_DOMAIN_PARITY_TARGET_ROW_DRIFT/);

      await assert.rejects(database.withTransaction(async (transaction) => {
        await transaction.execute("UPDATE data_migration_catalog_source_decisions SET decision_status='IGNORE' WHERE catalog_projection_run_id='p1234567' AND decision_status='QUARANTINE'");
        await verifier.verify(transaction, "p1234567", policy, expectations);
      }), /OBJECT_DOMAIN_PARITY_DECISION_COUNT_MISMATCH/);

      await assert.rejects(database.withTransaction(async (transaction) => {
        const boundary = await transaction.query<Array<{ object_domain_import_record_id: string; import_order: number }>>("SELECT object_domain_import_record_id,import_order FROM data_migration_object_domain_import_records WHERE import_order IN (?,?) ORDER BY import_order", [result.lastDefinitionImportOrder, result.firstNonDefinitionImportOrder]);
        assert.equal(boundary.length, 2);
        await transaction.execute("UPDATE data_migration_object_domain_import_records SET import_order=999 WHERE object_domain_import_record_id=?", [boundary[0]!.object_domain_import_record_id]);
        await transaction.execute("UPDATE data_migration_object_domain_import_records SET import_order=? WHERE object_domain_import_record_id=?", [result.lastDefinitionImportOrder, boundary[1]!.object_domain_import_record_id]);
        await transaction.execute("UPDATE data_migration_object_domain_import_records SET import_order=? WHERE object_domain_import_record_id=?", [result.firstNonDefinitionImportOrder, boundary[0]!.object_domain_import_record_id]);
        await verifier.verify(transaction, "p1234567", policy, expectations);
      }), /OBJECT_DOMAIN_PARITY_DEFINITION_ORDER_INVALID/);

      const restored = await database.withTransaction((transaction) => verifier.verify(transaction, "p1234567", policy, expectations));
      assert.equal(restored.rowDiffCount, 0);
      process.stdout.write(`GATE6_PARITY ${JSON.stringify({ writesBefore, writesAfter, result })}\n`);
    } finally { await database.close(); }
  });
});
