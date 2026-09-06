import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import {
  buildObjectDbConsumerExecutableParityLedger,
  OBJECT_DB_EXECUTABLE_PARITY_VERDICTS,
  sha256CanonicalJson,
  sha256CanonicalText,
  validateObjectDbConsumerExecutableParityLedger,
  type ConsumerManifestInput,
  type ExecutableParityLedger,
  type ExpectedActualEvidence,
  type ObjectDbConsumerExecutionReceipt,
  type ObjectDbConsumerExecutionReceiptBundle,
  type ObjectDbParityScenarioKind,
} from "../src/data-migration/object-db-consumer-executable-parity-ledger.js";
import { parseConsumerIdRegistry } from "../src/data-migration/object-db-consumer-id-registry.js";

const runtimeRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(runtimeRoot, "../..");
const paths = {
  ledgerSchema: "개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-ledger.v1.schema.json",
  executionReceiptSchema: "개발환경_고도화/migration-control/contracts/object-db-consumer-execution-receipt.v1.schema.json",
  consumerManifest: "개발환경_고도화/migration-control/contracts/object-db-consumer-manifest.v1.json",
  consumerIdRegistry: "개발환경_고도화/migration-control/contracts/object-db-consumer-id-registry.v1.json",
  transitionContract: "개발환경_고도화/migration-control/contracts/object-db-consumer-transition.v1.json",
  executionReceipts: "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave0-v1.json",
} as const;
const wave1ReceiptPath = "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave4-v1.json";
const read = (path: string): string => readFileSync(resolve(repoRoot, path), "utf8");
const manifestText = read(paths.consumerManifest);
const manifest = JSON.parse(manifestText) as ConsumerManifestInput;
const registryText = read(paths.consumerIdRegistry);
const registry = parseConsumerIdRegistry(JSON.parse(registryText), manifest.baseCommit);
const emptyBundle = JSON.parse(read(paths.executionReceipts)) as ObjectDbConsumerExecutionReceiptBundle;
const classificationSourceTexts = Object.fromEntries([...new Set(manifest.audit.registrySourceMismatches.map((label) => label.slice(0, label.indexOf(":"))))].sort().map((path) => [path, read(path)]));
const baseInput = {
  ledgerSchemaText: read(paths.ledgerSchema),
  executionReceiptSchemaText: read(paths.executionReceiptSchema),
  consumerManifestText: manifestText,
  consumerIdRegistryText: registryText,
  transitionContractText: read(paths.transitionContract),
  executionReceiptsText: JSON.stringify(emptyBundle, null, 2),
  classificationSourceTexts,
  sourcePaths: paths,
};

function expectedActual(kind: ObjectDbParityScenarioKind, accessClass: "READ" | "MUTATION"): ExpectedActualEvidence {
  const dmlZero = accessClass === "READ" || new Set<ObjectDbParityScenarioKind>(["AUTH_DENIED", "WRONG_ROOM_REJECTED", "PAYLOAD_DRIFT_FAIL_CLOSED", "DUPLICATE_REPLAY_DML_ZERO", "RESTART_REPLAY"]).has(kind);
  const statements = dmlZero ? [] : ["UPDATE canonical_owned_item_stacks SET quantity = ? WHERE owned_item_stack_id = ?"];
  const rowCount = dmlZero ? 0 : 1;
  const dmlHash = sha256CanonicalJson({ normalizedStatements: statements, rowCount });
  const replyHash = sha256CanonicalText(`reply:${kind}`);
  const resultHash = sha256CanonicalText(`result:${kind}`);
  const rollback = kind === "DOMAIN_FAILURE_ROLLBACK" || kind === "PAYLOAD_DRIFT_FAIL_CLOSED";
  const transaction = accessClass === "READ" ? "READ_ONLY" as const : rollback ? "ROLLBACK" as const : "COMMIT" as const;
  const timeline = transaction === "READ_ONLY" ? ["READ"] : transaction === "ROLLBACK" ? ["BEGIN", "ROLLBACK"] : ["BEGIN", "COMMIT"];
  const locks = accessClass === "READ" ? [] : ["canonical_players", "canonical_owned_item_stacks"];
  return {
    reply: { expectedSha256: replyHash, actualSha256: replyHash, match: true },
    result: { expectedSha256: resultHash, actualSha256: resultHash, match: true },
    dml: { expectedSha256: dmlHash, actualSha256: dmlHash, match: true, expectedNormalizedStatements: statements, actualNormalizedStatements: statements, expectedRowCount: rowCount, actualRowCount: rowCount },
    lockOrder: { expected: locks.slice(), actual: locks.slice(), match: true },
    transaction: { expected: transaction, actual: transaction, match: true, expectedTimeline: timeline.slice(), actualTimeline: timeline.slice() },
  };
}

