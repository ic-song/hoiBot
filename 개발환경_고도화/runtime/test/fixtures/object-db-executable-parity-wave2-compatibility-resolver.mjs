import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tsImport } from "tsx/esm/api";

const SOURCE_FILE = "개발환경_고도화/runtime/src/catalog/object-catalog-compatibility-resolver.ts";
const MODULE_EXECUTION_ID = randomUUID();
const SCENARIOS = ["READ_POSITIVE", "NEGATIVE_GUARD", "EXACT_OUTPUT", "SOURCE_DOMAIN_DML_ZERO", "RESTART_CONSISTENCY"];
const TRUSTED = {
  "sql-repository-aa5b2d6d12d1268b": { method: "resolveLegacyObjectId", symbol: "resolveLegacyObjectId", triggerOrPredicate: "SQL_METHOD:resolveLegacyObjectId", interfaceId: "context-bridge.repository.object-catalog-compatibility-resolver.resolveLegacyObjectId", start: 5532, end: 5968, sha256: "41b5e1a7c8bef39b9e52f34b5b8f07be6ed5616d035230f957b6e3b898f217f8", input: ["42", { expectedObjectType: "ITEM" }], negativeInput: ["0", { expectedObjectType: "ITEM" }], expectedQueryValues: ["42"], expectedGuardReason: "LEGACY_OBJECT_ID_INVALID" },
  "sql-repository-fd1e8659cff045f9": { method: "resolveAlias", symbol: "resolveAlias", triggerOrPredicate: "SQL_METHOD:resolveAlias", interfaceId: "context-bridge.repository.object-catalog-compatibility-resolver.resolveAlias", start: 5970, end: 6811, sha256: "d5426b322e9baf4a938054316e7f662eeb71b3a91553f8a85061603028dfebf3", input: ["ITEM", "legacy_name", "diamond-box", {}], negativeInput: ["ITEM", "invalid_alias_type", "diamond-box", {}], expectedQueryValues: ["ITEM", "legacy_name", "diamond-box"], expectedGuardReason: "LEGACY_OBJECT_ALIAS_INVALID" },
  "sql-repository-520566e376bf7ee8": { method: "resolveSource", symbol: "resolveSource", triggerOrPredicate: "SQL_METHOD:resolveSource", interfaceId: "context-bridge.repository.object-catalog-compatibility-resolver.resolveSource", start: 6893, end: 7530, sha256: "cf9e87d3234a9780c51a132ad500e7ba85686de69f18703c3715376a456da5cb", input: [{ system: "LEGACY_JSON", table: "data/itemList.json", key: "diamond-box" }, { expectedObjectType: "ITEM" }], negativeInput: [{ system: "LEGACY_JSON", table: "not-allowlisted", key: "diamond-box" }, {}], expectedQueryValues: ["LEGACY_JSON", "data/itemList.json", "diamond-box"], expectedGuardReason: "LEGACY_OBJECT_SOURCE_INVALID" },
};
const EXPECTED_ROW = { status: "RESOLVED", canonicalObjectIdentityId: "objid001", legacyObjectId: "42", legacyObjectKey: "diamond-box", objectType: "ITEM", quarantineReason: null };

function assert(condition, message) { if (!condition) throw new Error(message); }
function normalizeSql(sql) { return sql.replace(/\s+/g, " ").trim(); }

function expectedFixtureConsumer(consumerId, trusted, expectedNormalizedSql) {
  return {
    consumerId,
    sourceLocator: { file: SOURCE_FILE, symbol: trusted.symbol, triggerOrPredicate: trusted.triggerOrPredicate, interfaceId: trusted.interfaceId, start: trusted.start, end: trusted.end, sha256: trusted.sha256 },
    method: trusted.method,
    input: trusted.input,
    negativeInput: trusted.negativeInput,
    expectedQueryValues: trusted.expectedQueryValues,
    expectedGuardReason: trusted.expectedGuardReason,
    expectedNormalizedSql,
    databaseRowShape: "legacy-object-row",
    mockRows: [{ legacyObjectId: "42", legacyObjectKey: "diamond-box", objectType: "ITEM", canonicalObjectIdentityId: "objid001" }],
    expectedRow: EXPECTED_ROW,
    assertions: ["object_registry registry", "object_identity_crosswalks crosswalk", "crosswalk.source_system = 'LEGACY_DB'", "crosswalk.source_namespace = 'object_registry.id'"],
  };
}

