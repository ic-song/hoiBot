import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

type BigintTag = { $bigint: string };
type JsonValue = null | boolean | number | string | BigintTag | JsonValue[] | { [key: string]: JsonValue };
type Row = Record<string, JsonValue>;
type Envelope = { pk: Row; refs: Record<string, string>; legacy: Row; canonical: Row };
type FixtureCase = { domain: string; identityLocatorSha256: string; rowsByTable: Record<string, Envelope[]> };
type Quarantine = { runFingerprint: string; domain: string; category: string; identityLocatorSha256: string; table: string; field: string | null; legacyFingerprint: string | null; canonicalFingerprint: string | null };
type Fixture = { format: string; syntheticOnly: boolean; containsOperationalSnapshot: boolean; containsPersonalInformation: boolean; expectedMismatchCount: number; restartRuns: number; cases: FixtureCase[]; negativeCases: Array<{ category: string; legacy: JsonValue; canonical: JsonValue; expectedQuarantine: Quarantine }> };
type Domain = { domain: string; wbsSources: string[]; legacySources: string[]; canonicalTables: Array<{ table: string; migrations: string[] }>; oracle: { legacyProjection: string; canonicalProjection: string; identityKey: string[]; comparison: string } };
type Contract = {
  format: string; wbs: string; status: string;
  completionClaims: Record<string, boolean | string>;
  authoritativeSources: Record<string, string>;
  domainDerivation: { derivedDomainCount: number; derivedDirectTargetTableCount: number; noManualExpansion: boolean };
  identityPrerequisites: { requiredMigrations: string[]; requiredTables: string[]; rules: string[] };
  executionRules: { mode: string; allowedSql: string[]; forbiddenSql: string[]; lockPolicy: string; writePolicy: string; writerSelection: string };
  canonicalization: { unicodeStrings: string; bigint: string; [key: string]: string };
  mismatchCategories: Array<{ category: string; scope: string; supportedAt: string; promotionBlocking: boolean }>;
  gate3ClassifierSupport: { implemented: string[]; gate4Required: string[]; limitation: string };
  gate5VerificationEvidence: Record<string, string | string[]>;
  quarantinePolicy: { gate1To3Sink: string; durableWriteAllowed: boolean; recordFields: string[] };
  restartRepeatability: { required: boolean };
  zeroMutationProof: { databaseProof: string; gate1To3Limitation: string };
  domains: Domain[];
  remainingGateRequirements: Record<string, string[]>;
};
type FieldMap = { mappings: Array<{ domain: string; sources: string[]; targetTables: string[] }> };
type TargetSchema = { columns: Array<{ table: string; column: string; sqlType: string; nullable: boolean; migration: string }> };
type StandardTable = { table: string; columns: Array<{ name: string; type: string }>; primaryKey: string[]; foreignKeys: Array<{ column: string; referencesTable: string; referencesColumn: string }> };
type Standard = { registeredMigrations: string[]; tables: StandardTable[] };

const repoUrl = new URL("../../../", import.meta.url);
const readRepo = (path: string): string => readFileSync(new URL(path, repoUrl), "utf8");
const parseRepo = <T>(path: string): T => JSON.parse(readRepo(path)) as T;
const contractPath = "개발환경_고도화/migration-control/contracts/object-db-shadow-validation.v1.json";
const fixturePath = "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-shadow-validation-v1.json";
const contract = parseRepo<Contract>(contractPath);
const fixture = parseRepo<Fixture>(fixturePath);
const fieldMap = parseRepo<FieldMap>("개발환경_고도화/migration-control/contracts/object-domain-import-field-map.v1.json");
const targetSchema = parseRepo<TargetSchema>("개발환경_고도화/migration-control/contracts/object-domain-import-target-schema.v1.json");
const standard = parseRepo<Standard>("개발환경_고도화/migration-control/contracts/object-data-model-standard.v1.json");