function receiptHash(receipt: Omit<ObjectDbConsumerExecutionReceipt, "receiptSha256"> | ObjectDbConsumerExecutionReceipt): string {
  const { receiptSha256: _receiptSha256, ...payload } = receipt as ObjectDbConsumerExecutionReceipt;
  return sha256CanonicalJson(payload);
}

function receiptsFor(entry: ExecutableParityLedger["entries"][number], limit?: number): { receipts: ObjectDbConsumerExecutionReceipt[]; files: Record<string, string> } {
  const required = entry.scenarioRequirements.filter(({ disposition }) => disposition === "REQUIRED").map(({ scenarioKind }) => scenarioKind).slice(0, limit);
  const harnessId = `harness:${entry.consumerId}`;
  const fixtureId = `fixture:${entry.consumerId}`;
  const harnessPath = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-harness.mjs";
  const targetPath = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-synthetic-consumer.mjs";
  const fixturePath = `migration-control/fixtures/generated/${entry.consumerId}.json`;
  const bindings = required.map((scenarioKind, index) => ({ consumerId: entry.consumerId, harnessId, harnessCaseId: `case:${index}`, fixtureId, scenarioId: `scenario:${index}`, scenarioKind }));
  const harnessText = read(harnessPath);
  const targetText = read(targetPath);
  const fixtureText = `${JSON.stringify({ format: "hoibot-object-db-consumer-parity-case-fixture-v1", fixtureId, bindings, payload: { accessClass: entry.classification.accessClass } }, null, 2)}\n`;
  const harnessSha = sha256CanonicalText(harnessText);
  const fixtureSha = sha256CanonicalText(fixtureText);
  const targetSha = sha256CanonicalText(targetText);
  const receipts = bindings.map((binding) => {
    const payload: Omit<ObjectDbConsumerExecutionReceipt, "receiptSha256"> = {
      receiptId: `receipt:${entry.consumerId}:${binding.scenarioKind.toLowerCase()}`,
      consumerId: entry.consumerId,
      proofMode: "DIRECT",
      harness: { harnessId, harnessCaseId: binding.harnessCaseId, runner: "NODE_OBJECT_DB_PARITY_V1", path: harnessPath, sourceSha256: harnessSha },
      fixture: { fixtureId, path: fixturePath, sha256: fixtureSha },
      invocation: { targetPath, targetSourceSha256: targetSha, exportName: "executeSyntheticConsumer" },
      scenario: { scenarioId: binding.scenarioId, scenarioKind: binding.scenarioKind },
      expectedActual: expectedActual(binding.scenarioKind, entry.classification.accessClass),
      equivalenceRule: null,
      verdict: "PASS",
    };
    return { ...payload, receiptSha256: receiptHash(payload) };
  });
  return { receipts, files: { [harnessPath]: harnessText, [fixturePath]: fixtureText, [targetPath]: targetText } };
}

function buildWith(receipts: ObjectDbConsumerExecutionReceipt[], evidenceFileTexts: Record<string, string>): ExecutableParityLedger {
  const bundle: ObjectDbConsumerExecutionReceiptBundle = { ...emptyBundle, receipts };
  return buildObjectDbConsumerExecutableParityLedger({ ...baseInput, executionReceiptsText: JSON.stringify(bundle, null, 2), evidenceFileTexts });
}

