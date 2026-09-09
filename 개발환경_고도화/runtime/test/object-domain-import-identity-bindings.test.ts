import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

interface StandardTable { table: string; primaryKey: string[]; columns: Array<{ name: string; type: string }>; }
interface GeneratedBinding {
  domain: string;
  targetTable: string;
  targetPkColumn: string;
  objectType: string;
  sourceNamespace: string;
  identityLocatorKey: string;
  payloadFingerprint: string;
  replayReadOnly: boolean;
}
interface ReusedBinding { targetTable: string; targetPkColumn: string; sourceTable: string; sourceColumn: string; reason: string; }
interface IdentityContract {
  catalogVersion: string;
  format: string;
  locatorEncoding: string;
  locatorExcludes: string[];
  runReplayKeySeparation: string;
  generatedCuidBindings: GeneratedBinding[];
  reusedPrimaryKeys: ReusedBinding[];
  definitionProjectionLocator: string;
  ownershipLocator: string;
  transactionContract: string;
  replayContract: string;
}

const standard = JSON.parse(readFileSync(new URL("../../migration-control/contracts/object-data-model-standard.v1.json", import.meta.url), "utf8")) as { tables: StandardTable[] };
const fieldMap = JSON.parse(readFileSync(new URL("../../migration-control/contracts/object-domain-import-field-map.v1.json", import.meta.url), "utf8")) as { identityBindingContract: string; mappings: Array<{ targetTables: string[] }> };
const identity = JSON.parse(readFileSync(new URL("../../migration-control/contracts/object-domain-import-identity-bindings.v1.json", import.meta.url), "utf8")) as IdentityContract;

describe("object domain import identity bindings", () => {
  it("classifies every direct target PK exactly once", () => {
    assert.equal(fieldMap.identityBindingContract, "object-domain-import-identity-bindings.v1.json");
    const targets = [...new Set(fieldMap.mappings.flatMap((mapping) => mapping.targetTables))].sort();
    const bound = [...identity.generatedCuidBindings.map((entry) => entry.targetTable), ...identity.reusedPrimaryKeys.map((entry) => entry.targetTable)].sort();
    assert.equal(identity.generatedCuidBindings.length, 40);
    assert.equal(identity.reusedPrimaryKeys.length, 5);
    assert.deepEqual(bound, targets);
    assert.equal(new Set(bound).size, bound.length);
  });

  it("binds every generated CHAR(8) PK to an exact object type and namespace", () => {
    for (const binding of identity.generatedCuidBindings) {
      const table = standard.tables.find((candidate) => candidate.table === binding.targetTable);
      assert.ok(table, binding.targetTable);
      assert.deepEqual(table.primaryKey, [binding.targetPkColumn]);
      assert.equal(table.columns.find((column) => column.name === binding.targetPkColumn)?.type, "CHAR(8)");
      assert.match(binding.objectType, /^[A-Z][A-Z0-9_]{0,49}$/);
      assert.match(binding.sourceNamespace, /^[A-Za-z0-9_.-]{1,100}$/);
      assert.match(binding.identityLocatorKey, /^SHA256\(/);
      assert.match(binding.payloadFingerprint, /^SHA256\(/);
      assert.equal(binding.replayReadOnly, true);
    }
  });

  it("reuses only the player selection and package entry extension keys", () => {
    assert.deepEqual(identity.reusedPrimaryKeys.map((entry) => entry.targetTable).sort(), [
      "canonical_member_title_selections",
      "canonical_mini_pet_title_selections",
      "canonical_package_item_rewards",
      "canonical_package_nested_rewards",
      "canonical_pet_title_selections"
    ]);
    for (const binding of identity.reusedPrimaryKeys) {
      const target = standard.tables.find((table) => table.table === binding.targetTable);
      const source = standard.tables.find((table) => table.table === binding.sourceTable);
      assert.deepEqual(target?.primaryKey, [binding.targetPkColumn]);
      assert.ok(source?.columns.some((column) => column.name === binding.sourceColumn));
    }
  });

  it("separates locator, payload and run keys and requires atomic read-only replay", () => {
    assert.deepEqual(identity.locatorExcludes, ["raw_bundle_sha256", "payload_fingerprint", "audit timestamp"]);
    assert.match(identity.locatorEncoding, /display name alone forbidden/);
    assert.match(identity.runReplayKeySeparation, /MUST NOT allocate or select target identity/);
    assert.match(identity.definitionProjectionLocator, /WBS725/);
    assert.match(identity.ownershipLocator, /miniPet\/equipped/);
    assert.match(identity.ownershipLocator, /legacy furniture\.id/);
    assert.match(identity.transactionContract, /one outer transaction/);
    assert.match(identity.replayContract, /zero INSERT\/UPDATE/);
    assert.match(identity.replayContract, /fail closed/);
  });
});
