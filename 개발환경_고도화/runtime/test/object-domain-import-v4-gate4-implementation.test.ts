import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertObjectDomainImportPolicy } from "../src/data-migration/object-domain-importer.js";
import { buildObjectDomainImportV4Gate4Policy, validateObjectDomainImportV4Gate4 } from "../scripts/validate-object-domain-import-v4-gate4.js";

describe("WBS742 Gate 4 V4 implementation", () => {
  it("assembles the executable V4 policy without database access", () => {
    assert.deepEqual(validateObjectDomainImportV4Gate4(), {
      catalogVersion: "SC-20260902-1",
      deltaId: "SCD-WBS742-G4-20260909-1",
      evidenceSchemaVersion: "object-domain-import-gate4-evidence-v1",
      profileVersion: "OBJECT_DOMAIN_IMPORT_RELEVANT_V4",
      directTargetCount: 47,
      targetColumnCount: 263,
      definitionTargetCount: 25,
      acceptedContractCount: 1,
      targetColumnAdditionCount: 11,
      databaseAccess: "NONE"
    });
  });

  it("fails closed when the V4 implementation policy drifts", () => {
    const missingColumn = structuredClone(buildObjectDomainImportV4Gate4Policy());
    missingColumn.columns.pop();
    assert.throws(() => assertObjectDomainImportPolicy(missingColumn), /COLUMN_SCOPE_MISMATCH/);

    const missingProfile = structuredClone(buildObjectDomainImportV4Gate4Policy());
    missingProfile.objectDomainImportV4 = undefined;
    assert.throws(() => assertObjectDomainImportPolicy(missingProfile), /COLUMN_SCOPE_MISMATCH/);

    const incompatibleContract = structuredClone(buildObjectDomainImportV4Gate4Policy());
    incompatibleContract.acceptedImportContractSha256 = [...incompatibleContract.acceptedImportContractSha256, "f".repeat(64)];
    assert.throws(() => assertObjectDomainImportPolicy(incompatibleContract), /COMPATIBLE_CONTRACT_POLICY_INVALID/);

    const missingTarget = structuredClone(buildObjectDomainImportV4Gate4Policy());
    missingTarget.directTargets.pop();
    assert.throws(() => assertObjectDomainImportPolicy(missingTarget), /DIRECT_TARGET_SCOPE_MISMATCH/);

    const componentDrift = structuredClone(buildObjectDomainImportV4Gate4Policy());
    componentDrift.componentSemanticSha256.fieldMap = "f".repeat(64);
    assert.throws(() => assertObjectDomainImportPolicy(componentDrift), /COMPONENT_CONTRACT_DRIFT/);
  });
});