const expectedTaxonomy = [
  ["IDENTITY_UNRESOLVED", "record", "GATE3_CLASSIFIER", true],
  ["IDENTITY_AMBIGUOUS", "record", "GATE4_REQUIRED", true],
  ["IDENTITY_PAYLOAD_DRIFT", "record", "GATE4_REQUIRED", true],
  ["CANONICAL_ROW_MISSING", "record", "GATE4_REQUIRED", true],
  ["LEGACY_ROW_MISSING", "record", "GATE4_REQUIRED", true],
  ["ROW_MULTIPLICITY_MISMATCH", "domain", "GATE4_REQUIRED", true],
  ["FIELD_VALUE_MISMATCH", "field", "GATE3_CLASSIFIER", true],
  ["UNICODE_BYTE_MISMATCH", "field", "GATE3_CLASSIFIER", true],
  ["BIGINT_ENCODING_INVALID", "field", "GATE3_CLASSIFIER", true],
  ["REFERENCE_CLOSURE_MISMATCH", "record", "GATE4_REQUIRED", true],
  ["TABLE_COVERAGE_MISMATCH", "domain", "GATE4_REQUIRED", true],
  ["RESTART_FINGERPRINT_DRIFT", "run", "GATE4_REQUIRED", true],
  ["MUTATION_DETECTED", "run", "GATE4_REQUIRED", true]
] as const;
const expectedDomainWbs: Record<string, { wbs: string; label: string; migration: string }> = {
  player: { wbs: "WBS733", label: "아이템·가방", migration: "444_canonical_item_inventory.sql" },
  item: { wbs: "WBS733", label: "아이템·가방", migration: "444_canonical_item_inventory.sql" },
  furniture: { wbs: "WBS734", label: "가구·홈", migration: "445_object_furniture_home_canonical_model.sql" },
  "pet-equipment": { wbs: "WBS735", label: "펫·장비", migration: "446_canonical_pet_equipment.sql" },
  "mini-pet": { wbs: "WBS736", label: "미니펫", migration: "447_canonical_mini_pet.sql" },
  "member-title": { wbs: "WBS737", label: "타이틀 3종", migration: "448_canonical_title_domains.sql" },
  "pet-title": { wbs: "WBS737", label: "타이틀 3종", migration: "448_canonical_title_domains.sql" },
  "mini-pet-title": { wbs: "WBS737", label: "타이틀 3종", migration: "448_canonical_title_domains.sql" },
  "pet-skill": { wbs: "WBS738", label: "펫스킬", migration: "449_canonical_pet_skill.sql" },
  package: { wbs: "WBS739", label: "패키지·보상", migration: "451_canonical_package_reward.sql" },
  currency: { wbs: "WBS740", label: "재화·원장", migration: "452_canonical_currency_ledger.sql" },
  "building-recipe": { wbs: "WBS741", label: "건물·조합", migration: "453_canonical_building_recipe.sql" }
};

