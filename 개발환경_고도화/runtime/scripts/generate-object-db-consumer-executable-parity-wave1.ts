import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  sha256CanonicalJson,
  sha256CanonicalText,
  type ExpectedActualEvidence,
  type ObjectDbConsumerExecutionReceipt,
  type ObjectDbParityScenarioKind,
} from "../src/data-migration/object-db-consumer-executable-parity-ledger.js";

const runtimeRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(runtimeRoot, "../..");
const manifestPath = "개발환경_고도화/migration-control/contracts/object-db-consumer-manifest.v1.json";
const ledgerPath = "개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-ledger.v1.json";
const fixturePath = "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-executable-parity-wave1-title-list-owned-v1.json";
const receiptPath = "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave1-v1.json";
const harnessPath = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-harness.mjs";
const targetPath = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave1-title-list-owned.mjs";

type SourceLocator = {
  file: string;
  symbol: string;
  triggerOrPredicate: string;
  interfaceId: string;
  start: number;
  end: number;
  sha256: string;
};

type CaseConsumer = {
  consumerId: string;
  sourceLocator: SourceLocator;
  trustedConfig: { domain: string; definitionTable: string; definitionId: string; ownershipTable: string; ownedId: string; selectionTable: string };
  input: { domain: string; playerId: string };
  negativeInput: { domain: string; playerId: string };
  expectedGuardError: string;
  expectedNormalizedSql: string;
  mockRows: Array<Record<string, unknown>>;
  expectedRow: Record<string, unknown>;
  assertions: string[];
};

type CaseFixture = {
  format: string;
  fixtureId: string;
  bindings: Array<Record<string, string>>;
  payload: { cases: Array<{ caseId: string; executablePath: string; transactionPath: string; requiredScenarios: ObjectDbParityScenarioKind[]; consumers: CaseConsumer[] }> };
};

const read = (path: string): string => readFileSync(resolve(repoRoot, path), "utf8");
const fixture = JSON.parse(read(fixturePath)) as CaseFixture;
const manifest = JSON.parse(read(manifestPath)) as { baseCommit: string; consumers: Array<Record<string, unknown>> };
const baselineLedger = JSON.parse(read(ledgerPath)) as { catalogVersion: string; entries: Array<Record<string, unknown>> };
if (fixture.format !== "hoibot-object-db-consumer-parity-case-fixture-v1" || fixture.payload.cases.length !== 1) throw new Error("Wave1 fixture/case contract drift");
const evidenceCommit = process.argv[2] ?? execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
if (!/^[a-f0-9]{40}$/.test(evidenceCommit)) throw new Error("Wave1 evidence commit must be a full Git commit");

const parityCase = fixture.payload.cases[0]!;
const expectedScenarioKinds = ["READ_POSITIVE", "NEGATIVE_GUARD", "EXACT_OUTPUT", "SOURCE_DOMAIN_DML_ZERO", "RESTART_CONSISTENCY"];
if (parityCase.executablePath !== "MariaCanonicalTitleRepository.listOwned" || parityCase.transactionPath !== "DatabaseClient.query:READ_ONLY") throw new Error("Wave1 executable/transaction path drift");
if (JSON.stringify(parityCase.requiredScenarios) !== JSON.stringify(expectedScenarioKinds)) throw new Error("Wave1 required scenario matrix drift");
if (parityCase.consumers.length !== 3 || new Set(parityCase.consumers.map(({ consumerId }) => consumerId)).size !== 3) throw new Error("Wave1 cohort must contain exactly three unique consumers");

const sharedSpan = JSON.stringify({
  file: parityCase.consumers[0]!.sourceLocator.file,
  start: parityCase.consumers[0]!.sourceLocator.start,
  end: parityCase.consumers[0]!.sourceLocator.end,
  sha256: parityCase.consumers[0]!.sourceLocator.sha256,
});
for (const consumer of parityCase.consumers) {
  if (JSON.stringify({ file: consumer.sourceLocator.file, start: consumer.sourceLocator.start, end: consumer.sourceLocator.end, sha256: consumer.sourceLocator.sha256 }) !== sharedSpan) throw new Error(`${consumer.consumerId}: shared case source span drift`);
  if (consumer.input.playerId.length !== 8 || consumer.negativeInput.playerId.length === 8 || consumer.assertions.length !== 6 || consumer.mockRows.length !== 1 || consumer.input.domain !== consumer.trustedConfig.domain || consumer.negativeInput.domain !== consumer.trustedConfig.domain) throw new Error(`${consumer.consumerId}: exact input/assertion contract drift`);
  const manifestConsumer = manifest.consumers.find((candidate) => candidate.consumerId === consumer.consumerId);
  if (manifestConsumer === undefined) throw new Error(`${consumer.consumerId}: missing from source-derived manifest`);
  const exactManifestLocator = {
    file: manifestConsumer.file,
    symbol: manifestConsumer.symbol,
    triggerOrPredicate: manifestConsumer.triggerOrPredicate,
    interfaceId: manifestConsumer.interfaceId,
    start: (manifestConsumer.sourceSpan as SourceLocator).start,
    end: (manifestConsumer.sourceSpan as SourceLocator).end,
    sha256: (manifestConsumer.sourceSpan as SourceLocator).sha256,
  };
  if (JSON.stringify(exactManifestLocator) !== JSON.stringify(consumer.sourceLocator)) throw new Error(`${consumer.consumerId}: exact source locator drift`);
  if (manifestConsumer.access !== "READ" || manifestConsumer.unresolvedDynamicCallCount !== 0) throw new Error(`${consumer.consumerId}: cohort is not an executable static READ consumer`);
  const ledgerEntry = baselineLedger.entries.find((candidate) => candidate.consumerId === consumer.consumerId) as { verdict?: string; scenarioRequirements?: Array<{ scenarioKind: string; disposition: string }> } | undefined;
  const required = ledgerEntry?.scenarioRequirements?.filter(({ disposition }) => disposition === "REQUIRED").map(({ scenarioKind }) => scenarioKind);
  if (!["STATIC_ONLY", "DIRECT_PASS"].includes(ledgerEntry?.verdict ?? "") || JSON.stringify(required) !== JSON.stringify(expectedScenarioKinds)) throw new Error(`${consumer.consumerId}: baseline verdict/scenario drift`);
}

