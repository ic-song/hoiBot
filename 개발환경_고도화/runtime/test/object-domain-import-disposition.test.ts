import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { ObjectDataModelContract } from "../src/catalog/object-data-model-contract.js";
import { calculateObjectDomainImportComponentSemanticSha256 } from "../src/data-migration/object-domain-importer.js";

interface ImportDisposition {
  catalogVersion: string;
  format: string;
  objectContractMigrationBaseline: string[];
  domainTableSetSha256: string;
  definitionSeed: string[];
  stateImport: string[];
  derived: string[];
  initialLedger: string[];
  quarantineOnly: string[];
  runtimeOnly: string[];
  sourceSystems: string[];
  definitionBeforeOwnership: boolean;
  displayNameIsIdentity: boolean;
  legacyCodeIsCanonicalIdentity: boolean;
  operationalSnapshotWriteAllowed: boolean;
  gate5InputPolicy: string;
}

const contract = JSON.parse(readFileSync(new URL("../../migration-control/contracts/object-data-model-standard.v1.json", import.meta.url), "utf8")) as ObjectDataModelContract;
const disposition = JSON.parse(readFileSync(new URL("../../migration-control/contracts/object-domain-import-disposition.v1.json", import.meta.url), "utf8")) as ImportDisposition;
const importContract = JSON.parse(readFileSync(new URL("../../migration-control/contracts/data-migration-object-domain-import.v1.json", import.meta.url), "utf8")) as { componentSemanticSha256: { disposition: string } };

describe("object domain import disposition", () => {
  it("classifies every canonical contract table exactly once", () => {
    const classified = [
      ...disposition.definitionSeed,
      ...disposition.stateImport,
      ...disposition.derived,
      ...disposition.initialLedger,
      ...disposition.quarantineOnly,
      ...disposition.runtimeOnly
    ];
    assert.equal(classified.length, 86);
    assert.equal(new Set(classified).size, classified.length);
    const frozenTables = [...classified].sort();
    const migrationTables = new Set<string>();
    for (const migration of disposition.objectContractMigrationBaseline) {
      const sql = readFileSync(new URL(`../migrations/${migration}`, import.meta.url), "utf8");
      for (const match of sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+([a-z][a-z0-9_]*)\s*\(/gi)) migrationTables.add(match[1]!);
    }
    assert.deepEqual([...migrationTables].sort(), frozenTables, "frozen table set must come from the actual migration SQL");
    const migrationPipelineTables = ["data_migration_common_staging_records", "data_migration_common_staging_runs", "data_migration_catalog_projection_records", "data_migration_catalog_projection_runs", "data_migration_catalog_source_decisions", "data_migration_object_domain_import_runs", "data_migration_object_domain_import_decisions", "data_migration_object_domain_import_records"].sort();
    assert.deepEqual(contract.tables.map((entry) => entry.table).filter((table) => !migrationPipelineTables.includes(table)).sort(), frozenTables);
    assert.deepEqual(contract.tables.map((entry) => entry.table).filter((table) => migrationPipelineTables.includes(table)).sort(), migrationPipelineTables);
    assert.ok(disposition.objectContractMigrationBaseline.every((migration) => contract.registeredMigrations.includes(migration)));
    assert.equal(createHash("sha256").update(frozenTables.join("\n")).digest("hex"), disposition.domainTableSetSha256);
  });

  it("freezes the no-CODE, no-display-name identity and fixture boundaries", () => {
    assert.equal(disposition.catalogVersion, "SC-20260902-1");
    assert.equal(disposition.format, "hoibot-object-domain-import-disposition-v1");
    assert.deepEqual(disposition.sourceSystems, ["LEGACY_JSON", "CODE_SEED", "RUNTIME_DB"]);
    assert.equal(disposition.definitionBeforeOwnership, true);
    assert.equal(disposition.displayNameIsIdentity, false);
    assert.equal(disposition.legacyCodeIsCanonicalIdentity, false);
    assert.equal(disposition.operationalSnapshotWriteAllowed, false);
    assert.equal(disposition.gate5InputPolicy, "SEALED_APPROVED_RAW_IN_ISOLATED_DATABASE_ONLY");
  });

  it("imports all three title scopes and pet skills without conflating them", () => {
    for (const table of [
      "canonical_owned_member_title_instances",
      "canonical_owned_pet_title_instances",
      "canonical_owned_mini_pet_title_instances",
      "canonical_member_title_selections",
      "canonical_pet_title_selections",
      "canonical_mini_pet_title_selections",
      "canonical_owned_pet_skill_stacks",
      "canonical_owned_pet_skill_equipments"
    ]) assert.ok(disposition.stateImport.includes(table), table);
  });

  it("creates only currency baseline history and never invents other historical operations", () => {
    assert.deepEqual(disposition.initialLedger.slice().sort(), ["canonical_currency_ledger_entries", "canonical_currency_operations"]);
    for (const table of disposition.runtimeOnly) assert.ok(!disposition.initialLedger.includes(table));
  });

  it("keeps the 461~466 identity crosswalk derived and all new operation history runtime-only", () => {
    assert.ok(disposition.derived.includes("canonical_player_identity_crosswalks"));
    const runtimeOnly = [
      "canonical_app_wiring_operations",
      "canonical_app_wiring_receipt_links",
      "canonical_daily_prayer_operations",
      "canonical_home_aggregate_operations",
      "canonical_market_operations",
      "canonical_member_title_operations",
      "canonical_mini_pet_title_operations",
      "canonical_package_use_operations",
      "canonical_pet_explore_event_control_operations",
      "canonical_pet_explore_operations",
      "canonical_pet_title_operations",
      "canonical_player_identity_operations",
      "canonical_market_transfer_ledger_entries",
      "canonical_package_use_reward_ledger_entries",
      "canonical_home_aggregate_operation_participants",
      "canonical_market_operation_participants",
      "canonical_member_title_operation_participants",
      "canonical_mini_pet_title_operation_participants",
      "canonical_pet_title_operation_participants",
      "canonical_player_identity_operation_participants"
    ];
    for (const table of runtimeOnly) assert.ok(disposition.runtimeOnly.includes(table), table);
  });

  it("excludes runtime-only migration growth from the frozen direct-import semantic identity", () => {
    const directTargets = [...disposition.definitionSeed, ...disposition.stateImport, ...disposition.initialLedger, ...disposition.quarantineOnly];
    const semanticHash = (value: ImportDisposition): string => calculateObjectDomainImportComponentSemanticSha256("disposition", JSON.stringify(value), directTargets);
    assert.equal(semanticHash(disposition), importContract.componentSemanticSha256.disposition);
    const runtimeGrowth = structuredClone(disposition);
    runtimeGrowth.objectContractMigrationBaseline.push("999_runtime_only_probe.sql");
    runtimeGrowth.runtimeOnly.push("canonical_runtime_only_probe");
    runtimeGrowth.domainTableSetSha256 = "0".repeat(64);
    assert.equal(semanticHash(runtimeGrowth), semanticHash(disposition));
    const directDrift = structuredClone(disposition);
    directDrift.definitionSeed = directDrift.definitionSeed.slice().reverse();
    assert.notEqual(semanticHash(directDrift), semanticHash(disposition));
  });
});
