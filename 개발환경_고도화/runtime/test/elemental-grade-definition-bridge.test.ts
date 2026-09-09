import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { validateObjectDataModelContract, type ObjectDataModelContract } from "../src/catalog/object-data-model-contract.js";
import {
  assertElementalGradeBridgeManifest,
  buildElementalGradeBridgeManifest,
  ELEMENTAL_GRADE_BRIDGE_COUNT,
  type ElementalGradeBridgeManifest,
  type ElementalGradeBridgeStagingRecord
} from "../src/data-migration/elemental-grade-definition-bridge-provider.js";
import { calculateEquipmentGradeCommonStagingPayloadFingerprint } from "../src/data-migration/equipment-grade-definition-adapter.js";

const sha256 = (value:string):string => createHash("sha256").update(value,"utf8").digest("hex");
function payload(index:number):string {
  return JSON.stringify({ nameList:[`display-${index}`],emoji:"⚙️",upgrade:index%2===0?0.5:1,drop:0,itemCost:index+1,pointCost:250000+index,maxLevel:100,battleExp:300+index,battleUpgradeExp:5,raidExp:500+index,raidUpgradeExp:7,castleExp:900+index,castleUpgradeExp:11 });
}
function records():ElementalGradeBridgeStagingRecord[] {
  return Array.from({length:ELEMENTAL_GRADE_BRIDGE_COUNT},(_,index) => {
    const sourcePointer=`/elemental/synthetic-${String(index+1).padStart(3,"0")}`;
    const payloadJson=payload(index);
    return { gradeOrder:index+1,sourcePointer,sourceLocatorSha256:sha256(`sealed\0${sourcePointer}`),payloadFingerprint:calculateEquipmentGradeCommonStagingPayloadFingerprint(payloadJson),payloadJson,recordDomain:"pet-equipment",recordKind:"EQUIPMENT_GRADE_DEFINITION",projectionStatus:"PROJECT" };
  });
}
function clone(manifest:ElementalGradeBridgeManifest):ElementalGradeBridgeManifest { return JSON.parse(JSON.stringify(manifest)) as ElementalGradeBridgeManifest; }

test("migration477 and its rollback are additive, descriptive and guarded", async () => {
  const [sql,rollback,mirror]=await Promise.all([
    readFile(resolve("migrations/477_elemental_grade_definition_bridge.sql"),"utf8"),
    readFile(resolve("migrations/rollback/477_elemental_grade_definition_bridge.rollback.sql"),"utf8"),
    readFile(resolve("../migration-control/rollback/477_elemental_grade_definition_bridge.sql"),"utf8")
  ]);
  assert.match(sql,/CREATE TABLE canonical_elemental_grade_definition_bridges/);
  assert.match(sql,/elemental_grade_definition_bridge_id CHAR\(8\) CHARACTER SET ascii COLLATE ascii_bin/);
  assert.match(sql,/equipment_grade_definition_id CHAR\(8\) CHARACTER SET ascii COLLATE ascii_bin/);
  assert.match(sql,/FOREIGN KEY \(equipment_grade_definition_id\)[\s\S]*REFERENCES canonical_equipment_grade_definitions \(equipment_grade_definition_id\) ON DELETE RESTRICT/);
  assert.doesNotMatch(sql,/\b`?id`?\b|\bCODE\b/i);
  assert.doesNotMatch(sql,/display_name|equipment_name|emoji|names_json/i);
  assert.equal((sql.match(/INSERT_TIME CHAR\(19\)/g)??[]).length,1);
  assert.equal((sql.match(/UPDATE_TIME CHAR\(19\)/g)??[]).length,1);
  assert.match(rollback,/EXISTS \(SELECT 1 FROM canonical_elemental_grade_definition_bridges\)/);
  assert.match(rollback,/source_system = 'CATALOG_MANIFEST'[\s\S]*source_namespace = 'elemental-grade-definition\.bridge\.v1'/);
  assert.match(rollback,/object_type = 'ELEMENTAL_GRADE_DEFINITION_BRIDGE'/);
  assert.match(rollback,/DROP TABLE IF EXISTS canonical_elemental_grade_definition_bridges/);
  assert.doesNotMatch(rollback,/DROP TABLE IF EXISTS (?:elemental_enhancement_grades|canonical_equipment_grade_definitions)/);
  assert.equal(mirror,rollback);
});