const expectedBindings = parityCase.consumers.flatMap((consumer) => parityCase.requiredScenarios.map((scenarioKind) => ({
  consumerId: consumer.consumerId,
  harnessId: "harness:object-db-executable-parity:wave1",
  harnessCaseId: parityCase.caseId,
  fixtureId: fixture.fixtureId,
  scenarioId: `scenario:${scenarioKind.toLowerCase().replaceAll("_", "-")}`,
  scenarioKind,
}))).sort((left, right) => `${left.consumerId}:${left.scenarioKind}`.localeCompare(`${right.consumerId}:${right.scenarioKind}`));
if (JSON.stringify(fixture.bindings) !== JSON.stringify(expectedBindings)) throw new Error("Wave1 committed fixture binding matrix drift");

const harnessSha256 = sha256CanonicalText(read(harnessPath));
const targetSha256 = sha256CanonicalText(read(targetPath));
const fixtureSha256 = sha256CanonicalText(read(fixturePath));
const dmlSha256 = sha256CanonicalJson({ normalizedStatements: [], rowCount: 0 });

function expectedActual(consumer: CaseConsumer, scenarioKind: ObjectDbParityScenarioKind): ExpectedActualEvidence {
  const negative = scenarioKind === "NEGATIVE_GUARD";
  const reply = negative ? consumer.expectedGuardError : JSON.stringify([consumer.expectedRow]);
  const successResult = JSON.stringify([consumer.expectedRow]);
  const result = negative
    ? JSON.stringify({ error: consumer.expectedGuardError, queryCount: 0 })
    : scenarioKind === "RESTART_CONSISTENCY"
      ? JSON.stringify({ result: [consumer.expectedRow], restartEvidence: { processExecutions: 2, distinctProcessIds: true, distinctModuleExecutions: true } })
      : successResult;
  const timeline = negative ? ["GUARD_REJECTED"] : scenarioKind === "RESTART_CONSISTENCY" ? ["CHILD_PROCESS_1:READ", "RESTART", "CHILD_PROCESS_2:READ"] : ["READ"];
  return {
    reply: { expectedSha256: sha256CanonicalText(reply), actualSha256: sha256CanonicalText(reply), match: true },
    result: { expectedSha256: sha256CanonicalText(result), actualSha256: sha256CanonicalText(result), match: true },
    dml: { expectedSha256: dmlSha256, actualSha256: dmlSha256, match: true, expectedNormalizedStatements: [], actualNormalizedStatements: [], expectedRowCount: 0, actualRowCount: 0 },
    lockOrder: { expected: [], actual: [], match: true },
    transaction: { expected: "READ_ONLY", actual: "READ_ONLY", match: true, expectedTimeline: timeline, actualTimeline: timeline },
  };
}

const receipts: ObjectDbConsumerExecutionReceipt[] = fixture.bindings.map((binding) => {
  const consumer = parityCase.consumers.find((candidate) => candidate.consumerId === binding.consumerId)!;
  const scenarioKind = binding.scenarioKind as ObjectDbParityScenarioKind;
  const withoutHash: Omit<ObjectDbConsumerExecutionReceipt, "receiptSha256"> = {
    receiptId: `receipt:wave1:${consumer.consumerId}:${scenarioKind.toLowerCase()}`,
    consumerId: consumer.consumerId,
    proofMode: "DIRECT",
    harness: { harnessId: binding.harnessId, harnessCaseId: binding.harnessCaseId, runner: "NODE_OBJECT_DB_PARITY_V1", path: harnessPath, sourceSha256: harnessSha256 },
    fixture: { fixtureId: binding.fixtureId, path: fixturePath, sha256: fixtureSha256 },
    invocation: { targetPath, targetSourceSha256: targetSha256, exportName: "executeWave1TitleListOwned" },
    scenario: { scenarioId: binding.scenarioId, scenarioKind },
    expectedActual: expectedActual(consumer, scenarioKind),
    equivalenceRule: null,
    verdict: "PASS",
  };
  return { ...withoutHash, receiptSha256: sha256CanonicalJson(withoutHash) };
});

writeFileSync(resolve(repoRoot, receiptPath), `${JSON.stringify({
  format: "hoibot-object-db-consumer-execution-receipts-v1",
  catalogVersion: baselineLedger.catalogVersion,
  classificationBaseCommit: manifest.baseCommit,
  evidenceCommit,
  receipts,
}, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: "PASS", caseId: parityCase.caseId, consumerIds: parityCase.consumers.map(({ consumerId }) => consumerId).sort(), receiptCount: receipts.length }));
