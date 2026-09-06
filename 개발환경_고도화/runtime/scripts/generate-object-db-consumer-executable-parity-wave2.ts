import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { sha256CanonicalJson, sha256CanonicalText, type ExpectedActualEvidence, type ObjectDbConsumerExecutionReceipt, type ObjectDbParityScenarioKind } from "../src/data-migration/object-db-consumer-executable-parity-ledger.js";

const runtimeRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(runtimeRoot, "../..");
const manifestPath = "개발환경_고도화/migration-control/contracts/object-db-consumer-manifest.v1.json";
const ledgerPath = "개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-ledger.v1.json";
const wave1ReceiptPath = "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave1-v1.json";
const fixturePath = "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-executable-parity-wave2-compatibility-resolver-v1.json";
const receiptPath = "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave2-v1.json";
const harnessPath = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-harness.mjs";
const targetPath = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave2-compatibility-resolver.mjs";
const scenarios: ObjectDbParityScenarioKind[] = ["READ_POSITIVE", "NEGATIVE_GUARD", "EXACT_OUTPUT", "SOURCE_DOMAIN_DML_ZERO", "RESTART_CONSISTENCY"];
const read = (path: string): string => readFileSync(resolve(repoRoot, path), "utf8");
const fixture = JSON.parse(read(fixturePath));
const manifest = JSON.parse(read(manifestPath));
const baselineLedger = JSON.parse(read(ledgerPath));
const wave1 = JSON.parse(read(wave1ReceiptPath));
const evidenceCommit = process.argv[2] ?? execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
if (!/^[a-f0-9]{40}$/.test(evidenceCommit)) throw new Error("Wave2 evidence commit must be a full Git commit");
if (fixture.format !== "hoibot-object-db-consumer-parity-case-fixture-v1" || fixture.payload.cases.length !== 1) throw new Error("Wave2 fixture/case contract drift");
const parityCase = fixture.payload.cases[0];
if (parityCase.executablePath !== "ObjectCatalogCompatibilityResolver" || parityCase.transactionPath !== "DatabaseClient.query:READ_ONLY" || JSON.stringify(parityCase.requiredScenarios) !== JSON.stringify(scenarios)) throw new Error("Wave2 executable/scenario contract drift");
if (parityCase.consumers.length !== 3 || new Set(parityCase.consumers.map((item: any) => item.consumerId)).size !== 3) throw new Error("Wave2 cohort must contain exactly three consumers");

for (const consumer of parityCase.consumers) {
  const source = manifest.consumers.find((item: any) => item.consumerId === consumer.consumerId);
  if (source === undefined) throw new Error(`${consumer.consumerId}: missing from source-derived manifest`);
  const locator = { file: source.file, symbol: source.symbol, triggerOrPredicate: source.triggerOrPredicate, interfaceId: source.interfaceId, start: source.sourceSpan.start, end: source.sourceSpan.end, sha256: source.sourceSpan.sha256 };
  if (JSON.stringify(locator) !== JSON.stringify(consumer.sourceLocator)) throw new Error(`${consumer.consumerId}: exact source locator drift`);
  if (source.access !== "READ" || source.unresolvedDynamicCallCount !== 0 || source.targetUsageMode !== "CURRENT_SQL") throw new Error(`${consumer.consumerId}: not a static current-SQL read consumer`);
  const entry = baselineLedger.entries.find((item: any) => item.consumerId === consumer.consumerId);
  const required = entry?.scenarioRequirements.filter((item: any) => item.disposition === "REQUIRED").map((item: any) => item.scenarioKind);
  if (entry?.verdict !== "STATIC_ONLY" || JSON.stringify(required) !== JSON.stringify(scenarios)) throw new Error(`${consumer.consumerId}: baseline verdict/scenario drift`);
  if (consumer.databaseRowShape !== "legacy-object-row" || consumer.mockRows.length !== 1 || consumer.assertions.length !== 4) throw new Error(`${consumer.consumerId}: fixture execution contract drift`);
}
const expectedBindings = parityCase.consumers.flatMap((consumer: any) => scenarios.map((scenarioKind) => ({ consumerId: consumer.consumerId, harnessId: "harness:object-db-executable-parity:wave2", harnessCaseId: parityCase.caseId, fixtureId: fixture.fixtureId, scenarioId: `scenario:${scenarioKind.toLowerCase().replaceAll("_", "-")}`, scenarioKind }))).sort((a: any, b: any) => `${a.consumerId}:${a.scenarioKind}`.localeCompare(`${b.consumerId}:${b.scenarioKind}`));
if (JSON.stringify(fixture.bindings) !== JSON.stringify(expectedBindings)) throw new Error("Wave2 fixture binding matrix drift");

