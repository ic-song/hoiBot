import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { assertObjectDomainImportDatabaseName, MariaObjectDomainImporter, stableDomainImportJson, type DomainImportPolicy } from "../src/data-migration/object-domain-importer.js";
import { buildObjectDomainImportV4Gate4Policy } from "../scripts/validate-object-domain-import-v4-gate4.js";
import { validateObjectDomainImportV4Gate3 } from "../scripts/validate-object-domain-import-v4-gate3.js";
import { loadGate3Documents } from "../scripts/validate-object-domain-import-v4-gate3.js";

const policy = buildObjectDomainImportV4Gate4Policy();
const fixture = JSON.parse(readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/data-migration-object-domain-import-v4.json", import.meta.url), "utf8")) as { registeredTableCount: number; directTargetCount: number; targetColumnCount: number; definitionTargetCount: number; syntheticProjectionRowCount: number; comparedFieldValueCount: number };
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
const H = (index: number): string => hash(`wbs742-v4-gate5-${index}`);
const OWNER_LOCATOR = H(1700);
const locatorByTable = new Map(policy.directTargets.map((table, index) => [table, H(index + 100)]));

function sample(column: DomainImportPolicy["columns"][number]): unknown {
  if (column.nullable) return null;
  if (column.sqlType === "BOOLEAN") return false;
  if (/^(?:TINYINT|INT|BIGINT)(?: UNSIGNED)?$/.test(column.sqlType) || /^DECIMAL/.test(column.sqlType)) return "1";
  if (column.sqlType === "JSON") return {};
  if (column.sqlType === "CHAR(19)") return "2026-09-09 21:00:00";
  if (column.column.endsWith("_fingerprint")) return H(900);
  return "SYNTHETIC";
}

function projectionRow(table: string, index: number, decisionId: string, domain: string): any {
  const generated = policy.generatedBindings.find((row) => row.targetTable === table);
  const reused = policy.reusedBindings.find((row) => row.targetTable === table);
  const pk = generated?.targetPkColumn ?? reused!.targetPkColumn;
  const locator = reused === undefined ? locatorByTable.get(table)! : locatorByTable.get(reused.sourceTable)!;
  const foreignKeys = policy.foreignKeys.filter((foreignKey) => foreignKey.table === table && foreignKey.column !== pk);
  const payload: Record<string, unknown> = {};
  const origins: Record<string, string> = {};
  for (const column of policy.columns.filter((candidate) => candidate.table === table && candidate.column !== pk && !foreignKeys.some((foreignKey) => foreignKey.column === candidate.column))) {
    payload[column.column] = sample(column);
    origins[column.column] = column.nullable ? "SOURCE_ABSENT" : "SOURCE_EXACT";
  }
  if (table === "canonical_item_definitions") payload.item_name = "펫타이틀권🦊(/펫타이틀이름)";
  if (table === "canonical_players") Object.assign(payload, { source_system: "LEGACY_JSON", source_identifier: OWNER_LOCATOR });
  if (table === "canonical_item_definition_imports") {
    Object.assign(payload, { source_system: "LEGACY_JSON", source_namespace: "member.bag", source_identifier: "펫타이틀권🦊(/펫타이틀이름)" });
    Object.assign(origins, { source_system: "CONSTANT_CONTRACT", source_namespace: "CONSTANT_CONTRACT", source_identifier: "SOURCE_EXACT" });
  }
  if (table === "canonical_currency_definition_imports") {
    Object.assign(payload, { source_system: "LEGACY_JSON", source_namespace: "member.point", source_identifier: "point" });
    Object.assign(origins, { source_system: "CONSTANT_CONTRACT", source_namespace: "CONSTANT_CONTRACT", source_identifier: "CONSTANT_CONTRACT" });
  }
  if (table === "object_furniture_definitions") for (const key of ["purchase_price", "charm_per_enhancement"]) origins[key] = "APPROVED_CATALOG";
  if (table === "canonical_mini_pet_definitions") { payload.sale_price = "0"; for (const key of ["sale_price", "max_enhancement_level", "active_flag"]) origins[key] = "APPROVED_CATALOG"; }
  if (table === "canonical_mini_pet_enhancement_rules") for (const key of ["battle_charm_gain", "castle_charm_gain", "raid_charm_gain", "success_probability", "point_cost", "stone_quantity"]) origins[key] = "APPROVED_CATALOG";
  if (/^canonical_(?:member|pet|mini_pet)_title_definitions$/.test(table)) origins.base_sale_price = "APPROVED_CATALOG";
  if (/^canonical_owned_(?:member|pet|mini_pet)_title_instances$/.test(table)) { payload.acquisition_price = null; origins.acquisition_price = "SOURCE_ABSENT"; payload.acquisition_sequence = "1"; payload.ownership_status = "owned"; }
  if (table === "canonical_owned_equipment_instances") { payload.durability_amount = "0"; origins.durability_amount = "EXPLICIT_RULE"; payload.ownership_status = "owned"; }
  if (table === "object_owned_furniture_instances") payload.ownership_status = "bag";
  if (table === "object_furniture_market_listings") payload.listing_status = "active";
  if (/^canonical_owned_(?:item|pet|equipment)_instances$/.test(table)) payload.ownership_status = "owned";
  if (table === "canonical_pet_skill_definitions") { payload.handler_key = "passive_modifier"; payload.options_json = { commands: ["/합성명령"], cooldownSeconds: "0" }; }
  if (table === "canonical_owned_mini_pet_instances") { payload.enhancement_level = "0"; origins.enhancement_level = "CONSTANT_CONTRACT"; payload.equipped_flag = false; payload.bound_flag = false; payload.ownership_status = "owned"; }
  if (table === "canonical_player_currency_balances") payload.balance_minor_amount = "7";
  if (table === "canonical_currency_operations") Object.assign(payload, { operation_kind: "INITIAL_IMPORT", operation_status: "completed", delta_minor_amount: "7", balance_after_minor_amount: "7" });
  if (table === "canonical_currency_ledger_entries") Object.assign(payload, { sequence_number: "1", delta_minor_amount: "7", balance_after_minor_amount: "7" });
  if (table === "canonical_building_definitions") Object.assign(payload, { floor_value: "1", active_flag: true });
  if (table === "canonical_craft_recipe_definitions") payload.craft_recipe_kind = "item_exchange";
  if (table === "canonical_package_reward_groups") payload.selection_mode = "all";
  if (table === "canonical_package_reward_entries") payload.target_kind = "item";
  if (table === "canonical_package_reward_quarantines") Object.assign(payload, { target_kind: "item", quarantine_status: "open" });
  const references = foreignKeys.map((foreignKey) => {
    const approvedMiniPet = table === "canonical_owned_mini_pet_instances" && foreignKey.column === "mini_pet_id";
    return { column: foreignKey.column, targetTable: foreignKey.referencesTable, targetPkColumn: foreignKey.referencesColumn, identityLocatorSha256: locatorByTable.get(foreignKey.referencesTable)!, bindingScope: approvedMiniPet ? "APPROVED_CROSSWALK" : "MANIFEST", ...(approvedMiniPet ? { approvalSha256: H(999) } : {}) };
  });
  const approved = Object.values(origins).includes("APPROVED_CATALOG");
  const explicit = Object.values(origins).includes("EXPLICIT_RULE");
  const miniOwned = table === "canonical_owned_mini_pet_instances";
  const approvalKind = miniOwned ? "OCCURRENCE_CROSSWALK" : approved ? "CATALOG_PROVENANCE" : explicit ? "RULE_PROVENANCE" : null;
  const targetPayloadJson = stableDomainImportJson(payload);
  const valueOriginsJson = stableDomainImportJson(origins);
  const referenceBindingsJson = stableDomainImportJson(references.sort((left, right) => left.column.localeCompare(right.column, "en")));
  return { catalog_projection_record_id: `r${String(index).padStart(7, "0")}`, catalog_source_decision_id: decisionId, projection_locator: `v4-${table}`, identity_locator_sha256: locator, identity_mode: generated === undefined ? "REUSED" : "GENERATED", target_table_name: table, target_pk_column_name: pk, target_object_type: generated?.objectType ?? "REUSED_PRIMARY_KEY", target_source_namespace: generated?.sourceNamespace ?? `object-import.reused.${table}`, source_role: miniOwned ? "MINI_PET_BAG" : null, approval_kind: approvalKind, approval_sha256: approvalKind === null ? null : H(998), target_payload_json: targetPayloadJson, target_payload_fingerprint: hash(targetPayloadJson), value_origins_json: valueOriginsJson, value_origins_fingerprint: hash(valueOriginsJson), reference_bindings_json: referenceBindingsJson, reference_bindings_fingerprint: hash(referenceBindingsJson), record_domain: domain.toUpperCase(), decision_status: "PROJECT" };
}

function setPayload(row: any, changes: Record<string, unknown>): void {
  row.target_payload_json = stableDomainImportJson({ ...JSON.parse(row.target_payload_json), ...changes });
  row.target_payload_fingerprint = hash(row.target_payload_json);
}
function setReferences(row: any, references: any[]): void {
  row.reference_bindings_json = stableDomainImportJson([...references].sort((left, right) => left.column.localeCompare(right.column, "en")));
  row.reference_bindings_fingerprint = hash(row.reference_bindings_json);
}
function addPackageGraphRows(rows: any[]): void {
  const packageDefinition = rows.find((row) => row.target_table_name === "canonical_package_definitions")!;
  const rewardEntry = rows.find((row) => row.target_table_name === "canonical_package_reward_entries")!;
  const nestedReward = rows.find((row) => row.target_table_name === "canonical_package_nested_rewards")!;
  const secondPackageLocator = H(950), secondEntryLocator = H(951);
  const secondPackage = { ...packageDefinition, catalog_projection_record_id: "rpkgdef2", projection_locator: "v4-canonical_package_definitions-2", identity_locator_sha256: secondPackageLocator };
  const secondEntry = { ...rewardEntry, catalog_projection_record_id: "rpkgent2", projection_locator: "v4-canonical_package_reward_entries-2", identity_locator_sha256: secondEntryLocator };
  setPayload(rewardEntry, { target_kind: "item" });
  setPayload(secondEntry, { target_kind: "package", reward_order: "2" });
  nestedReward.identity_locator_sha256 = secondEntryLocator;
  nestedReward.projection_locator = "v4-canonical_package_nested_rewards-2";
  const references = JSON.parse(nestedReward.reference_bindings_json) as any[];
  for (const reference of references) { if (reference.column === "package_reward_entry_id") reference.identityLocatorSha256 = secondEntryLocator; if (reference.column === "package_id") reference.identityLocatorSha256 = secondPackageLocator; }
  setReferences(nestedReward, references);
  rows.push(secondPackage, secondEntry);
}

function refresh(input: any): void {
  const projected = input.decisions.map((decision: any) => {
    const outputs = input.rows.filter((row: any) => row.catalog_source_decision_id === decision.catalog_source_decision_id).sort((a: any, b: any) => `${a.target_table_name}\0${a.projection_locator}`.localeCompare(`${b.target_table_name}\0${b.projection_locator}`, "en")).map((row: any) => ({ projectionLocator: row.projection_locator, identityLocatorSha256: row.identity_locator_sha256, identityMode: row.identity_mode, targetTable: row.target_table_name, targetPkColumn: row.target_pk_column_name, targetObjectType: row.target_object_type, targetSourceNamespace: row.target_source_namespace, sourceRole: row.source_role, approvalKind: row.approval_kind, approvalSha256: row.approval_sha256, targetPayloadJson: row.target_payload_json, targetPayloadFingerprint: row.target_payload_fingerprint, valueOriginsJson: row.value_origins_json, valueOriginsFingerprint: row.value_origins_fingerprint, referenceBindingsJson: row.reference_bindings_json, referenceBindingsFingerprint: row.reference_bindings_fingerprint }));
    decision.projected_row_count = outputs.length;
    const body = { sourceLocatorSha256: decision.source_locator_sha256, sourcePayloadFingerprint: decision.source_payload_fingerprint, recordDomain: decision.record_domain, decisionStatus: decision.decision_status, decisionReason: decision.decision_reason, outputs };
    decision.decision_fingerprint = hash(stableDomainImportJson(body));
    return { ...body, decisionFingerprint: decision.decision_fingerprint };
  }).sort((a: any, b: any) => a.sourceLocatorSha256.localeCompare(b.sourceLocatorSha256, "en"));
  input.run.projected_row_count = input.rows.length;
  input.run.projection_sha256 = hash(stableDomainImportJson(projected));
}

function completeInput(): any {
  const rows: any[] = [], decisions: any[] = [];
  let rowIndex = 0;
  for (const [domain, targets] of Object.entries(policy.domainTargets)) {
    const decisionId = `d${String(decisions.length).padStart(7, "0")}`;
    const domainRows = targets.map((table) => projectionRow(table, rowIndex++, decisionId, domain));
    rows.push(...domainRows);
    decisions.push({ catalog_source_decision_id: decisionId, source_locator_sha256: H(decisions.length), source_payload_fingerprint: H(decisions.length + 50), record_domain: domain, decision_status: "PROJECT", decision_reason: null, projected_row_count: domainRows.length, decision_fingerprint: "", staging_record_domain: domain, record_kind: domain === "item" ? "ITEM_STACK" : domain === "mini-pet" ? "MINI_PET_BAG" : "SYNTHETIC", staging_projection_status: "PROJECT", staging_quarantine_reason: null, staging_source_namespace: domain === "item" ? "member.bag" : "wbs742-v4-gate5", staging_owner_locator_sha256: domain === "item" ? OWNER_LOCATOR : null, staging_source_locator_sha256: H(decisions.length), staging_payload_fingerprint: H(decisions.length + 50) });
  }
  decisions.push({ catalog_source_decision_id: "dwitness", source_locator_sha256: H(1750), source_payload_fingerprint: H(1751), record_domain: "item", decision_status: "IGNORE", decision_reason: "NOT_OBJECT_DOMAIN_INPUT", projected_row_count: 0, decision_fingerprint: "", staging_record_domain: "item", record_kind: "BAG_CONTAINER", staging_projection_status: "PROJECT", staging_quarantine_reason: null, staging_source_namespace: "member.bag", staging_owner_locator_sha256: OWNER_LOCATOR, staging_source_locator_sha256: H(1750), staging_payload_fingerprint: H(1751) });
  addPackageGraphRows(rows);
  const staging = { common_staging_run_id: "s1234567", raw_bundle_sha256: H(811), snapshot_manifest_sha256: H(812), extraction_manifest_sha256: H(813), staging_sha256: H(814), expected_file_count: 2, expected_total_bytes: "100", projected_file_count: 2, ignored_file_count: 0, run_status: "COMPLETE" };
  const upstreamEnvelopeSha256 = hash(stableDomainImportJson({ expectedFileCount: 2, expectedTotalBytes: "100", extractionManifestSha256: staging.extraction_manifest_sha256, ignoredFileCount: 0, projectedFileCount: 2, rawBundleSha256: staging.raw_bundle_sha256, snapshotManifestSha256: staging.snapshot_manifest_sha256, stagingSha256: staging.staging_sha256 }));
  const run = { catalog_projection_run_id: "p1234567", common_staging_run_id: staging.common_staging_run_id, catalog_version: policy.catalogVersion, projection_manifest_sha256: H(801), raw_bundle_sha256: staging.raw_bundle_sha256, snapshot_manifest_sha256: staging.snapshot_manifest_sha256, extraction_manifest_sha256: staging.extraction_manifest_sha256, expected_file_count: 2, expected_total_bytes: "100", projected_file_count: 2, ignored_file_count: 0, target_schema_sha256: policy.targetSchemaSha256, projection_sha256: "", upstream_envelope_sha256: upstreamEnvelopeSha256, expected_source_count: decisions.length, projected_source_count: decisions.filter((decision) => decision.decision_status === "PROJECT").length, quarantined_source_count: 0, ignored_source_count: decisions.filter((decision) => decision.decision_status === "IGNORE").length, projected_row_count: rows.length, run_status: "COMPLETE" };
  const input = { run, staging, decisions, rows };
  refresh(input);
  return input;
}

async function seed(database: DatabaseClient, input: any): Promise<void> {
  const audit = ["wbs742-v4-gate5", "2026-09-09 21:00:00", "wbs742-v4-gate5", "2026-09-09 21:00:00"];
  await database.execute("INSERT INTO data_migration_common_staging_runs(common_staging_run_id,raw_bundle_sha256,snapshot_manifest_sha256,extraction_manifest_sha256,staging_sha256,expected_file_count,expected_total_bytes,expected_record_count,projected_file_count,ignored_file_count,run_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?,'COMPLETE',?,?,?,?)", [input.staging.common_staging_run_id,input.staging.raw_bundle_sha256,input.staging.snapshot_manifest_sha256,input.staging.extraction_manifest_sha256,input.staging.staging_sha256,2,"100",input.decisions.length,2,0,...audit]);
  for (const [index, decision] of input.decisions.entries()) {
    const stagingRecordId = `s${String(index).padStart(7, "0")}`;
    await database.execute("INSERT INTO data_migration_common_staging_records(common_staging_record_id,common_staging_run_id,source_system,source_namespace,source_path_sha256,source_content_sha256,logical_source_name,source_pointer,identity_pointer,source_locator_sha256,owner_locator_sha256,occurrence_index,projection_locator,record_domain,record_kind,projection_status,quarantine_reason,quantity_value,observed_time,payload_json,payload_fingerprint,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,'LEGACY_JSON',?,?,?,'synthetic.json','','',?,?,0,NULL,?,?,?,NULL,NULL,NULL,'{}',?,?,?,?,?)", [stagingRecordId,input.staging.common_staging_run_id,decision.staging_source_namespace,H(1500+index),H(1600+index),decision.source_locator_sha256,decision.staging_owner_locator_sha256,decision.record_domain,decision.record_kind,decision.staging_projection_status,decision.source_payload_fingerprint,...audit]);
    decision.common_staging_record_id = stagingRecordId;
  }
  await database.execute("INSERT INTO data_migration_catalog_projection_runs(catalog_projection_run_id,common_staging_run_id,raw_bundle_sha256,snapshot_manifest_sha256,extraction_manifest_sha256,expected_file_count,expected_total_bytes,projected_file_count,ignored_file_count,upstream_envelope_sha256,catalog_version,projection_manifest_sha256,target_schema_sha256,projection_sha256,expected_source_count,projected_source_count,quarantined_source_count,ignored_source_count,projected_row_count,run_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'COMPLETE',?,?,?,?)", [input.run.catalog_projection_run_id,input.run.common_staging_run_id,input.run.raw_bundle_sha256,input.run.snapshot_manifest_sha256,input.run.extraction_manifest_sha256,2,"100",2,0,input.run.upstream_envelope_sha256,input.run.catalog_version,input.run.projection_manifest_sha256,input.run.target_schema_sha256,input.run.projection_sha256,input.run.expected_source_count,input.run.projected_source_count,input.run.quarantined_source_count,input.run.ignored_source_count,input.run.projected_row_count,...audit]);
  for (const decision of input.decisions) await database.execute("INSERT INTO data_migration_catalog_source_decisions(catalog_source_decision_id,catalog_projection_run_id,common_staging_record_id,source_locator_sha256,source_payload_fingerprint,record_domain,decision_status,decision_reason,projected_row_count,decision_fingerprint,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [decision.catalog_source_decision_id,input.run.catalog_projection_run_id,decision.common_staging_record_id,decision.source_locator_sha256,decision.source_payload_fingerprint,decision.record_domain,decision.decision_status,decision.decision_reason,decision.projected_row_count,decision.decision_fingerprint,...audit]);
  for (const row of input.rows) await database.execute("INSERT INTO data_migration_catalog_projection_records(catalog_projection_record_id,catalog_projection_run_id,catalog_source_decision_id,projection_locator,identity_locator_sha256,identity_mode,target_table_name,target_pk_column_name,target_object_type,target_source_namespace,source_role,approval_kind,approval_sha256,target_payload_json,target_payload_fingerprint,value_origins_json,value_origins_fingerprint,reference_bindings_json,reference_bindings_fingerprint,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [row.catalog_projection_record_id,input.run.catalog_projection_run_id,row.catalog_source_decision_id,row.projection_locator,row.identity_locator_sha256,row.identity_mode,row.target_table_name,row.target_pk_column_name,row.target_object_type,row.target_source_namespace,row.source_role,row.approval_kind,row.approval_sha256,row.target_payload_json,row.target_payload_fingerprint,row.value_origins_json,row.value_origins_fingerprint,row.reference_bindings_json,row.reference_bindings_fingerprint,...audit]);
}

interface Gate5Counts {
  targets: number;
  runs: number;
  decisions: number;
  records: number;
  projectionRuns: number;
  projectionRecords: number;
}

async function counts(database: DatabaseClient): Promise<Gate5Counts> {
  const scalar = async (sql: string): Promise<number> => Number((await database.query<Array<{ n: bigint }>>(sql))[0]!.n);
  let targets = 0;
  for (const table of policy.directTargets) targets += await scalar(`SELECT COUNT(*) n FROM ${table}`);
  return { targets, runs: await scalar("SELECT COUNT(*) n FROM data_migration_object_domain_import_runs"), decisions: await scalar("SELECT COUNT(*) n FROM data_migration_object_domain_import_decisions"), records: await scalar("SELECT COUNT(*) n FROM data_migration_object_domain_import_records"), projectionRuns: await scalar("SELECT COUNT(*) n FROM data_migration_catalog_projection_runs"), projectionRecords: await scalar("SELECT COUNT(*) n FROM data_migration_catalog_projection_records") };
}

if (process.env.WBS742_V4_GATE5_PHASE !== undefined) describe("WBS742 V4 Gate5 isolated MariaDB", () => {
  it(`runs ${process.env.WBS742_V4_GATE5_PHASE} with the exact V4 contract`, async () => {
    const config = loadConfig();
    assertObjectDomainImportDatabaseName(config.database.name);
    assert.deepEqual([config.database.host, config.database.port, config.database.name], ["127.0.0.1", 3364, "hoibot_rehearsal_wbs742_v4_gate5"]);
    assert.deepEqual(validateObjectDomainImportV4Gate3(loadGate3Documents()), { catalogVersion:"SC-20260902-1", deltaId:"SCD-WBS742-G3-20260909-1", evidenceSchemaVersion:"object-domain-import-gate3-evidence-v1", registeredTableCount:119, directTargetCount:47, targetColumnCount:263, definitionTargetCount:25, syntheticProjectionRowCount:49, comparedFieldValueCount:272 });
    const database = createDatabaseClient(config.database);
    const importer = new MariaObjectDomainImporter(database, () => new Date("2026-09-09T12:00:00Z"));
    try {
      if (process.env.WBS742_V4_GATE5_PHASE === "prepare") {
        const input = completeInput();
        assert.deepEqual([input.rows.length,new Set(input.rows.map((row:any)=>row.target_table_name)).size,policy.columns.length,policy.definitionTargets.length],[49,47,263,25]);
        assert.equal(input.decisions.every((decision:any)=>decision.record_domain===decision.staging_record_domain && Object.hasOwn(policy.domainTargets,decision.record_domain)),true);
        await seed(database,input);
        const before=await counts(database);
        assert.deepEqual(input.decisions.filter((decision:any)=>decision.staging_source_namespace==="member.bag").map((decision:any)=>[decision.record_kind,decision.decision_status,decision.decision_reason,decision.staging_owner_locator_sha256]), [["ITEM_STACK","PROJECT",null,OWNER_LOCATOR],["BAG_CONTAINER","IGNORE","NOT_OBJECT_DOMAIN_INPUT",OWNER_LOCATOR]]);
        await database.execute("UPDATE data_migration_common_staging_records SET owner_locator_sha256=NULL WHERE record_kind='BAG_CONTAINER'");
        await assert.rejects(()=>importer.importProjection("p1234567",policy,"wbs742-v4-gate5-owner-tamper"),/OBJECT_DOMAIN_IMPORT_ITEM_BAG_WITNESS_INVALID/);
        await database.execute("UPDATE data_migration_common_staging_records SET owner_locator_sha256=? WHERE record_kind='BAG_CONTAINER'",[OWNER_LOCATOR]);
        assert.deepEqual(await counts(database),before);
        await database.execute("CREATE TRIGGER trg_wbs742_v4_gate5_failure BEFORE INSERT ON canonical_player_currency_balances FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='WBS742_V4_GATE5_FORCED_FAILURE'");
        await assert.rejects(()=>importer.importProjection("p1234567",policy,"wbs742-v4-gate5"),/WBS742_V4_GATE5_FORCED_FAILURE/);
        await database.execute("DROP TRIGGER trg_wbs742_v4_gate5_failure");
        assert.deepEqual(await counts(database),before);
        const first=await importer.importProjection("p1234567",policy,"wbs742-v4-gate5");
        const after=await counts(database);
        assert.deepEqual([first.insertedCanonicalRows,first.replayed,after.targets-before.targets,after.runs,after.records],[49,false,49,1,49]);
        process.stdout.write(`WBS742_V4_GATE5_PREPARE ${JSON.stringify({before,after,rows:49,targets:47,columns:263,definitions:25,compared:272})}\n`);
      } else if (process.env.WBS742_V4_GATE5_PHASE === "replay-rollback") {
        const before=await counts(database);
        const replay=await importer.importProjection("p1234567",policy,"wbs742-v4-gate5-restart");
        assert.equal(replay.replayed,true);
        assert.deepEqual(await counts(database),before);
        assert.equal(await importer.rollback("p1234567",policy),1);
        const after=await counts(database);
        assert.deepEqual([after.targets,after.runs,after.decisions,after.records,after.projectionRuns,after.projectionRecords],[before.targets-49,0,0,0,before.projectionRuns,before.projectionRecords]);
        process.stdout.write(`WBS742_V4_GATE5_REPLAY_ROLLBACK ${JSON.stringify({before,after,replayed:true})}\n`);
      } else throw new Error("WBS742_V4_GATE5_PHASE_INVALID");
    } finally { await database.close(); }
  });
});