function verifySource(repoRoot, consumer, trusted) {
  const sourcePath = resolve(repoRoot, SOURCE_FILE);
  const source = readFileSync(sourcePath, "utf8").replace(/\r\n?/g, "\n");
  const span = source.slice(trusted.start, trusted.end);
  assert(createHash("sha256").update(span).digest("hex") === trusted.sha256, `${consumer.consumerId}: source span hash drift`);
  assert(span.includes(`async ${trusted.method}(`), `${consumer.consumerId}: executable method span missing`);
  return sourcePath;
}

export async function executeWave2CompatibilityResolver({ consumerId, harnessCaseId, scenarioKind, fixturePayload, database }) {
  let assertionCount = 0;
  const check = (condition, message) => { assertionCount += 1; assert(condition, message); };
  const parityCase = fixturePayload.cases.find((candidate) => candidate.caseId === harnessCaseId);
  check(parityCase !== undefined, `${consumerId}: case mapping missing`);
  check(parityCase.executablePath === "ObjectCatalogCompatibilityResolver", `${consumerId}: executable path drift`);
  check(parityCase.transactionPath === "DatabaseClient.query:READ_ONLY", `${consumerId}: transaction path drift`);
  check(JSON.stringify(parityCase.requiredScenarios) === JSON.stringify(SCENARIOS), `${consumerId}: scenario matrix drift`);
  const consumer = parityCase.consumers.find((candidate) => candidate.consumerId === consumerId);
  const trusted = TRUSTED[consumerId];
  check(consumer !== undefined && trusted !== undefined, `${consumerId}: trusted consumer mapping missing`);
  const expectedSql = consumer.expectedNormalizedSql;
  check(typeof expectedSql === "string" && consumer.assertions.every((token) => expectedSql.includes(token)), `${consumerId}: SQL semantic assertions drift`);
  check(JSON.stringify(consumer) === JSON.stringify(expectedFixtureConsumer(consumerId, trusted, expectedSql)), `${consumerId}: fixture attempted to select untrusted locator/method/input/SQL config`);
  check(SCENARIOS.includes(scenarioKind), `${consumerId}: unsupported scenario`);

  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
  const sourcePath = verifySource(repoRoot, consumer, trusted);
  assertionCount += 2;
  const { ObjectCatalogCompatibilityResolver } = await tsImport(pathToFileURL(sourcePath).href, import.meta.url);
  const resolver = new ObjectCatalogCompatibilityResolver(database);
  const args = scenarioKind === "NEGATIVE_GUARD" ? consumer.negativeInput : consumer.input;
  const result = await resolver[consumer.method](...args);
  if (scenarioKind === "NEGATIVE_GUARD") {
    check(result.status === "UNMAPPED" && result.quarantineReason === trusted.expectedGuardReason, `${consumerId}: negative guard result drift`);
    const raw = JSON.stringify(result);
    return { executedConsumerId: consumerId, executedCaseId: harnessCaseId, moduleExecutionId: MODULE_EXECUTION_ID, assertionCount, reply: raw, result: JSON.stringify({ result, queryCount: 0 }) };
  }
  check(JSON.stringify(result) === JSON.stringify(EXPECTED_ROW), `${consumerId}: exact result drift`);
  const raw = JSON.stringify(result);
  return { executedConsumerId: consumerId, executedCaseId: harnessCaseId, moduleExecutionId: MODULE_EXECUTION_ID, assertionCount, reply: raw, result: raw };
}
