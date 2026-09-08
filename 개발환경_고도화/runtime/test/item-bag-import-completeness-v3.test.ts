import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  assertObjectDomainImportPolicy,
  calculateObjectDomainImportComponentSemanticSha256,
  calculateObjectDomainImportContractSemanticSha256,
  MariaObjectDomainImporter,
  OBJECT_DOMAIN_IMPORT_SEMANTIC_PROJECTION_VERSION_V3,
  type DomainImportPolicy
} from "../src/data-migration/object-domain-importer.js";
import {
  applyObjectDomainImportProfileV2,
  calculateObjectDomainImportProfileV3Sha256,
  parseObjectDomainImportProfileV2,
  parseObjectDomainImportProfileV3,
  resolveObjectDomainImportProfileVersionV3
} from "../src/data-migration/object-domain-import-profile.js";

const contracts = new URL("../../migration-control/contracts/", import.meta.url);
const text = (name: string): string => readFileSync(new URL(name, contracts), "utf8");
const json = <T>(name: string): T => JSON.parse(text(name)) as T;

describe("WBS777 item bag import completeness V3", () => {
  const schema = json<{ columns: DomainImportPolicy["columns"] }>("object-domain-import-target-schema.v1.json");
  const identity = json<{ generatedCuidBindings: DomainImportPolicy["generatedBindings"]; reusedPrimaryKeys: DomainImportPolicy["reusedBindings"] }>("object-domain-import-identity-bindings.v1.json");
  const objectModel = json<{ registeredMigrations: string[]; tables: Array<{ table: string; foreignKeys?: Array<{ column: string; referencesTable: string; referencesColumn: string }> }> }>("object-data-model-standard.v1.json");
  const disposition = json<{ definitionSeed: string[]; stateImport: string[]; initialLedger: string[]; quarantineOnly: string[] }>("object-domain-import-disposition.v1.json");
  const fieldMap = json<{ recordQuarantine: string[]; mappings: Array<{ domain: string; targetTables: string[] }> }>("object-domain-import-field-map.v1.json");
  const v2 = parseObjectDomainImportProfileV2(text("object-domain-import-profile.v2.json"));
  const effective = applyObjectDomainImportProfileV2({
    columns: schema.columns,
    generatedBindings: identity.generatedCuidBindings,
    foreignKeys: objectModel.tables.flatMap((table) => (table.foreignKeys ?? []).map((foreignKey) => ({ table: table.table, ...foreignKey }))),
    definitionTargets: disposition.definitionSeed,
    directTargets: [...disposition.definitionSeed, ...disposition.stateImport, ...disposition.initialLedger, ...disposition.quarantineOnly],
    domainTargets: Object.fromEntries(fieldMap.mappings.map((mapping) => [mapping.domain, mapping.targetTables]))
  }, v2);

  it("binds the immutable V3 profile and semantic contract without changing the frozen 47 direct targets", () => {
    const profileText = text("object-domain-import-profile.v3.json");
    const profile = parseObjectDomainImportProfileV3(profileText);
    const contract = json<{ profileSemanticSha256: string; componentSemanticSha256: DomainImportPolicy["componentSemanticSha256"]; semanticHashPolicy: { currentImportContractProjectionSha256: string } }>("data-migration-object-domain-import.v3.json");
    assert.equal(resolveObjectDomainImportProfileVersionV3("v3"), "v3");
    assert.equal(calculateObjectDomainImportProfileV3Sha256(profileText), contract.profileSemanticSha256);
    assert.equal(calculateObjectDomainImportContractSemanticSha256(text("data-migration-object-domain-import.v3.json")), contract.semanticHashPolicy.currentImportContractProjectionSha256);
    assert.equal(profile.completenessProjection.witnessRecordKind, "BAG_CONTAINER");
    assert.deepEqual(profile.completenessProjection.sourceKeyRecordKinds, ["ITEM_STACK"]);
    assert.equal(profile.schemaPlan, "item-bag-import-completeness-schema-plan.v1.json");
    assert.equal(profile.witnessManifest, "item-bag-import-completeness-manifest.v1.json");
    assert.deepEqual([effective.directTargets.length, effective.definitionTargets.length, effective.columns.length], [47, 25, 252]);
    for (const key of ["identityBindings", "objectModel", "disposition", "fieldMap"] as const) {
      const document = key === "identityBindings" ? "object-domain-import-identity-bindings.v1.json" : key === "objectModel" ? "object-data-model-standard.v1.json" : key === "disposition" ? "object-domain-import-disposition.v1.json" : "object-domain-import-field-map.v1.json";
      assert.equal(calculateObjectDomainImportComponentSemanticSha256(key, text(document), effective.directTargets, OBJECT_DOMAIN_IMPORT_SEMANTIC_PROJECTION_VERSION_V3), contract.componentSemanticSha256[key]);
    }
  });

  it("registers migration 488, the witness FK and zero-row-safe counts", () => {
    const migration = readFileSync(new URL("../migrations/488_item_bag_import_completeness.sql", import.meta.url), "utf8");
    const rollback = readFileSync(new URL("../migrations/rollback/488_item_bag_import_completeness.rollback.sql", import.meta.url), "utf8");
    const table = objectModel.tables.find((candidate) => candidate.table === "player_item_bag_import_completeness_projections");
    assert.ok(objectModel.registeredMigrations.includes("488_item_bag_import_completeness.sql"));
    assert.ok(table);
    assert.match(migration, /FOREIGN KEY\(common_staging_record_id\) REFERENCES data_migration_common_staging_records/);
    assert.match(migration, /projected_stack_count=expected_source_key_count/);
    assert.doesNotMatch(migration, /expected_source_key_count>0|projected_stack_count>0/);
    assert.match(rollback, /ROLLBACK_488_PROJECTION_ROWS_EXIST/);
  });

  it("creates and verifies the baseline in the importer transaction and deletes it before target rollback", () => {
    const source = readFileSync(new URL("../src/data-migration/object-domain-importer.ts", import.meta.url), "utf8");
    const insert = source.indexOf("await this.insertItemBagCompleteness");
    const complete = source.indexOf("run_status='COMPLETE'", insert);
    const deleteProjection = source.indexOf("DELETE FROM player_item_bag_import_completeness_projections");
    const deleteTarget = source.indexOf("DELETE FROM ${receipt.target_table_name}", deleteProjection);
    assert.ok(insert > 0 && complete > insert);
    assert.ok(deleteProjection > 0 && deleteTarget > deleteProjection);
    assert.match(source, /canonical_item_inventory_ledger_entries WHERE player_id=\?/);
    assert.match(source, /OBJECT_DOMAIN_IMPORT_ITEM_BAG_COMPLETENESS_REPLAY_DRIFT/);
  });

  it("builds and exact-replays a zero-source BAG_CONTAINER baseline", async () => {
    const stored: Array<Record<string, unknown>> = [];
    const transaction = {
      query: async (sql: string): Promise<Array<Record<string, unknown>>> => {
        if (sql.startsWith("SELECT owned_item_stack_id")) return [];
        if (sql.startsWith("SELECT item_inventory_ledger_entry_id")) return [];
        if (sql.startsWith("SELECT player_id,object_domain_import_run_id")) return stored;
        if (sql.startsWith("SELECT player_id FROM canonical_players")) return [{ player_id: "play0001" }];
        throw new Error(`UNEXPECTED_QUERY:${sql}`);
      }
    };
    const importer = new MariaObjectDomainImporter({} as never) as unknown as {
      expectedItemBagCompleteness: (...args: unknown[]) => Promise<Array<Record<string, unknown>>>;
      verifyItemBagCompletenessReplay: (...args: unknown[]) => Promise<void>;
    };
    const v3 = json<{ profileSemanticSha256: string; semanticHashPolicy: { currentImportContractProjectionSha256: string } }>("data-migration-object-domain-import.v3.json");
    const policy = { importContractSha256: v3.semanticHashPolicy.currentImportContractProjectionSha256, itemBagCompletenessV3: { profileVersion: "OBJECT_DOMAIN_IMPORT_RELEVANT_V3", profileSemanticSha256: v3.profileSemanticSha256, sourceNamespace: "member.bag", witnessRecordDomain: "item", witnessRecordKind: "BAG_CONTAINER", sourceKeyRecordKinds: ["ITEM_STACK"] } };
    const witness = { common_staging_record_id: "wit00001", source_locator_sha256: "b".repeat(64), owner_locator_sha256: "c".repeat(64), payload_fingerprint: "d".repeat(64), source_namespace: "member.bag", record_domain: "item", record_kind: "BAG_CONTAINER", projection_status: "PROJECT", quarantine_reason: null };
    const witnessDecision = { common_staging_record_id: "wit00001", decision_status: "IGNORE", decision_reason: "NOT_OBJECT_DOMAIN_INPUT", projected_row_count: 0, record_kind: "BAG_CONTAINER" };
    const expected = await importer.expectedItemBagCompleteness(transaction, "run00001", [witness], [witnessDecision], { decisions: [witnessDecision], rows: [], importSha256: "e".repeat(64) }, policy, new Map());
    assert.equal(expected.length, 1);
    assert.deepEqual([expected[0]!.expected_source_key_count, expected[0]!.projected_stack_count, expected[0]!.item_ledger_entry_count], [0, 0, "0"]);
    stored.push({ ...expected[0]!, active_flag: 1, item_ledger_entry_count: "0", revision: "1" });
    await assert.doesNotReject(() => importer.verifyItemBagCompletenessReplay(transaction, expected, "run00001"));
    stored[0]!.stack_set_fingerprint = "f".repeat(64);
    await assert.rejects(() => importer.verifyItemBagCompletenessReplay(transaction, expected, "run00001"), /COMPLETENESS_REPLAY_DRIFT/);
  });

  it("accepts a V3-only policy and rejects a malformed witness contract", () => {
    const contract = json<{ componentSemanticSha256: DomainImportPolicy["componentSemanticSha256"]; semanticHashPolicy: { currentImportContractProjectionSha256: string }; profileSemanticSha256: string }>("data-migration-object-domain-import.v3.json");
    const exactDefinitionImports = v2.directTargetAdditions.map((target) => ({ table: target.table, definitionTable: target.foreignKey.referencesTable, definitionPkColumn: target.foreignKey.referencesColumn, foreignKeyColumn: target.foreignKey.column, sourceSystem: target.exactSource.sourceSystem, sourceNamespace: target.exactSource.sourceNamespace, sourceIdentifier: target.exactSource.sourceIdentifier, sourceIdentifierOrigin: target.exactSource.sourceIdentifierOrigin }));
    const policy: DomainImportPolicy = {
      catalogVersion: "SC-20260902-1", targetSchemaSha256: "a".repeat(64), importContractSha256: contract.semanticHashPolicy.currentImportContractProjectionSha256,
      acceptedImportContractSha256: [contract.semanticHashPolicy.currentImportContractProjectionSha256], componentSemanticSha256: contract.componentSemanticSha256, contractComponentSemanticSha256: contract.componentSemanticSha256,
      columns: effective.columns, generatedBindings: effective.generatedBindings, reusedBindings: identity.reusedPrimaryKeys, foreignKeys: effective.foreignKeys,
      directTargets: effective.directTargets, definitionTargets: effective.definitionTargets, domainTargets: effective.domainTargets, quarantineReasons: fieldMap.recordQuarantine,
      exactDefinitionImports, itemBagCompletenessV3: { profileVersion: "OBJECT_DOMAIN_IMPORT_RELEVANT_V3", profileSemanticSha256: contract.profileSemanticSha256, sourceNamespace: "member.bag", witnessRecordDomain: "item", witnessRecordKind: "BAG_CONTAINER", sourceKeyRecordKinds: ["ITEM_STACK"] }
    };
    assert.doesNotThrow(() => assertObjectDomainImportPolicy(policy));
    assert.throws(() => assertObjectDomainImportPolicy({ ...policy, itemBagCompletenessV3: { ...policy.itemBagCompletenessV3!, witnessRecordKind: "ITEM_STACK" as "BAG_CONTAINER" } }), /ITEM_BAG_COMPLETENESS_V3_INVALID/);
  });

  it("documents baseline continuation and keeps PET-EQUIPMENT actual-read validation out of this projection", () => {
    const contract = text("data-migration-object-domain-import.v3.json");
    assert.match(contract, /exact prefix/);
    assert.match(contract, /current final stack balances/);
    assert.match(contract, /current state equality.*forbidden/);
    assert.match(contract, /PET-EQUIPMENT.*consumer actual-read state/);
  });
});
