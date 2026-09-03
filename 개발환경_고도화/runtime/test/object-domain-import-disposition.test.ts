import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { ObjectDataModelContract } from "../src/catalog/object-data-model-contract.js";

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
    assert.equal(classified.length, 65);
    assert.equal(new Set(classified).size, classified.length);
    const frozenTables = [...classified].sort();
    const migrationTables = new Set<string>();
    for (const migration of disposition.objectContractMigrationBaseline) {
      const sql = readFileSync(new URL(`../migrations/${migration}`, import.meta.url), "utf8");
      for (const match of sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+([a-z][a-z0-9_]*)\s*\(/gi)) migrationTables.add(match[1]!);
    }
    assert.deepEqual([...migrationTables].sort(), frozenTables, "frozen table set must come from the actual migration SQL");
    const commonStagingTables = ["data_migration_common_staging_records", "data_migration_common_staging_runs"];
    assert.deepEqual(contract.tables.map((entry) => entry.table).filter((table) => !commonStagingTables.includes(table)).sort(), frozenTables);
    assert.deepEqual(contract.tables.map((entry) => entry.table).filter((table) => commonStagingTables.includes(table)).sort(), commonStagingTables);
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
    assert.deepEqual(disposition.initialLedger.sort(), ["canonical_currency_ledger_entries", "canonical_currency_operations"]);
    for (const table of disposition.runtimeOnly) assert.ok(!disposition.initialLedger.includes(table));
  });
});