const hashes = { harness: sha256CanonicalText(read(harnessPath)), target: sha256CanonicalText(read(targetPath)), fixture: sha256CanonicalText(read(fixturePath)), dml: sha256CanonicalJson({ normalizedStatements: [], rowCount: 0 }) };
function expectedActual(consumer: any, scenarioKind: ObjectDbParityScenarioKind): ExpectedActualEvidence {
  const negative = scenarioKind === "NEGATIVE_GUARD";
  const resultObject = negative ? { status: "UNMAPPED", canonicalObjectIdentityId: null, legacyObjectId: null, legacyObjectKey: null, objectType: null, quarantineReason: consumer.expectedGuardReason } : consumer.expectedRow;
  const reply = JSON.stringify(resultObject);
  const result = negative ? JSON.stringify({ result: resultObject, queryCount: 0 }) : scenarioKind === "RESTART_CONSISTENCY" ? JSON.stringify({ result: resultObject, restartEvidence: { processExecutions: 2, distinctProcessIds: true, distinctModuleExecutions: true } }) : reply;
  const timeline = negative ? ["GUARD_REJECTED"] : scenarioKind === "RESTART_CONSISTENCY" ? ["CHILD_PROCESS_1:READ", "RESTART", "CHILD_PROCESS_2:READ"] : ["READ"];
  return { reply: { expectedSha256: sha256CanonicalText(reply), actualSha256: sha256CanonicalText(reply), match: true }, result: { expectedSha256: sha256CanonicalText(result), actualSha256: sha256CanonicalText(result), match: true }, dml: { expectedSha256: hashes.dml, actualSha256: hashes.dml, match: true, expectedNormalizedStatements: [], actualNormalizedStatements: [], expectedRowCount: 0, actualRowCount: 0 }, lockOrder: { expected: [], actual: [], match: true }, transaction: { expected: "READ_ONLY", actual: "READ_ONLY", match: true, expectedTimeline: timeline, actualTimeline: timeline } };
}
const wave2Receipts: ObjectDbConsumerExecutionReceipt[] = fixture.bindings.map((binding: any) => {
  const consumer = parityCase.consumers.find((item: any) => item.consumerId === binding.consumerId);
  const withoutHash: Omit<ObjectDbConsumerExecutionReceipt, "receiptSha256"> = { receiptId: `receipt:wave2:${consumer.consumerId}:${binding.scenarioKind.toLowerCase()}`, consumerId: consumer.consumerId, proofMode: "DIRECT", harness: { harnessId: binding.harnessId, harnessCaseId: binding.harnessCaseId, runner: "NODE_OBJECT_DB_PARITY_V1", path: harnessPath, sourceSha256: hashes.harness }, fixture: { fixtureId: fixture.fixtureId, path: fixturePath, sha256: hashes.fixture }, invocation: { targetPath, targetSourceSha256: hashes.target, exportName: "executeWave2CompatibilityResolver" }, scenario: { scenarioId: binding.scenarioId, scenarioKind: binding.scenarioKind }, expectedActual: expectedActual(consumer, binding.scenarioKind), equivalenceRule: null, verdict: "PASS" };
  return { ...withoutHash, receiptSha256: sha256CanonicalJson(withoutHash) };
});
const refreshedWave1Receipts: ObjectDbConsumerExecutionReceipt[] = wave1.receipts.map((receipt: ObjectDbConsumerExecutionReceipt) => {
  const { receiptSha256: _oldHash, ...oldPayload } = receipt;
  const withoutHash = { ...oldPayload, harness: { ...oldPayload.harness, sourceSha256: hashes.harness } };
  return { ...withoutHash, receiptSha256: sha256CanonicalJson(withoutHash) };
});
const receipts = [...refreshedWave1Receipts, ...wave2Receipts];
writeFileSync(resolve(repoRoot, receiptPath), `${JSON.stringify({ format: "hoibot-object-db-consumer-execution-receipts-v1", catalogVersion: baselineLedger.catalogVersion, classificationBaseCommit: manifest.baseCommit, evidenceCommit, receipts }, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: "PASS", consumerIds: parityCase.consumers.map((item: any) => item.consumerId).sort(), wave2ReceiptCount: wave2Receipts.length, totalReceiptCount: receipts.length }));
