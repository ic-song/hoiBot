import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

type Column = { table: string; column: string };
type DispositionV1 = {
  definitionSeed: string[];
  stateImport: string[];
  derived: string[];
  initialLedger: string[];
  quarantineOnly: string[];
  runtimeOnly: string[];
};
type DispositionV4 = {
  registeredTableCount: number;
  baseClassifiedTableCount: number;
  additions: { derived: string[]; runtimeOnly: string[] };
  operationalDataAllowed: boolean;
};
type ProfileV2 = { directTargetAdditions: Array<{ table: string; columns: Column[] }> };
type Schema = { columns: Column[] };
type ObjectModel = { tables: Array<{ table: string }> };
export type Gate3Fixture = {
  format: string;
  catalogVersion: string;
  deltaId: string;
  evidenceSchemaVersion: string;
  profileVersion: string;
  nonIdentifying: boolean;
  registeredTableCount: number;
  directTargetCount: number;
  targetColumnCount: number;
  definitionTargetCount: number;
  syntheticProjectionRowCount: number;
  comparedFieldValueCount: number;
  additionalProjectionRows: Array<{ table: string; reason: string }>;
};

export interface Gate3Documents {
  fixture: Gate3Fixture;
  dispositionV1: DispositionV1;
  dispositionV4: DispositionV4;
  profileV2: ProfileV2;
  schemaV1: Schema;
  schemaV4: Schema;
  objectModel: ObjectModel;
}

export interface Gate3Summary {
  catalogVersion: string;
  deltaId: string;
  evidenceSchemaVersion: string;
  registeredTableCount: number;
  directTargetCount: number;
  targetColumnCount: number;
  definitionTargetCount: number;
  syntheticProjectionRowCount: number;
  comparedFieldValueCount: number;
}

const contracts = new URL("../../migration-control/contracts/", import.meta.url);
const fixtures = new URL("../../migration-control/fixtures/synthetic-relational/", import.meta.url);
const json = <T>(name: string, base = contracts): T => JSON.parse(readFileSync(new URL(name, base), "utf8")) as T;
const unique = (values: string[], error: string): void => {
  if (new Set(values).size !== values.length) throw new Error(error);
};

export function loadGate3Documents(): Gate3Documents {
  return {
    fixture: json<Gate3Fixture>("data-migration-object-domain-import-v4.json", fixtures),
    dispositionV1: json<DispositionV1>("object-domain-import-disposition.v1.json"),
    dispositionV4: json<DispositionV4>("object-domain-import-disposition.v4.json"),
    profileV2: json<ProfileV2>("object-domain-import-profile.v2.json"),
    schemaV1: json<Schema>("object-domain-import-target-schema.v1.json"),
    schemaV4: json<Schema>("object-domain-import-target-schema.v4.json"),
    objectModel: json<ObjectModel>("object-data-model-standard.v1.json")
  };
}