function wave1Proof(consumerId: string, limit?: number): { receipts: ObjectDbConsumerExecutionReceipt[]; files: Record<string, string>; bundle: ObjectDbConsumerExecutionReceiptBundle } {
  const bundle = JSON.parse(read(wave1ReceiptPath)) as ObjectDbConsumerExecutionReceiptBundle;
  const receipts = bundle.receipts.filter((receipt) => receipt.consumerId === consumerId).slice(0, limit);
  assert.ok(receipts.length > 0);
  const files = Object.fromEntries([...new Set(receipts.flatMap((receipt) => [receipt.harness.path, receipt.fixture.path, receipt.invocation.targetPath]))].map((path) => [path, read(path)]));
  return { receipts, files, bundle };
}

function buildWave1With(receipts: ObjectDbConsumerExecutionReceipt[], files: Record<string, string>, bundle: ObjectDbConsumerExecutionReceiptBundle): ExecutableParityLedger {
  return buildObjectDbConsumerExecutableParityLedger({
    ...baseInput,
    executionReceiptsText: JSON.stringify({ ...bundle, receipts }, null, 2),
    sourcePaths: { ...paths, executionReceipts: wave1ReceiptPath },
    evidenceFileTexts: files,
  });
}

describe("object DB executable parity ledger Wave0", () => {
  it("builds the exact source-derived fail-closed 1,111-ID baseline", () => {
    const ledger = buildObjectDbConsumerExecutableParityLedger(baseInput);
    assert.deepEqual(ledger.coverage, {
      manifestConsumers: 1_111, ledgerEntries: 1_111, missingConsumerIds: 0, duplicateConsumerIds: 0, unknownConsumerIds: 0,
      readConsumers: 499, mutationConsumers: 612, unresolvedDynamicConsumers: 552, unresolvedDynamicCallCount: 790,
      registrySourceMismatchCount: 8, registrySourceMismatchAttributedCount: 0, registrySourceMismatchUnattributedCount: 8,
      provenConsumers: 0, unprovenConsumers: 1_111, directPassConsumers: 0, equivalentPassConsumers: 0,
      verdicts: { STATIC_ONLY: 559, BLOCKED_DYNAMIC: 552, BLOCKED_REGISTRY_MISMATCH: 0, PARTIAL: 0, DIRECT_PASS: 0, EQUIVALENT_PASS: 0 },
    });
    assert.equal(new Set(ledger.entries.map(({ consumerId }) => consumerId)).size, 1_111);
    assert.equal(ledger.entrySetSha256, sha256CanonicalJson(ledger.entries));
    assert.deepEqual(OBJECT_DB_EXECUTABLE_PARITY_VERDICTS, ["STATIC_ONLY", "BLOCKED_DYNAMIC", "BLOCKED_REGISTRY_MISMATCH", "PARTIAL", "DIRECT_PASS", "EQUIVALENT_PASS"]);
  });

  it("is deterministic across LF/CRLF for every hashed text input", () => {
    const lf = buildObjectDbConsumerExecutableParityLedger(baseInput);
    const crlf = (value: string): string => value.replace(/\r\n?/g, "\n").replace(/\n/g, "\r\n");
    const actual = buildObjectDbConsumerExecutableParityLedger({
      ...baseInput,
      ledgerSchemaText: crlf(baseInput.ledgerSchemaText), executionReceiptSchemaText: crlf(baseInput.executionReceiptSchemaText),
      consumerManifestText: crlf(baseInput.consumerManifestText), consumerIdRegistryText: crlf(baseInput.consumerIdRegistryText),
      transitionContractText: crlf(baseInput.transitionContractText), executionReceiptsText: crlf(baseInput.executionReceiptsText),
      classificationSourceTexts: Object.fromEntries(Object.entries(baseInput.classificationSourceTexts).map(([path, text]) => [path, crlf(text)])),
    });
    assert.deepEqual(actual, lf);
  });

  it("promotes only a valid receipt subset to PARTIAL and a complete matrix to DIRECT_PASS", () => {
    const consumerId = "sql-repository-0dc3c380c54081a2";
    const full = wave1Proof(consumerId);
    const partial = wave1Proof(consumerId, 1);
    assert.equal(buildWave1With(partial.receipts, partial.files, partial.bundle).entries.find((entry) => entry.consumerId === consumerId)?.verdict, "PARTIAL");
    const ledger = buildWave1With(full.receipts, full.files, full.bundle);
    assert.equal(ledger.entries.find((entry) => entry.consumerId === consumerId)?.verdict, "DIRECT_PASS");
    assert.equal(ledger.coverage.provenConsumers, 1);
  });

  it("rejects unrelated, self-hash, other-consumer, and fixture-binding evidence", () => {
    const baseline = buildObjectDbConsumerExecutableParityLedger(baseInput);
    const entry = baseline.entries.find(({ consumerId }) => consumerId === "sql-repository-0dc3c380c54081a2")!;
    const proofWithBundle = wave1Proof(entry.consumerId, 1);
    const proof = { receipts: proofWithBundle.receipts, files: proofWithBundle.files };
    const receipt = proof.receipts[0]!;
    const commentsOnly = structuredClone(receipt);
    const commentsText = `// OBJECT_DB_EXECUTABLE_PARITY_BINDING:${JSON.stringify({ consumerId: receipt.consumerId })}\n`;
    commentsOnly.harness.sourceSha256 = sha256CanonicalText(commentsText);
    commentsOnly.receiptSha256 = receiptHash(commentsOnly);
    assert.throws(() => buildWave1With([commentsOnly], { ...proof.files, [receipt.harness.path]: commentsText }, proofWithBundle.bundle), /evidenceCommit blob hash drift/);
    for (const [maliciousPath] of [
      ["개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-print-only-harness.mjs"],
      ["개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-rawless-harness.mjs"],
    ] as const) {
      const maliciousText = read(maliciousPath);
      const malicious = structuredClone(receipt);
      malicious.harness.path = maliciousPath;
      malicious.harness.sourceSha256 = sha256CanonicalText(maliciousText);
      malicious.receiptSha256 = receiptHash(malicious);
      assert.throws(() => buildWave1With([malicious], { ...proof.files, [maliciousPath]: maliciousText }, proofWithBundle.bundle), /runner entrypoint is not allowlisted/);
    }
    const ignoredRunner = structuredClone(receipt);
    ignoredRunner.harness.runner = "node --eval";
    ignoredRunner.receiptSha256 = receiptHash(ignoredRunner);
    assert.throws(() => buildWave1With([ignoredRunner], proof.files, proofWithBundle.bundle), /runner metadata is not allowlisted/);
    const targetHashDrift = structuredClone(receipt);
    targetHashDrift.invocation.targetSourceSha256 = "0".repeat(64);
    targetHashDrift.receiptSha256 = receiptHash(targetHashDrift);
    assert.throws(() => buildWave1With([targetHashDrift], proof.files, proofWithBundle.bundle), /evidenceCommit blob hash drift/);
    const selfPath = structuredClone(receipt);
    selfPath.harness.path = paths.executionReceipts;
    selfPath.receiptSha256 = receiptHash(selfPath);
    assert.throws(() => buildWave1With([selfPath], { ...proof.files, [paths.executionReceipts]: baseInput.executionReceiptsText }, proofWithBundle.bundle), /trusted Wave1 invocation target drift|trusted input|evidenceCommit blob hash drift/);
    const other = structuredClone(receipt);
    other.consumerId = baseline.entries.find(({ consumerId }) => consumerId !== entry.consumerId)!.consumerId;
    other.receiptSha256 = receiptHash(other);
    assert.throws(() => buildWave1With([other], proof.files, proofWithBundle.bundle), /unrelated harness|blocked consumer|binding|trusted/);
    const unrelatedFixtureText = JSON.stringify({ format: "hoibot-object-db-consumer-parity-case-fixture-v1", fixtureId: receipt.fixture.fixtureId, bindings: [], payload: {} });
    const unrelatedFixture = structuredClone(receipt);
    unrelatedFixture.fixture.sha256 = sha256CanonicalText(unrelatedFixtureText);
    unrelatedFixture.receiptSha256 = receiptHash(unrelatedFixture);
    assert.throws(() => buildWave1With([unrelatedFixture], { ...proof.files, [receipt.fixture.path]: unrelatedFixtureText }, proofWithBundle.bundle), /evidenceCommit blob hash drift|unrelated fixture/);
  });

  it("rejects reply/result, DML row, lock-order, timeline, and arbitrary verdict drift", () => {
    const entry = buildObjectDbConsumerExecutableParityLedger(baseInput).entries.find(({ consumerId }) => consumerId === "sql-repository-0dc3c380c54081a2")!;
    const proofWithBundle = wave1Proof(entry.consumerId, 1);
    const proof = { receipts: proofWithBundle.receipts, files: proofWithBundle.files };
    for (const [label, mutate] of [
      ["result", (receipt: ObjectDbConsumerExecutionReceipt) => { const hash = sha256CanonicalText("self-declared-result"); receipt.expectedActual.result.expectedSha256 = hash; receipt.expectedActual.result.actualSha256 = hash; }],
      ["DML row", (receipt: ObjectDbConsumerExecutionReceipt) => { receipt.expectedActual.dml.expectedRowCount! += 1; receipt.expectedActual.dml.actualRowCount! += 1; const hash = sha256CanonicalJson({ normalizedStatements: receipt.expectedActual.dml.actualNormalizedStatements, rowCount: receipt.expectedActual.dml.actualRowCount }); receipt.expectedActual.dml.expectedSha256 = hash; receipt.expectedActual.dml.actualSha256 = hash; }],
      ["lock order", (receipt: ObjectDbConsumerExecutionReceipt) => { receipt.expectedActual.lockOrder.expected!.push("drift_lock"); receipt.expectedActual.lockOrder.actual!.push("drift_lock"); }],
      ["timeline", (receipt: ObjectDbConsumerExecutionReceipt) => { receipt.expectedActual.transaction.expectedTimeline!.push("DRIFT"); receipt.expectedActual.transaction.actualTimeline!.push("DRIFT"); }],
    ] as const) {
      const drift = structuredClone(proof.receipts[0]!); mutate(drift); drift.receiptSha256 = receiptHash(drift);
      assert.throws(() => buildWave1With([drift], proof.files, proofWithBundle.bundle), /raw .*mismatch|fingerprint drift|READ scenario must have business DML0/, label);
    }
    const ledger = buildObjectDbConsumerExecutableParityLedger(baseInput);
    ledger.entries.find(({ verdict }) => verdict === "STATIC_ONLY")!.verdict = "DIRECT_PASS";
    ledger.entrySetSha256 = sha256CanonicalJson(ledger.entries);
    assert.throws(() => validateObjectDbConsumerExecutableParityLedger(ledger, { manifest, registry }), /verdict|PASS/);
  });

  it("enforces READ_ONLY/DML0 reads and DML0 mutation guard/replay semantics", () => {
    const baseline = buildObjectDbConsumerExecutableParityLedger(baseInput);
    const readEntry = baseline.entries.find(({ verdict, classification }) => verdict === "STATIC_ONLY" && classification.accessClass === "READ")!;
    const readProof = receiptsFor(readEntry);
    const invalidRead = structuredClone(readProof.receipts[0]!);
    invalidRead.expectedActual.transaction = { expected: "COMMIT", actual: "COMMIT", match: true, expectedTimeline: ["BEGIN", "COMMIT"], actualTimeline: ["BEGIN", "COMMIT"] };
    invalidRead.receiptSha256 = receiptHash(invalidRead);
    assert.throws(() => buildWith([invalidRead], readProof.files), /READ scenario must be READ_ONLY/);
    const invalidReadDml = structuredClone(readProof.receipts[0]!);
    const readStatements = ["UPDATE forbidden_source_domain SET value = ?"];
    const readDmlHash = sha256CanonicalJson({ normalizedStatements: readStatements, rowCount: 1 });
    invalidReadDml.expectedActual.dml = { expectedSha256: readDmlHash, actualSha256: readDmlHash, match: true, expectedNormalizedStatements: readStatements.slice(), actualNormalizedStatements: readStatements.slice(), expectedRowCount: 1, actualRowCount: 1 };
    invalidReadDml.receiptSha256 = receiptHash(invalidReadDml);
    assert.throws(() => buildWith([invalidReadDml], readProof.files), /READ scenario must have business DML0/);

    const mutationEntry = baseline.entries.find(({ verdict, classification, scenarioRequirements }) => verdict === "STATIC_ONLY" && classification.accessClass === "MUTATION" && scenarioRequirements.some(({ scenarioKind, disposition }) => scenarioKind === "PAYLOAD_DRIFT_FAIL_CLOSED" && disposition === "REQUIRED"))!;
    const mutationProof = receiptsFor(mutationEntry);
    for (const kind of ["AUTH_DENIED", "WRONG_ROOM_REJECTED", "PAYLOAD_DRIFT_FAIL_CLOSED", "DUPLICATE_REPLAY_DML_ZERO", "RESTART_REPLAY"] as const) {
      const invalid = structuredClone(mutationProof.receipts[0]!);
      invalid.scenario.scenarioKind = kind;
      const statements = ["UPDATE canonical_owned_item_stacks SET quantity = ? WHERE owned_item_stack_id = ?"];
      const hash = sha256CanonicalJson({ normalizedStatements: statements, rowCount: 1 });
      invalid.expectedActual.dml = { expectedSha256: hash, actualSha256: hash, match: true, expectedNormalizedStatements: statements.slice(), actualNormalizedStatements: statements.slice(), expectedRowCount: 1, actualRowCount: 1 };
      if (kind === "PAYLOAD_DRIFT_FAIL_CLOSED") invalid.expectedActual.transaction = { expected: "ROLLBACK", actual: "ROLLBACK", match: true, expectedTimeline: ["BEGIN", "ROLLBACK"], actualTimeline: ["BEGIN", "ROLLBACK"] };
      invalid.receiptSha256 = receiptHash(invalid);
      assert.throws(() => buildWith([invalid], mutationProof.files), /business DML0|DML-zero/);
    }
  });

  it("rejects missing, duplicate, unknown, and classification-drifted ledger IDs", () => {
    for (const mutate of [
      (ledger: ExecutableParityLedger) => { ledger.entries.pop(); },
      (ledger: ExecutableParityLedger) => { ledger.entries.splice(1, 0, structuredClone(ledger.entries[0]!)); },
      (ledger: ExecutableParityLedger) => { ledger.entries[0]!.consumerId = "legacy-ffffffffffffffff"; ledger.entries.sort((a, b) => a.consumerId.localeCompare(b.consumerId)); },
      (ledger: ExecutableParityLedger) => { ledger.entries[0]!.classification.interfaceId += "-drift"; },
    ]) {
      const ledger = buildObjectDbConsumerExecutableParityLedger(baseInput); mutate(ledger); ledger.entrySetSha256 = sha256CanonicalJson(ledger.entries);
      assert.throws(() => validateObjectDbConsumerExecutableParityLedger(ledger, { manifest, registry }), /coverage drift|join|duplicate|classification drift|sorted/);
    }
  });

  it("keeps both Draft 2020-12 schemas parseable and closed", () => {
    for (const text of [baseInput.ledgerSchemaText, baseInput.executionReceiptSchemaText]) {
      const schema = JSON.parse(text) as Record<string, unknown>;
      assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
      assert.equal(schema.additionalProperties, false);
    }
  });
});
