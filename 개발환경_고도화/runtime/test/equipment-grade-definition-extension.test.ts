import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { validateObjectDataModelContract, type ObjectDataModelContract } from "../src/catalog/object-data-model-contract.js";
import { buildCatalogProjectionPlan, calculateCatalogTargetSchemaSha256, type CatalogProjectionPolicy } from "../src/data-migration/catalog-projection-provider.js";
import { buildEquipmentGradeProjectionManifest, calculateEquipmentGradeCommonStagingPayloadFingerprint, EQUIPMENT_GRADE_SOURCE_KEYS, type EquipmentGradeExpectedCounts } from "../src/data-migration/equipment-grade-definition-adapter.js";
import { applyEquipmentGradeImportExtension, parseEquipmentGradeImportExtension } from "../src/data-migration/equipment-grade-import-profile.js";

const contracts = resolve("../migration-control/contracts");
const migration = resolve("migrations/475_equipment_grade_definition_extension.sql");
const rollback = resolve("migrations/rollback/475_equipment_grade_definition_extension.rollback.sql");
const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

async function extension() {
  const names = {
    profile: "object-domain-import-profile.equipment-grade-extension.v1.json",
    schema: "object-domain-import-target-schema.equipment-grade-extension.v1.json",
    objectModel: "object-data-model-equipment-grade-extension.v1.json",
    fieldMap: "object-domain-import-field-map.equipment-grade-extension.v1.json",
    catalog: "equipment-grade-catalog-projection.v1.json"
  };
  return parseEquipmentGradeImportExtension(Object.fromEntries(await Promise.all(Object.entries(names).map(async ([key, name]) => [key, await readFile(resolve(contracts, name), "utf8")]))) as Parameters<typeof parseEquipmentGradeImportExtension>[0]);
}

test("migration 475 is additive, descriptive and rollback ordered", async () => {
  const [sql, undo] = await Promise.all([readFile(migration, "utf8"), readFile(rollback, "utf8")]);
  assert.match(sql, /CREATE TABLE canonical_equipment_grade_definitions/);
  assert.match(sql, /CREATE TABLE canonical_equipment_grade_aliases/);
  assert.doesNotMatch(sql, /ALTER TABLE canonical_equipment_definitions/);
  assert.doesNotMatch(sql, /\bCODE\b|\b`?id`?\b/i);
  assert.match(sql, /UNIQUE KEY uq_equipment_grade_source_pointer \(source_definition_pointer\)/);
  assert.match(sql, /UNIQUE KEY uq_equipment_grade_alias_order \(equipment_grade_definition_id, alias_order\)/);
  assert.match(undo, /EXISTS \(SELECT 1 FROM canonical_equipment_grade_aliases\)/);
  assert.match(undo, /EXISTS \(SELECT 1 FROM canonical_equipment_grade_definitions\)/);
  assert.ok(undo.indexOf("canonical_equipment_grade_aliases") < undo.indexOf("canonical_equipment_grade_definitions"));
  assert.equal((sql.match(/INSERT_TIME CHAR\(19\)/g) ?? []).length, 2);
  assert.equal((sql.match(/UPDATE_TIME CHAR\(19\)/g) ?? []).length, 2);
});

test("extension contracts cover all 13 source keys once and satisfy object standard", async () => {
  const ext = await extension();
  const model = JSON.parse(await readFile(resolve(contracts, "object-data-model-equipment-grade-extension.v1.json"), "utf8")) as ObjectDataModelContract;
  assert.doesNotThrow(() => validateObjectDataModelContract(model));
  assert.equal(ext.fieldMap.fields.length, 13);
  assert.deepEqual([...ext.fieldMap.fields.map((row) => row.source)].sort(), [...EQUIPMENT_GRADE_SOURCE_KEYS].sort());
  assert.equal(ext.catalog.coverage.unmapped, 0);
  assert.equal(ext.catalog.coverage.extra, 0);
  assert.equal(ext.catalog.coverage.duplicateMapping, 0);
  const effective = applyEquipmentGradeImportExtension({ columns: [], generatedBindings: [], foreignKeys: [], definitionTargets: [], directTargets: [], domainTargets: {} }, ext);
  assert.equal(effective.columns.length, 21);
  assert.deepEqual(effective.directTargets, ["canonical_equipment_grade_definitions", "canonical_equipment_grade_aliases"]);
  assert.deepEqual(effective.definitionTargets, ["canonical_equipment_grade_definitions"]);
  assert.equal(effective.foreignKeys[0]?.column, effective.foreignKeys[0]?.referencesColumn);
});

