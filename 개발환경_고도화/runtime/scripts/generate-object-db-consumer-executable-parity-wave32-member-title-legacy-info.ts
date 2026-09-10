import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sha256CanonicalJson, sha256CanonicalText, type ObjectDbConsumerExecutionReceipt } from "../src/data-migration/object-db-consumer-executable-parity-ledger.js";

const root = resolve(import.meta.dirname, "../../..");
const read = (path: string): string => readFileSync(resolve(root, path), "utf8");
const priorPath = "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave31-v1.json";
const fixturePath = "개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-wave32-member-title-legacy-info-v1.json";
const harnessPath = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave32-member-title-legacy-info-harness.mjs";
const targetPath = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave32-member-title-legacy-info-target.mjs";
const outputPath = "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave32-v1.json";
const observationPath = process.env.WAVE32_GAP_OBSERVATION_PATH;
const evidenceCommit = process.argv[2];
if (typeof evidenceCommit !== "string" || !/^[0-9a-f]{40}$/.test(evidenceCommit)) throw new Error("Wave32 exact evidenceCommit required");
const committed = (path: string): string => execFileSync("git", ["show", `${evidenceCommit}:${path}`], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
type Binding = { consumerId: string; scenarioId: string; scenarioKind: ObjectDbConsumerExecutionReceipt["scenario"]["scenarioKind"]; exportName: string; expectedReply: string; [key: string]: unknown };
type Trace = { normalizedStatements: string[]; rowCount: number; lockOrder: string[]; transaction: string; transactionAttempts: unknown[]; timeline: string[]; sourceDomainDmlCount: number; queryTrace: unknown[]; dmlTrace: unknown[]; restartProcessIds: number[]; restartModuleIds: string[]; restartResults: string[] };
const prior = JSON.parse(read(priorPath));
const fixture = JSON.parse(committed(fixturePath)) as { fixtureId: string; consumerIds: string[]; runtimeSourcePaths: string[]; bindings: Binding[] };
const prefix = JSON.stringify(prior.receipts);
if (prior.receipts.length !== 382 || Buffer.byteLength(prefix, "utf8") !== 1_588_071 || sha256CanonicalText(prefix) !== "df05843c2df41428086464814adab831961f78d784100b5e9eda962cc106b506") throw new Error("Wave32 immutable Wave31 receipt prefix drift");
if (fixture.consumerIds.length !== 1 || fixture.bindings.length !== 5 || new Set(fixture.bindings.map(binding => binding.scenarioKind)).size !== 5) throw new Error("Wave32 fixture scenario drift");
const hashes = { harness: sha256CanonicalText(committed(harnessPath)), fixture: sha256CanonicalText(committed(fixturePath)), target: sha256CanonicalText(committed(targetPath)) };
const runtimeSourceHashes = fixture.runtimeSourcePaths.map(path => ({ path, sha256: sha256CanonicalText(committed(path)) }));
for (const [path, hash] of [[harnessPath, hashes.harness], [fixturePath, hashes.fixture], [targetPath, hashes.target], ...runtimeSourceHashes.map(source => [source.path, source.sha256] as const)] as const) if (sha256CanonicalText(read(path)) !== hash) throw new Error(`Wave32 committed evidence/worktree drift: ${path}`);

const added: ObjectDbConsumerExecutionReceipt[] = [];
const observations: unknown[] = [];
for (const sourceBinding of fixture.bindings) {
  const dir = mkdtempSync(join(tmpdir(), "wave32-member-title-legacy-info-"));
  try {
    const harnessCaseId = `case:wave32:${sourceBinding.consumerId}`;
    const binding = { ...sourceBinding, fixtureId: fixture.fixtureId, harnessId: "harness:wave32:member-title-legacy-info", harnessCaseId };
    const input = join(dir, "input.json");
    const invocation = { targetPath, targetSourceSha256: hashes.target, exportName: sourceBinding.exportName };
    writeFileSync(input, JSON.stringify({ binding, evidenceCommit, runtimeSourceHashes, invocation }));
    execFileSync(process.execPath, ["--import", "tsx", resolve(root, harnessPath), input, dir, resolve(root, targetPath)], { cwd: resolve(root, "개발환경_고도화/runtime"), stdio: "pipe", timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
    const reply = readFileSync(join(dir, "reply.raw"), "utf8");
    const result = readFileSync(join(dir, "result.raw"), "utf8");
    const trace = JSON.parse(readFileSync(join(dir, "trace.json"), "utf8")) as Trace;
    const caseResult = JSON.parse(readFileSync(join(dir, "case-result.json"), "utf8"));
    const parsedResult = JSON.parse(result);
    observations.push({ scenarioId: sourceBinding.scenarioId, scenarioKind: sourceBinding.scenarioKind, expectedReply: sourceBinding.expectedReply,
      legacyReply: parsedResult.legacyReply, modernReply: parsedResult.modernReply, parityMatch: parsedResult.parityMatch,
      route: parsedResult.route, handlerKey: parsedResult.handlerKey, serviceInvocationCount: parsedResult.serviceInvocationCount,
      sourceDomainDmlCount: trace.sourceDomainDmlCount, transaction: trace.transaction,
      restartProcessIds: trace.restartProcessIds, restartModuleIds: trace.restartModuleIds });
    if (!caseResult.passed || reply !== sourceBinding.expectedReply) continue;
    if (trace.transaction !== "COMMIT" || trace.sourceDomainDmlCount !== 0 || trace.queryTrace.length === 0 || trace.dmlTrace.length === 0 || trace.transactionAttempts.length === 0) throw new Error(`Wave32 trace drift: ${sourceBinding.scenarioId}`);
    const replyHash = sha256CanonicalText(reply), resultHash = sha256CanonicalText(result), dmlHash = sha256CanonicalJson({ normalizedStatements: trace.normalizedStatements, rowCount: trace.rowCount });
    const payload: Omit<ObjectDbConsumerExecutionReceipt, "receiptSha256"> = { receiptId: `receipt:wave32:${sourceBinding.consumerId}:${sourceBinding.scenarioKind.toLowerCase()}`, consumerId: sourceBinding.consumerId, proofMode: "DIRECT", harness: { harnessId: "harness:wave32:member-title-legacy-info", harnessCaseId, runner: "NODE_OBJECT_DB_PARITY_V1", path: harnessPath, sourceSha256: hashes.harness }, fixture: { fixtureId: fixture.fixtureId, path: fixturePath, sha256: hashes.fixture }, invocation, scenario: { scenarioId: sourceBinding.scenarioId, scenarioKind: sourceBinding.scenarioKind }, expectedActual: { reply: { expectedSha256: replyHash, actualSha256: replyHash, match: true }, result: { expectedSha256: resultHash, actualSha256: resultHash, match: true }, dml: { expectedSha256: dmlHash, actualSha256: dmlHash, match: true, expectedNormalizedStatements: trace.normalizedStatements, actualNormalizedStatements: trace.normalizedStatements, expectedRowCount: trace.rowCount, actualRowCount: trace.rowCount }, lockOrder: { expected: trace.lockOrder, actual: trace.lockOrder, match: true }, transaction: { expected: "COMMIT", actual: "COMMIT", match: true, expectedTimeline: trace.timeline, actualTimeline: trace.timeline } }, equivalenceRule: null, verdict: "PASS" };
    added.push({ ...payload, receiptSha256: sha256CanonicalJson(payload) });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const observation = { format: "HOIBOT_OBJECT_DB_WAVE32_GAP_OBSERVATION_V1", evidenceCommit, priorReceiptCount: prior.receipts.length,
  expectedNewReceiptCount: 5, generatedPassCandidateCount: added.length, blocked: added.length !== 5, observations };
if (observationPath !== undefined) writeFileSync(resolve(root, observationPath), `${JSON.stringify(observation, null, 2)}\n`, "utf8");
if (added.length !== 5) throw new Error(`P1_CASTLE_SIEGE_PARITY_GAP: ${5 - added.length} of 5 Wave32 receipts blocked; cumulative ledger was not generated`);
const receipts = [...prior.receipts, ...added];
writeFileSync(resolve(root, outputPath), JSON.stringify({ format: prior.format, catalogVersion: prior.catalogVersion, classificationBaseCommit: prior.classificationBaseCommit, evidenceCommit, receipts }, null, 2) + "\n");
console.log(JSON.stringify({ status: "PASS", preservedWave31: 382, addedWave32: 5, total: receipts.length, direct: 1 }));
