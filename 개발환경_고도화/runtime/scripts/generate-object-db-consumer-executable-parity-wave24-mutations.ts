import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { projectObjectDbMutationOracleResult, validateObjectDbMutationScenarioEvidence, type ObjectDbMutationScenarioEvidence } from "../src/data-migration/object-db-consumer-mutation-evidence.js";
import { sha256CanonicalJson, sha256CanonicalText, type ObjectDbConsumerExecutionReceipt } from "../src/data-migration/object-db-consumer-executable-parity-ledger.js";

const root = resolve(import.meta.dirname, "../../..");
const read = (path: string): string => readFileSync(resolve(root, path), "utf8");
const priorPath = "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave23-v1.json";
const fixturePath = "개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-wave24-mutations-v1.json";
const harnessPath = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave24-mutations-harness.mjs";
const targetPath = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave24-target.mjs";
const outputPath = "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave24-v1.json";
const evidenceCommit = process.argv[2];
if (typeof evidenceCommit !== "string" || !/^[0-9a-f]{40}$/.test(evidenceCommit)) throw new Error("Wave24 exact evidenceCommit required");
const committed = (path: string): string => {
  const listing = execFileSync("git", ["ls-tree", evidenceCommit, "--", path], { cwd: root, encoding: "utf8" });
  const match = /^[0-9]+ blob ([0-9a-f]{40})\t/.exec(listing);
  if (!match?.[1]) throw new Error(`Wave24 committed blob missing: ${path}`);
  return execFileSync("git", ["cat-file", "blob", match[1]], { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
};
const prior = JSON.parse(read(priorPath)), fixture = JSON.parse(committed(fixturePath));
const prefix = JSON.stringify(prior.receipts);
if (prior.receipts.length !== 243 || Buffer.byteLength(prefix, "utf8") !== 970854 || sha256CanonicalText(prefix) !== "e21eeacea4c7c9b3fb733a349b928e0d1248579ddbb2cf770e20b1b0fd0b5f97") throw new Error("Wave24 immutable Wave23 receipt prefix drift");
if (fixture.cases.length !== 1 || fixture.cases.some((candidate: any) => candidate.bindings.length !== 6 || candidate.sealedObservations.length !== 6) || fixture.shadowObservation === null) throw new Error("Wave24 fixture cardinality drift");
const hashes = { harness: sha256CanonicalText(committed(harnessPath)), fixture: sha256CanonicalText(committed(fixturePath)), target: sha256CanonicalText(committed(targetPath)) };
for (const [path, value] of [[harnessPath, hashes.harness], [fixturePath, hashes.fixture], [targetPath, hashes.target]] as const) if (sha256CanonicalText(read(path)) !== value) throw new Error(`Wave24 evidence/worktree drift: ${path}`);
const added: ObjectDbConsumerExecutionReceipt[] = [];
for (const candidate of fixture.cases) {
  const runtimeSourceHashes = candidate.runtimeSourcePaths.map((path: string) => ({ path, sha256: sha256CanonicalText(committed(path)) }));
  for (const source of runtimeSourceHashes) if (sha256CanonicalText(read(source.path)) !== source.sha256) throw new Error(`Wave24 runtime source drift: ${source.path}`);
  for (const binding of candidate.bindings) {
      const directory = mkdtempSync(join(tmpdir(), "wave24-mutation-receipt-"));
    try {
      const inputPath = join(directory, "input.json"), invocation = { targetPath, targetSourceSha256: hashes.target, exportName: binding.exportName };
      writeFileSync(inputPath, JSON.stringify({ binding: { ...binding, fixtureId: fixture.fixtureId, harnessId: "harness:wave24:mutations" }, fixturePayload: fixture, evidenceCommit, runtimeSourceHashes, invocation }), "utf8");
      execFileSync(process.execPath, ["--import", "tsx", resolve(root, harnessPath), inputPath, directory, resolve(root, targetPath)], { cwd: resolve(root, "개발환경_고도화/runtime"), stdio: "pipe", timeout: 120_000, maxBuffer: 32 * 1024 * 1024 });
      const reply = readFileSync(join(directory, "reply.raw"), "utf8"), result = readFileSync(join(directory, "result.raw"), "utf8");
      const trace = JSON.parse(readFileSync(join(directory, "trace.json"), "utf8")) as ObjectDbMutationScenarioEvidence;
      const verified = validateObjectDbMutationScenarioEvidence(candidate.mutationContract, trace);
      const oracle = candidate.mutationContract.scenarios.find((item: any) => item.scenarioKind === binding.scenarioKind);
      if (!oracle) throw new Error("Wave24 oracle missing");
      const expectedResult = JSON.stringify(projectObjectDbMutationOracleResult(oracle));
      if (reply !== "NO_REPLY" || result !== expectedResult) throw new Error(`Wave24 harness mismatch: ${binding.scenarioKind}`);
      const primary = verified.primary;
      const actualTimeline = primary.transactionAttempts.flatMap((attempt) => [`ATTEMPT_${attempt.attempt}_BEGIN`, `ATTEMPT_${attempt.attempt}_${attempt.outcome}`]);
      const expectedTimeline = Array.from({ length: oracle.primaryTransactionAttempts }, (_, index) => [`ATTEMPT_${index + 1}_BEGIN`, `ATTEMPT_${index + 1}_${index + 1 === oracle.primaryTransactionAttempts ? oracle.primaryTransactionOutcome : "ROLLBACK"}`]).flat();
      const dmlHash = sha256CanonicalJson({ normalizedStatements: primary.committedDmlStatements, rowCount: primary.committedRowCount });
      const payload: Omit<ObjectDbConsumerExecutionReceipt, "receiptSha256"> = {
        receiptId: `receipt:wave24:${candidate.consumerId}:${binding.scenarioKind.toLowerCase()}`, consumerId: candidate.consumerId, proofMode: "DIRECT",
        harness: { harnessId: "harness:wave24:mutations", harnessCaseId: binding.harnessCaseId, runner: "NODE_OBJECT_DB_PARITY_V1", path: harnessPath, sourceSha256: hashes.harness },
        fixture: { fixtureId: fixture.fixtureId, path: fixturePath, sha256: hashes.fixture }, invocation,
        scenario: { scenarioId: binding.scenarioId, scenarioKind: binding.scenarioKind },
        expectedActual: { reply: { expectedSha256: sha256CanonicalText("NO_REPLY"), actualSha256: sha256CanonicalText(reply), match: true }, result: { expectedSha256: sha256CanonicalText(expectedResult), actualSha256: sha256CanonicalText(result), match: true }, dml: { expectedSha256: dmlHash, actualSha256: dmlHash, match: true, expectedNormalizedStatements: primary.committedDmlStatements, actualNormalizedStatements: primary.committedDmlStatements, expectedRowCount: oracle.expectedCommittedRowCount, actualRowCount: primary.committedRowCount }, lockOrder: { expected: oracle.expectedLockOrder, actual: primary.lockOrder, match: JSON.stringify(oracle.expectedLockOrder) === JSON.stringify(primary.lockOrder) }, transaction: { expected: oracle.primaryTransactionOutcome, actual: primary.transactionAttempts.at(-1)!.outcome, match: oracle.primaryTransactionOutcome === primary.transactionAttempts.at(-1)!.outcome, expectedTimeline, actualTimeline } },
        equivalenceRule: null, verdict: "PASS",
      };
      added.push({ ...payload, receiptSha256: sha256CanonicalJson(payload) });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
}
const receipts = [...prior.receipts, ...added];
if (added.length !== 6 || receipts.length !== 249 || new Set(receipts.map((receipt: { receiptId: string }) => receipt.receiptId)).size !== 249) throw new Error("Wave24 receipt cardinality drift");
writeFileSync(resolve(root, outputPath), `${JSON.stringify({ format: prior.format, catalogVersion: prior.catalogVersion, classificationBaseCommit: prior.classificationBaseCommit, evidenceCommit, receipts }, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: "PASS", preservedWave23: 243, addedWave24: 6, total: 249, evidenceCommit }));