function compareScalar(a: string, b: string): number {
  const left = Array.from(a, (value) => value.codePointAt(0)!);
  const right = Array.from(b, (value) => value.codePointAt(0)!);
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) if (left[index] !== right[index]) return left[index]! - right[index]!;
  return left.length - right.length;
}
function isBigintTag(value: object): value is BigintTag { return Object.keys(value).length === 1 && Object.hasOwn(value, "$bigint"); }
function canonicalize(value: JsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isBigintTag(value)) {
    if (!/^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/.test(value.$bigint)) throw new Error("BIGINT_ENCODING_INVALID");
    return `{"$bigint":${JSON.stringify(value.$bigint)}}`;
  }
  return `{${Object.entries(value).sort(([a], [b]) => compareScalar(a, b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`).join(",")}}`;
}
const digest = (value: JsonValue): string => createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
function unicodeEquivalentButDifferent(left: JsonValue, right: JsonValue): boolean {
  if (typeof left === "string" && typeof right === "string") return left !== right && left.normalize("NFC") === right.normalize("NFC");
  if (Array.isArray(left) && Array.isArray(right)) return left.some((value, index) => right[index] !== undefined && unicodeEquivalentButDifferent(value, right[index]!));
  if (left && right && typeof left === "object" && typeof right === "object" && !Array.isArray(left) && !Array.isArray(right)) return Object.keys(left).some((key) => Object.hasOwn(right, key) && unicodeEquivalentButDifferent((left as Row)[key]!, (right as Row)[key]!));
  return false;
}
function classify(left: JsonValue, right: JsonValue): string | null {
  if (right === null && left && typeof left === "object" && !Array.isArray(left) && Object.hasOwn(left, "identityLocatorSha256")) return "IDENTITY_UNRESOLVED";
  try { if (canonicalize(left) === canonicalize(right)) return null; } catch (error) { if (error instanceof Error && error.message === "BIGINT_ENCODING_INVALID") return error.message; throw error; }
  return unicodeEquivalentButDifferent(left, right) ? "UNICODE_BYTE_MISMATCH" : "FIELD_VALUE_MISMATCH";
}
function assertTyped(sqlType: string, value: JsonValue, context: string): void {
  if (/^BIGINT/.test(sqlType)) { assert.ok(value && typeof value === "object" && !Array.isArray(value) && isBigintTag(value), `${context}:${sqlType}`); canonicalize(value); return; }
  if (/^(?:TINYINT|SMALLINT|MEDIUMINT|INT)/.test(sqlType)) { assert.equal(typeof value, "number", `${context}:${sqlType}`); assert.ok(Number.isInteger(value)); return; }
  if (/^(?:BOOLEAN|BOOL)/.test(sqlType)) { assert.equal(typeof value, "boolean", `${context}:${sqlType}`); return; }
  if (/^(?:CHAR|VARCHAR|TEXT|ENUM)/.test(sqlType)) { assert.equal(typeof value, "string", `${context}:${sqlType}`); return; }
  if (/^DECIMAL/.test(sqlType)) { assert.equal(typeof value, "string", `${context}:${sqlType}`); return; }
  if (/^JSON/.test(sqlType)) { assert.ok(value === null || typeof value === "object", `${context}:${sqlType}`); return; }
  assert.fail(`${context}:unsupported fixture SQL type ${sqlType}`);
}
function sortByRealPk(rows: Envelope[], primaryKey: string[]): Envelope[] {
  return [...rows].sort((left, right) => compareScalar(canonicalize(primaryKey.map((key) => left.pk[key]!)), canonicalize(primaryKey.map((key) => right.pk[key]!))));
}
const fingerprint = (path: string): string => { const value = readFileSync(new URL(path, repoUrl)); return `${value.length}:${createHash("sha256").update(value).digest("hex")}`; };

describe("WBS744 object DB Shadow Gate1-3 validation contract", () => {
  it("derives the exact domain and 45-table union from WBS742 contracts", () => {
    const domains = fieldMap.mappings.map(({ domain }) => domain);
    const tables = fieldMap.mappings.flatMap(({ targetTables }) => targetTables);
    assert.deepEqual(contract.domains.map(({ domain }) => domain), domains);
    assert.equal(contract.domainDerivation.derivedDomainCount, domains.length);
    assert.equal(contract.domainDerivation.derivedDirectTargetTableCount, new Set(tables).size);
    assert.equal(new Set(tables).size, tables.length);
    assert.equal(tables.length, 45);
  });

  it("validates domain lineage against independent WBS expectations, migration headers, and central evidence", () => {
    const evidence = readRepo("개발환경_고도화/migration-control/evidence/object-db-domain-wave1-integration/validation.md");
    assert.deepEqual(Object.keys(expectedDomainWbs).sort(), fieldMap.mappings.map(({ domain }) => domain).sort());
    for (const domain of contract.domains) {
      const expected = expectedDomainWbs[domain.domain]!;
      assert.ok(domain.wbsSources.some((source) => source.startsWith(expected.wbs)), `${domain.domain}:${expected.wbs}`);
      assert.match(readRepo(`개발환경_고도화/runtime/migrations/${expected.migration}`).split(/\r?\n/, 1)[0]!, new RegExp(expected.wbs));
      assert.ok(evidence.includes(`${expected.wbs} ${expected.label}`), `${expected.wbs}:${expected.label}`);
      assert.ok(domain.wbsSources.some((source) => source.startsWith("WBS742")));
      assert.ok(domain.wbsSources.some((source) => source.startsWith("WBS743")));
    }
  });

  it("ties each oracle to exact field-map tables and target-schema migration ownership", () => {
    const standardTables = new Set(standard.tables.map(({ table }) => table));
    for (const mapping of fieldMap.mappings) {
      const domain = contract.domains.find((entry) => entry.domain === mapping.domain)!;
      assert.deepEqual(domain.legacySources, mapping.sources);
      assert.deepEqual(domain.canonicalTables.map(({ table }) => table), mapping.targetTables);
      assert.match(domain.oracle.legacyProjection, /WBS742/);
      for (const entry of domain.canonicalTables) {
        assert.ok(standardTables.has(entry.table));
        const migrations = [...new Set(targetSchema.columns.filter(({ table }) => table === entry.table).map(({ migration }) => migration))].sort();
        assert.deepEqual([...entry.migrations].sort(), migrations);
        for (const migration of entry.migrations) assert.match(readRepo(`개발환경_고도화/runtime/migrations/${migration}`), new RegExp("(?:CREATE|ALTER) TABLE(?: IF NOT EXISTS)? `?" + entry.table + "`?", "i"));
      }
    }
  });

  it("validates 45 rowsByTable envelopes against real columns, SQL types, PKs, and FK closure", () => {
    const schemaTables = new Map(standard.tables.map((table) => [table.table, table]));
    const typedColumns = new Map(targetSchema.columns.map((column) => [`${column.table}.${column.column}`, column.sqlType]));
    const fixtureTables = fixture.cases.flatMap(({ rowsByTable }) => Object.keys(rowsByTable));
    const expectedTables = fieldMap.mappings.flatMap(({ targetTables }) => targetTables);
    assert.deepEqual(fixture.cases.map(({ domain }) => domain), fieldMap.mappings.map(({ domain }) => domain));
    assert.equal(new Set(fixture.cases.map(({ domain }) => domain)).size, fixture.cases.length);
    for (const [index, fixtureCase] of fixture.cases.entries()) {
      assert.deepEqual(Object.keys(fixtureCase.rowsByTable), fieldMap.mappings[index]!.targetTables, `${fixtureCase.domain}:rowsByTable keys`);
      assert.ok(Object.values(fixtureCase.rowsByTable).every((rows) => rows.length > 0), `${fixtureCase.domain}:non-empty table rows`);
    }
    assert.deepEqual([...fixtureTables].sort(), [...expectedTables].sort());
    assert.equal(new Set(fixtureTables).size, 45);
    const allRows = fixture.cases.flatMap(({ rowsByTable }) => Object.entries(rowsByTable).flatMap(([table, rows]) => rows.map((row) => ({ table, row }))));

    for (const { table, row } of allRows) {
      const schema = schemaTables.get(table)!;
      assert.deepEqual(Object.keys(row.pk), schema.primaryKey, `${table}:real PK`);
      assert.deepEqual(Object.keys(row.legacy).sort(), Object.keys(row.canonical).sort(), `${table}:projection columns`);
      assert.equal(classify(row.legacy, row.canonical), null, table);
      for (const [column, value] of Object.entries(row.canonical)) {
        const sqlType = typedColumns.get(`${table}.${column}`);
        assert.ok(sqlType, `${table}.${column}:target-schema`);
        assertTyped(sqlType, value, `${table}.${column}`);
      }
      for (const [column, value] of Object.entries(row.pk)) assert.deepEqual(row.canonical[column], value, `${table}.${column}:PK value`);
      assert.deepEqual(Object.keys(row.refs).sort(), schema.foreignKeys.map(({ column }) => column).sort(), `${table}:FK envelope`);
      for (const fk of schema.foreignKeys) {
        assert.equal(row.refs[fk.column], `${fk.referencesTable}.${fk.referencesColumn}`);
        const value = row.canonical[fk.column];
        assert.ok(allRows.some(({ table: targetTable, row: targetRow }) => targetTable === fk.referencesTable && targetRow.canonical[fk.referencesColumn] === value), `${table}.${fk.column}:closure`);
      }
      assert.deepEqual(sortByRealPk([row], schema.primaryKey), [row]);
    }
    const stacks = allRows.filter(({ table }) => table === "canonical_owned_item_stacks").map(({ row }) => row);
    assert.deepEqual(sortByRealPk([...stacks].reverse(), ["owned_item_stack_id"]).map(({ pk }) => pk.owned_item_stack_id), ["stack001", "stack002"]);
  });

  it("keeps taxonomy exact and separates four Gate3 classifiers from nine Gate4-only reservations", () => {
    assert.deepEqual(contract.mismatchCategories.map(({ category, scope, supportedAt, promotionBlocking }) => [category, scope, supportedAt, promotionBlocking]), expectedTaxonomy);
    assert.equal(new Set(contract.mismatchCategories.map(({ category }) => category)).size, expectedTaxonomy.length);
    const gate3 = expectedTaxonomy.filter(([, , stage]) => stage === "GATE3_CLASSIFIER").map(([category]) => category);
    const gate4 = expectedTaxonomy.filter(([, , stage]) => stage === "GATE4_REQUIRED").map(([category]) => category);
    assert.deepEqual(contract.gate3ClassifierSupport.implemented, gate3);
    assert.deepEqual(contract.gate3ClassifierSupport.gate4Required, gate4);
    assert.equal(gate3.length, 4);
    assert.equal(gate4.length, 9);
    assert.match(contract.gate3ClassifierSupport.limitation, /no current classifier execution evidence/);
  });

  it("classifies every supported negative and validates the complete ephemeral quarantine envelope", () => {
    const supported = new Set(contract.gate3ClassifierSupport.implemented);
    assert.deepEqual(new Set(fixture.negativeCases.map(({ category }) => category)), supported);
    for (const negative of fixture.negativeCases) {
      assert.equal(classify(negative.legacy, negative.canonical), negative.category);
      assert.deepEqual(Object.keys(negative.expectedQuarantine), contract.quarantinePolicy.recordFields);
      assert.equal(negative.expectedQuarantine.category, negative.category);
      for (const key of ["runFingerprint", "identityLocatorSha256"] as const) assert.match(negative.expectedQuarantine[key], /^[0-9a-f]{64}$/);
      for (const key of ["legacyFingerprint", "canonicalFingerprint"] as const) if (negative.expectedQuarantine[key] !== null) assert.match(negative.expectedQuarantine[key]!, /^[0-9a-f]{64}$/);
    }
    assert.equal(contract.quarantinePolicy.gate1To3Sink, "in-memory test result only");
    assert.equal(contract.quarantinePolicy.durableWriteAllowed, false);
  });

  it("preserves Unicode/BIGINT and produces a stable real-PK-ordered restart digest", () => {
    assert.notEqual(canonicalize("é"), canonicalize("é"));
    assert.throws(() => canonicalize({ $bigint: "01" }), /BIGINT_ENCODING_INVALID/);
    assert.match(contract.canonicalization.unicodeStrings, /do not NFC\/NFD\/NFKC\/NFKD normalize/);
    const domainOrder = new Map(fieldMap.mappings.map(({ domain }, index) => [domain, index]));
    const project = (cases: FixtureCase[]): JsonValue => [...cases]
      .sort((left, right) => domainOrder.get(left.domain)! - domainOrder.get(right.domain)!)
      .map(({ domain, rowsByTable }) => ({
        domain,
        tables: Object.entries(rowsByTable)
          .sort(([left], [right]) => compareScalar(left, right))
          .map(([table, rows]) => {
            const pk = standard.tables.find((entry) => entry.table === table)!.primaryKey;
            return { table, rows: sortByRealPk(rows, pk).map(({ canonical }) => canonical) };
          })
      }));
    const first = digest(project(fixture.cases));
    const restart = digest(project(JSON.parse(JSON.stringify(fixture.cases)) as FixtureCase[]));
    assert.equal(first, restart);
    const reversedInsertionOrder = [...fixture.cases].reverse().map((fixtureCase) => ({
      ...fixtureCase,
      rowsByTable: Object.fromEntries(Object.entries(fixtureCase.rowsByTable).reverse())
    }));
    assert.equal(digest(project(reversedInsertionOrder)), first);
    assert.equal(fixture.restartRuns, 2);
  });

  it("records isolated MariaDB Gate5 proof and leaves Gate6+ incomplete", () => {
    assert.equal(fixture.syntheticOnly, true);
    assert.equal(fixture.containsOperationalSnapshot, false);
    assert.equal(fixture.containsPersonalInformation, false);
    assert.equal(contract.executionRules.mode, "READ_ONLY_SHADOW");
    for (const token of ["INSERT", "UPDATE", "DELETE", "CREATE", "ALTER", "DROP", "LOCK TABLES", "SELECT FOR UPDATE", "GET_LOCK"]) assert.ok(contract.executionRules.forbiddenSql.includes(token));
    const paths = [...new Set([contractPath, fixturePath, ...Object.values(contract.authoritativeSources), ...contract.domains.flatMap(({ canonicalTables }) => canonicalTables.flatMap(({ migrations }) => migrations.map((migration) => `개발환경_고도화/runtime/migrations/${migration}`)))])];
    const before = new Map(paths.map((path) => [path, fingerprint(path)]));
    for (const path of paths) readRepo(path);
    assert.deepEqual(new Map(paths.map((path) => [path, fingerprint(path)])), before);
    assert.match(contract.zeroMutationProof.databaseProof, /Gate 5/);
    assert.equal(contract.completionClaims.shadowComplete, false);
    assert.equal(contract.completionClaims.gate4, "IMPLEMENTED");
    assert.equal(contract.completionClaims.gate5, "VERIFIED_ISOLATED_MARIADB");
    assert.deepEqual(contract.remainingGateRequirements.gate4, []);
    assert.deepEqual(contract.remainingGateRequirements.gate5, []);
    for (const evidencePath of Object.values(contract.gate5VerificationEvidence).filter((value):value is string=>typeof value==="string"&&value.startsWith("개발환경_고도화/"))) assert.ok(readRepo(evidencePath).length>0,evidencePath);
    for (const gate of ["gate6", "gate7"]) {
      assert.equal(contract.completionClaims[gate], "NOT_STARTED");
      assert.ok(contract.remainingGateRequirements[gate]!.length >= 2);
    }
  });
});