test("sealed staging creates a name-free exact 61-entry hash manifest", () => {
  const source=records();
  const manifest=buildElementalGradeBridgeManifest(source);
  assert.equal(manifest.entries.length,61);
  assert.deepEqual(manifest.entries.map((entry)=>entry.gradeOrder),Array.from({length:61},(_,index)=>index+1));
  assert.equal(new Set(manifest.entries.map((entry)=>entry.sourceIdentifier)).size,61);
  assert.doesNotThrow(()=>assertElementalGradeBridgeManifest(manifest));
  const serialized=JSON.stringify(manifest);
  for (const record of source) {
    assert.equal(serialized.includes(record.sourcePointer),false);
    assert.equal(serialized.includes(`display-${record.gradeOrder-1}`),false);
  }
  assert.doesNotMatch(serialized,/nameList|emoji|upgrade|battleExp|grade_display_name|equipment_grade_name/);
});

test("manifest generation and validation fail closed on order, scope, payload and hash drift", () => {
  const source=records();
  source[1]={...source[1]!,gradeOrder:1};
  assert.throws(()=>buildElementalGradeBridgeManifest(source),/ORDER_COVERAGE/);
  const wrongScope=records();
  wrongScope[0]={...wrongScope[0]!,sourcePointer:"/ring/synthetic-001"};
  assert.throws(()=>buildElementalGradeBridgeManifest(wrongScope),/STAGING_SCOPE/);
  const wrongPayload=records();
  wrongPayload[0]={...wrongPayload[0]!,payloadFingerprint:sha256("drift")};
  assert.throws(()=>buildElementalGradeBridgeManifest(wrongPayload),/STAGING_FINGERPRINT/);
  const numericString=records();
  numericString[0]={...numericString[0]!,payloadJson:numericString[0]!.payloadJson.replace('"upgrade":0.5','"upgrade":"0.5"')};
  numericString[0]!.payloadFingerprint=calculateEquipmentGradeCommonStagingPayloadFingerprint(numericString[0]!.payloadJson);
  assert.throws(()=>buildElementalGradeBridgeManifest(numericString),/STAGING_NUMERIC/);
  const manifest=buildElementalGradeBridgeManifest(records());
  const binding=clone(manifest); binding.entries[0]!.bindingFingerprint=sha256("binding-drift");
  assert.throws(()=>assertElementalGradeBridgeManifest(binding),/BINDING_DRIFT/);
  const numeric=clone(manifest); numeric.entries[0]!.numericTupleSha256=sha256("numeric-drift");
  assert.throws(()=>assertElementalGradeBridgeManifest(numeric),/NUMERIC_ORDER_DRIFT/);
  const top=clone(manifest); top.manifestSha256=sha256("manifest-drift");
  assert.throws(()=>assertElementalGradeBridgeManifest(top),/MANIFEST_DRIFT/);
});

test("amendment, schema plan and manifest contract pin migration119-to-475 without raw values", async () => {
  const root=resolve("../migration-control/contracts");
  const [amendment,schema,contract,objectModel]=await Promise.all([
    readFile(resolve(root,"elemental-grade-definition-bridge-amendment.v1.json"),"utf8").then(JSON.parse),
    readFile(resolve(root,"elemental-grade-definition-bridge-schema-plan.v1.json"),"utf8").then(JSON.parse),
    readFile(resolve(root,"elemental-grade-definition-bridge-manifest.v1.json"),"utf8").then(JSON.parse),
    readFile(resolve(root,"object-data-model-elemental-grade-bridge-amendment.v1.json"),"utf8").then(JSON.parse)
  ]);
  assert.deepEqual(amendment.dependencies,["119_spirit_enhance.sql","443_object_identity_audit_provider.sql","475_equipment_grade_definition_extension.sql"]);
  assert.equal(schema.primaryKey.column,"elemental_grade_definition_bridge_id");
  assert.equal(schema.foreignKeys[0].column,schema.foreignKeys[0].referencesColumn);
  assert.equal(contract.expectedCount,61);
  assert.equal(contract.containsDisplayNames,false);
  assert.equal(contract.containsAliases,false);
  assert.equal(contract.containsRawNumericValues,false);
  assert.deepEqual(contract.entryFields,["gradeOrder","sourceIdentifier","numericTupleSha256","bindingFingerprint"]);
  assert.equal(amendment.objectModelAmendment,"object-data-model-elemental-grade-bridge-amendment.v1.json");
  assert.doesNotThrow(()=>validateObjectDataModelContract(objectModel as ObjectDataModelContract));
});
