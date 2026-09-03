import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

interface FieldRule { source: string; targetColumns: string[]; conversion: string; }
interface DomainMapping {
  domain: string;
  sources: string[];
  targetTables: string[];
  transactionUnit: string;
  replayKey: string;
  instanceLocator: string;
  fields: FieldRule[];
  sourcePrecedence?: string;
  legacyMarketPolicy?: string;
  unmappedSourcePolicy?: string;
  ambiguousDefinitionPolicy?: string;
}
interface FieldMap {
  catalogVersion: string;
  format: string;
  actor: string;
  auditClock: string;
  targetSchemaContract: string;
  targetReferenceFormat: string;
  identityBinding: {
    providerTables: string[];
    sourceLocatorSha256: string;
    payloadFingerprint: string;
    targetIdentity: string;
    atomicity: string;
    exactReplay: string;
    concurrency: string;
    requiredProviderCorrection: string;
  };
  fatalPreflight: string[];
  recordQuarantine: string[];
  mappings: DomainMapping[];
  checkpointPolicy: string;
  approvedInputPolicy: string;
}
interface Disposition {
  definitionSeed: string[];
  stateImport: string[];
  derived: string[];
  initialLedger: string[];
  quarantineOnly: string[];
}
interface TargetSchema { columns: Array<{ table: string; column: string; sqlType: string; nullable: boolean }>; }

const fieldMap = JSON.parse(readFileSync(new URL("../../migration-control/contracts/object-domain-import-field-map.v1.json", import.meta.url), "utf8")) as FieldMap;
const disposition = JSON.parse(readFileSync(new URL("../../migration-control/contracts/object-domain-import-disposition.v1.json", import.meta.url), "utf8")) as Disposition;
const targetSchema = JSON.parse(readFileSync(new URL("../../migration-control/contracts/object-domain-import-target-schema.v1.json", import.meta.url), "utf8")) as TargetSchema;