export function validateObjectDomainImportV4Gate3(documents: Gate3Documents): Gate3Summary {
  const { fixture, dispositionV1, dispositionV4, profileV2, schemaV1, schemaV4, objectModel } = documents;
  if (fixture.format !== "hoibot-object-domain-import-synthetic-fixture-v4" || fixture.profileVersion !== "OBJECT_DOMAIN_IMPORT_RELEVANT_V4" || !fixture.nonIdentifying) throw new Error("WBS742_GATE3_FIXTURE_IDENTITY_INVALID");
  if (fixture.catalogVersion !== "SC-20260902-1" || fixture.deltaId !== "SCD-WBS742-G3-20260909-1" || fixture.evidenceSchemaVersion !== "object-domain-import-gate3-evidence-v1") throw new Error("WBS742_GATE3_VERSION_IDENTITY_INVALID");
  unique([fixture.catalogVersion, fixture.deltaId, fixture.evidenceSchemaVersion], "WBS742_GATE3_VERSION_IDENTITY_COLLISION");

  const baseClassified = [
    ...dispositionV1.definitionSeed,
    ...dispositionV1.stateImport,
    ...dispositionV1.derived,
    ...dispositionV1.initialLedger,
    ...dispositionV1.quarantineOnly,
    ...dispositionV1.runtimeOnly
  ];
  const classified = [...baseClassified, ...dispositionV4.additions.derived, ...dispositionV4.additions.runtimeOnly];
  const registeredTables = objectModel.tables.map((table) => table.table);
  unique(classified, "WBS742_GATE3_DISPOSITION_DUPLICATE");
  unique(registeredTables, "WBS742_GATE3_OBJECT_MODEL_DUPLICATE");
  if (baseClassified.length !== dispositionV4.baseClassifiedTableCount || classified.length !== dispositionV4.registeredTableCount || dispositionV4.operationalDataAllowed) throw new Error("WBS742_GATE3_DISPOSITION_COUNT_INVALID");
  if (classified.slice().sort().join("\0") !== registeredTables.slice().sort().join("\0")) throw new Error("WBS742_GATE3_REGISTERED_TABLE_SET_DRIFT");

  const additions = profileV2.directTargetAdditions;
  const directTargets = [
    ...dispositionV1.definitionSeed,
    ...dispositionV1.stateImport,
    ...dispositionV1.initialLedger,
    ...dispositionV1.quarantineOnly,
    ...additions.map((target) => target.table)
  ];
  const definitionTargets = [...dispositionV1.definitionSeed, ...additions.map((target) => target.table)];
  const columns = [...schemaV1.columns, ...additions.flatMap((target) => target.columns), ...schemaV4.columns];
  unique(directTargets, "WBS742_GATE3_DIRECT_TARGET_DUPLICATE");
  unique(definitionTargets, "WBS742_GATE3_DEFINITION_TARGET_DUPLICATE");
  unique(columns.map((column) => `${column.table}.${column.column}`), "WBS742_GATE3_TARGET_COLUMN_DUPLICATE");
  if (schemaV4.columns.length !== 11 || schemaV4.columns.some((column) => column.table !== "canonical_pet_skill_definitions")) throw new Error("WBS742_GATE3_V4_COLUMN_SCOPE_INVALID");

  const rowTargets = [...directTargets, ...fixture.additionalProjectionRows.map((row) => row.table)];
  if (fixture.additionalProjectionRows.length !== 2 || fixture.additionalProjectionRows[0]?.table !== "canonical_package_definitions" || fixture.additionalProjectionRows[1]?.table !== "canonical_package_reward_entries") throw new Error("WBS742_GATE3_ADDITIONAL_ROW_PLAN_INVALID");
  if (new Set(rowTargets).size !== directTargets.length || directTargets.some((table) => !rowTargets.includes(table))) throw new Error("WBS742_GATE3_ROW_TARGET_COVERAGE_INVALID");
  const columnCounts = new Map<string, number>();
  for (const column of columns) columnCounts.set(column.table, (columnCounts.get(column.table) ?? 0) + 1);
  if (directTargets.some((table) => !columnCounts.has(table))) throw new Error("WBS742_GATE3_DIRECT_TARGET_SCHEMA_MISSING");
  const comparedFieldValueCount = rowTargets.reduce((sum, table) => sum + (columnCounts.get(table) ?? 0), 0);
  const summary: Gate3Summary = {
    catalogVersion: fixture.catalogVersion,
    deltaId: fixture.deltaId,
    evidenceSchemaVersion: fixture.evidenceSchemaVersion,
    registeredTableCount: registeredTables.length,
    directTargetCount: directTargets.length,
    targetColumnCount: columns.length,
    definitionTargetCount: definitionTargets.length,
    syntheticProjectionRowCount: rowTargets.length,
    comparedFieldValueCount
  };
  for (const key of ["registeredTableCount", "directTargetCount", "targetColumnCount", "definitionTargetCount", "syntheticProjectionRowCount", "comparedFieldValueCount"] as const) {
    if (fixture[key] !== summary[key]) throw new Error(`WBS742_GATE3_FIXTURE_${key.toUpperCase()}_DRIFT`);
  }
  if (JSON.stringify(Object.values(summary).slice(3)) !== JSON.stringify([119, 47, 263, 25, 49, 272])) throw new Error("WBS742_GATE3_V4_ARITHMETIC_INVALID");
  return summary;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.stdout.write(`WBS742_GATE3_V4_PASS ${JSON.stringify(validateObjectDomainImportV4Gate3(loadGate3Documents()))}\n`);
}