test("synthetic projection preserves exact grade pointer, numeric fields, alias order and duplicate alias text", async () => {
  const ext = await extension();
  const definition = (names: string[], emoji: string, upgrade: string) => `{"nameList":${JSON.stringify(names)},"emoji":${JSON.stringify(emoji)},"upgrade":${upgrade},"drop":0,"itemCost":1e3,"pointCost":250000,"maxLevel":100,"battleExp":300,"battleUpgradeExp":5,"raidExp":500,"raidUpgradeExp":7,"castleExp":900,"castleUpgradeExp":11}`;
  const payloads = [definition(["공통별칭", "합성별칭"], "⚙️", "0.125"), definition(["공통별칭"], "💍", "1")];
  const pointers = ["/elemental/grade~1alpha", "/ring/grade~0beta"];
  const records = payloads.map((payloadJson, index) => ({ sourcePointer: pointers[index]!, sourceLocatorSha256: sha256(pointers[index]!), payloadFingerprint: calculateEquipmentGradeCommonStagingPayloadFingerprint(payloadJson), payloadJson, recordDomain: "pet-equipment", recordKind: "EQUIPMENT_GRADE_DEFINITION", projectionStatus: "PROJECT" as const }));
  const expected: EquipmentGradeExpectedCounts = { definitions: 2, aliases: 3, elementalDefinitions: 1, elementalAliases: 2, ringDefinitions: 1, ringAliases: 1 };
  const schemaText = JSON.stringify({ catalogVersion: "SC-20260902-1", columns: ext.schema.columns });
  const targetSchemaSha256 = calculateCatalogTargetSchemaSha256(schemaText);
  const manifest = buildEquipmentGradeProjectionManifest(records, {
    commonStagingRunId: "a1b2c3d4", commonStagingSha256: sha256("staging"), rawBundleSha256: sha256("raw"),
    snapshotManifestSha256: sha256("snapshot"), extractionManifestSha256: sha256("extraction"), targetSchemaSha256, actor: "equipment-grade-test",
    expectedFileCount: 1, expectedTotalBytes: "31289", projectedFileCount: 1, ignoredFileCount: 0
  }, expected);
  assert.equal(manifest.sources.length, 2);
  assert.equal(manifest.sources.flatMap((source) => source.outputs).length, 5);
  const grade = manifest.sources[0]!.outputs[0]!;
  assert.equal(grade.payload.source_definition_pointer, "/elemental/grade~1alpha");
  assert.equal(grade.payload.equipment_grade_name, "grade/alpha");
  assert.equal(grade.payload.item_cost_quantity, "1000");
  assert.equal(grade.payload.battle_experience_per_enhancement_amount, "5");
  assert.equal(grade.payload.raid_experience_per_enhancement_amount, "7");
  assert.equal(grade.payload.castle_experience_per_enhancement_amount, "11");
  assert.deepEqual(manifest.sources[0]!.outputs.slice(1).map((row) => row.payload.alias_order), ["0", "1"]);
  assert.equal(manifest.sources[0]!.outputs[1]!.payload.equipment_name, manifest.sources[1]!.outputs[1]!.payload.equipment_name);
  assert.notEqual(manifest.sources[0]!.outputs[0]!.projectionLocator, manifest.sources[1]!.outputs[0]!.projectionLocator);
  const policy: CatalogProjectionPolicy = {
    targetSchemaSha256, columns: ext.schema.columns, generatedCuidBindings: ext.profile.generatedCuidBindings,
    reusedPrimaryKeys: [], foreignKeys: ext.profile.foreignKeys, domainTargets: ext.profile.domainTargetAdditions,
    quarantineReasons: ["SOURCE_SHAPE_MISMATCH"]
  };
  assert.doesNotThrow(() => buildCatalogProjectionPlan(manifest, policy));
});

test("adapter fails closed on missing, extra, non-integral and out-of-range values", async () => {
  const base = { nameList: ["합성"], emoji: "⚙️", upgrade: 0.5, drop: 0, itemCost: 1, pointCost: 2, maxLevel: 3, battleExp: 4, battleUpgradeExp: 5, raidExp: 6, raidUpgradeExp: 7, castleExp: 8, castleUpgradeExp: 9 } as Record<string, unknown>;
  const envelope = { commonStagingRunId: "a1b2c3d4", commonStagingSha256: sha256("s"), rawBundleSha256: sha256("r"), snapshotManifestSha256: sha256("m"), extractionManifestSha256: sha256("e"), targetSchemaSha256: sha256("t"), actor: "test", expectedFileCount: 1, expectedTotalBytes: "31289", projectedFileCount: 1, ignoredFileCount: 0 };
  const expected: EquipmentGradeExpectedCounts = { definitions: 1, aliases: 1, elementalDefinitions: 1, elementalAliases: 1, ringDefinitions: 0, ringAliases: 0 };
  const project = (row: Record<string, unknown>) => { const payloadJson = JSON.stringify(row); return buildEquipmentGradeProjectionManifest([{ sourcePointer: "/elemental/synthetic", sourceLocatorSha256: sha256("l"), payloadFingerprint: calculateEquipmentGradeCommonStagingPayloadFingerprint(payloadJson), payloadJson, recordDomain: "pet-equipment", recordKind: "EQUIPMENT_GRADE_DEFINITION", projectionStatus: "PROJECT" }], envelope, expected); };
  const missing = { ...base }; delete missing.emoji;
  assert.throws(() => project(missing), /SOURCE_KEY_COVERAGE/);
  assert.throws(() => project({ ...base, unknown: 1 }), /SOURCE_KEY_COVERAGE/);
  assert.throws(() => project({ ...base, itemCost: 1.5 }), /INTEGER_REQUIRED/);
  assert.throws(() => project({ ...base, upgrade: 1.1 }), /PROBABILITY_RANGE/);
  const validJson = JSON.stringify(base);
  assert.throws(() => buildEquipmentGradeProjectionManifest([{ sourcePointer: "/elemental/synthetic", sourceLocatorSha256: sha256("l"), payloadFingerprint: sha256("different-source-payload"), payloadJson: validJson, recordDomain: "pet-equipment", recordKind: "EQUIPMENT_GRADE_DEFINITION", projectionStatus: "PROJECT" }], envelope, expected), /PAYLOAD_FINGERPRINT_MISMATCH/);
  assert.throws(() => buildEquipmentGradeProjectionManifest([{ sourcePointer: "/elemental/synthetic", sourceLocatorSha256: sha256("l"), payloadFingerprint: calculateEquipmentGradeCommonStagingPayloadFingerprint(validJson), payloadJson: validJson, recordDomain: "pet-equipment", recordKind: "EQUIPMENT_GRADE_DEFINITION", projectionStatus: "PROJECT" }], { ...envelope, expectedTotalBytes: "0", projectedFileCount: 0 }, expected), /STAGING_ENVELOPE_COUNT_INVALID/);
});