describe("object domain typed import field map", () => {
  it("covers every seeded, imported, initial-ledger and quarantine table", () => {
    const required = [...disposition.definitionSeed, ...disposition.stateImport, ...disposition.initialLedger, ...disposition.quarantineOnly].sort();
    const covered = fieldMap.mappings.flatMap((mapping) => mapping.targetTables).sort();
    assert.equal(new Set(covered).size, covered.length);
    for (const table of required) assert.ok(covered.includes(table), table);
    assert.deepEqual(covered, required);
  });

  it("fixes a transaction, replay, locator and typed field contract per domain", () => {
    assert.equal(fieldMap.mappings.length, 12);
    for (const mapping of fieldMap.mappings) {
      assert.ok(mapping.sources.length > 0, mapping.domain);
      assert.ok(mapping.targetTables.length > 0, mapping.domain);
      assert.ok(mapping.transactionUnit.length > 0, mapping.domain);
      assert.match(mapping.replayKey, /SHA256|OBJECT_IMPORT/);
      assert.ok(mapping.instanceLocator.length > 0, mapping.domain);
      assert.ok(mapping.fields.length > 0, mapping.domain);
      const mappedTargets = mapping.fields.flatMap((field) => field.targetColumns);
      for (const field of mapping.fields) {
        assert.ok(field.source.length > 0 && field.targetColumns.length > 0 && field.conversion.length > 0);
        for (const target of field.targetColumns) {
          assert.match(target, /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/, target);
          const [table, column] = target.split(".");
          assert.ok(mapping.targetTables.includes(table!), `${mapping.domain}:${target}`);
          assert.doesNotMatch(column!, /(^|_)code$/i);
        }
      }
      assert.equal(new Set(mappedTargets).size, mappedTargets.length - (mapping.domain === "mini-pet" ? 9 : 0), `${mapping.domain}: unexpected duplicate target mappings`);
    }
  });

  it("maps every and only typed target-schema column by an exact qualified reference", () => {
    assert.equal(fieldMap.targetSchemaContract, "object-domain-import-target-schema.v1.json");
    assert.equal(fieldMap.targetReferenceFormat, "TABLE.COLUMN");
    const mapped = new Set(fieldMap.mappings.flatMap((mapping) => mapping.fields.flatMap((field) => field.targetColumns)));
    const schema = new Set(targetSchema.columns.map((entry) => `${entry.table}.${entry.column}`));
    assert.deepEqual([...mapped].sort(), [...schema].sort());
    for (const entry of targetSchema.columns) {
      assert.ok(entry.sqlType.length > 0, `${entry.table}.${entry.column}`);
      assert.equal(typeof entry.nullable, "boolean", `${entry.table}.${entry.column}`);
    }
  });

  it("keeps the optional furniture split source and incomplete market history fail-closed", () => {
    const furniture = fieldMap.mappings.find((mapping) => mapping.domain === "furniture");
    assert.ok(furniture?.sources.some((source) => source.startsWith("OPTIONAL_LEGACY_JSON:petHomePlacedFurniture.json")));
    assert.match(furniture?.sourcePrecedence ?? "", /fallback only/);
    assert.match(furniture?.legacyMarketPolicy ?? "", /not imported/);
    assert.match(furniture?.legacyMarketPolicy ?? "", /Non-furniture listings remain outside/);
    assert.match(furniture?.unmappedSourcePolicy ?? "", /rate is draw probability/);
    assert.match(furniture?.unmappedSourcePolicy ?? "", /never map it to charm_per_enhancement/);
    assert.match(furniture?.ambiguousDefinitionPolicy ?? "", /5,327 sealed owned occurrences/);
    assert.match(furniture?.ambiguousDefinitionPolicy ?? "", /87 owned occurrences/);
    assert.match(furniture?.ambiguousDefinitionPolicy ?? "", /misses 1,715/);
    assert.match(furniture?.ambiguousDefinitionPolicy ?? "", /leaving 1,299 occurrences across 789 signatures/);
    assert.match(furniture?.ambiguousDefinitionPolicy ?? "", /inactive legacy-recovered definition crosswalk/);
    assert.match(furniture?.ambiguousDefinitionPolicy ?? "", /DEFINITION_REFERENCE_AMBIGUOUS/);
    assert.match(furniture?.ambiguousDefinitionPolicy ?? "", /DEFINITION_REFERENCE_MISSING/);
    assert.ok(!furniture?.targetTables.includes("object_furniture_active_market_listings"));
    assert.match(furniture?.instanceLocator ?? "", /playerSourceHash\|legacy furniture\.id/);
    assert.match(furniture?.instanceLocator ?? "", /never fall back to display name or array index/);
    assert.match(JSON.stringify(furniture), /furnitureBag=bag, placed source=placed, exact active market payload=listed/);
    assert.match(JSON.stringify(furniture), /legacy SELLING maps to canonical active/);
    assert.doesNotMatch(JSON.stringify(furniture), /constant 0 and ACTIVE/);
  });

  it("preserves one-based title selection and a distinct equipped mini-pet occurrence", () => {
    for (const domain of ["member-title", "pet-title", "mini-pet-title"]) {
      const mapping = fieldMap.mappings.find((candidate) => candidate.domain === domain);
      assert.match(JSON.stringify(mapping), /one-based ordinal/);
      assert.match(JSON.stringify(mapping), /null or 0/);
      assert.doesNotMatch(JSON.stringify(mapping), /zero-based source index/);
      const definitionRule = mapping?.fields.find((field) => field.targetColumns.some((target) => target.endsWith("_title_definitions.base_sale_price")));
      const ownershipRule = mapping?.fields.find((field) => field.targetColumns.some((target) => target.endsWith("_title_instances.acquisition_price")));
      assert.match(`${definitionRule?.source} ${definitionRule?.conversion}`, /WBS725/);
      assert.match(definitionRule?.conversion ?? "", /base_sale_price is required/);
      assert.match(definitionRule?.conversion ?? "", /never inferred from list\[\]\.price/);
      assert.match(ownershipRule?.source ?? "", /list\[\]\.price/);
      assert.match(ownershipRule?.conversion ?? "", /acquisition_price=lossless unsigned integer list\[\]\.price/);
      assert.match(ownershipRule?.conversion ?? "", /ownership_status=owned/);
      assert.doesNotMatch(JSON.stringify(mapping), /\bACTIVE\b/);
    }
    const miniPet = fieldMap.mappings.find((mapping) => mapping.domain === "mini-pet");
    assert.match(miniPet?.instanceLocator ?? "", /separate occurrences/);
    assert.match(JSON.stringify(miniPet), /never fingerprint-match into miniPetBag/);
    assert.match(JSON.stringify(miniPet), /equipped_flag=false; bound_flag=false/);
    assert.match(JSON.stringify(miniPet), /equipped_flag=true; bound_flag=true/);
    assert.match(JSON.stringify(miniPet), /0 when missing, matching legacy runtime/);
  });

  it("preserves duplicate building rows while activating the legacy first-match winner", () => {
    const building = fieldMap.mappings.find((mapping) => mapping.domain === "building-recipe");
    assert.match(JSON.stringify(building), /only the first source-index occurrence is active/);
    assert.match(JSON.stringify(building), /later duplicates are retained inactive/);
    assert.match(JSON.stringify(building), /one building_upgrade recipe per source row/);
    assert.doesNotMatch(JSON.stringify(building), /BUILDING_UPGRADE/);
  });

  it("separates stable identity locator, payload fingerprint and run replay", () => {
    assert.deepEqual(fieldMap.identityBinding.providerTables, ["object_identities", "object_identity_crosswalks"]);
    assert.match(fieldMap.identityBinding.sourceLocatorSha256, /excludes raw bundle hash and payload/);
    assert.match(fieldMap.identityBinding.payloadFingerprint, /independently/);
    assert.match(fieldMap.identityBinding.targetIdentity, /reused verbatim/);
    assert.match(fieldMap.identityBinding.atomicity, /one outer transaction/);
    assert.match(fieldMap.identityBinding.exactReplay, /zero INSERT and zero UPDATE/);
    assert.match(fieldMap.identityBinding.concurrency, /exactly one identity/);
    assert.match(fieldMap.identityBinding.requiredProviderCorrection, /payload_fingerprint/);
  });

  it("records schema limitations for title selection and pet-skill equipment", () => {
    const petTitle = fieldMap.mappings.find((mapping) => mapping.domain === "pet-title");
    const miniPetTitle = fieldMap.mappings.find((mapping) => mapping.domain === "mini-pet-title");
    const petSkill = fieldMap.mappings.find((mapping) => mapping.domain === "pet-skill");
    assert.match(JSON.stringify(petTitle), /does not persist a particular owned_pet_id/);
    assert.match(JSON.stringify(miniPetTitle), /does not persist a particular owned_mini_pet_id/);
    assert.match(JSON.stringify(petSkill), /application verifies owned stack quantity>0/);
  });

  it("separates fatal preflight, record quarantine and approved isolated inputs", () => {
    assert.ok(fieldMap.fatalPreflight.includes("SOURCE_CONTENT_HASH_MISMATCH"));
    assert.ok(fieldMap.recordQuarantine.includes("SOURCE_LOCATOR_PAYLOAD_DRIFT"));
    assert.match(fieldMap.checkpointPolicy, /player's ownership graph atomically/);
    assert.match(fieldMap.approvedInputPolicy, /sealed RAW bundle in an isolated disposable database/);
    assert.match(fieldMap.approvedInputPolicy, /never write to repository snapshots or an operating database/);
  });
});
