import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sha256CanonicalJson, sha256CanonicalText, type ObjectDbConsumerExecutionReceipt } from "../src/data-migration/object-db-consumer-executable-parity-ledger.js";

const root = resolve(import.meta.dirname, "../../..");
const read = (path: string): string => readFileSync(resolve(root, path), "utf8");
const priorPath = "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave30-v1.json";
const fixturePath = "개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-wave31-member-title-legacy-list-v1.json";
const harnessPath = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave31-member-title-legacy-list-harness.mjs";
const targetPath = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave31-member-title-legacy-list-target.mjs";
const outputPath = "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave31-v1.json";
const evidenceCommit = process.argv[2];
if (typeof evidenceCommit !== "string" || !/^[0-9a-f]{40}$/.test(evidenceCommit)) throw new Error("Wave31 exact evidenceCommit required");
const committed = (path: string): string => execFileSync("git", ["show", `${evidenceCommit}:${path}`], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
type Binding = { consumerId: string; scenarioId: string; scenarioKind: ObjectDbConsumerExecutionReceipt["scenario"]["scenarioKind"]; exportName: string; input: string; expectedReply: string; [key: string]: unknown };
type Trace = { queryTrace: unknown[]; dmlTrace: unknown[]; normalizedStatements: string[]; rowCount: number; lockOrder: string[]; transaction: string; transactionAttempts: unknown[]; timeline: string[]; sourceDomainDmlCount: number; restartProcessIds: number[]; restartModuleIds: string[]; restartResults: string[] };
const prior = JSON.parse(read(priorPath));
const fixture = JSON.parse(committed(fixturePath)) as { fixtureId: string; consumerIds: string[]; runtimeSourcePaths: string[]; bindings: Binding[] };
const prefix = JSON.stringify(prior.receipts);
if (prior.receipts.length !== 372 || Buffer.byteLength(prefix, "utf8") !== 1_485_238 || sha256CanonicalText(prefix) !== "f9b490aaea9ea67ece2188fcc1424b1c46c36871606d525ce1c0620a2d818546") throw new Error("Wave31 immutable Wave30 receipt prefix drift");
if (fixture.consumerIds.length !== 2 || fixture.bindings.length !== 10 || new Set(fixture.bindings.map(binding => `${binding.consumerId}:${binding.scenarioKind}`)).size !== 10) throw new Error("Wave31 fixture consumer/scenario drift");
const hashes = { harness: sha256CanonicalText(committed(harnessPath)), fixture: sha256CanonicalText(committed(fixturePath)), target: sha256CanonicalText(committed(targetPath)) };
const runtimeSourceHashes = fixture.runtimeSourcePaths.map(path => ({ path, sha256: sha256CanonicalText(committed(path)) }));
for (const [path, hash] of [[harnessPath, hashes.harness], [fixturePath, hashes.fixture], [targetPath, hashes.target], ...runtimeSourceHashes.map(source => [source.path, source.sha256] as const)] as const) if (sha256CanonicalText(read(path)) !== hash) throw new Error(`Wave31 committed evidence/worktree drift: ${path}`);
const added: ObjectDbConsumerExecutionReceipt[] = [];
for (const sourceBinding of fixture.bindings) {
  const dir = mkdtempSync(join(tmpdir(), "wave31-member-title-legacy-list-"));
  try {
    const harnessCaseId = `case:wave31:${sourceBinding.consumerId}`;
    const binding = { ...sourceBinding, fixtureId: fixture.fixtureId, harnessId: "harness:wave31:member-title-legacy-list", harnessCaseId };
    const input = join(dir, "input.json");
    const invocation = { targetPath, targetSourceSha256: hashes.target, exportName: sourceBinding.exportName };
    writeFileSync(input, JSON.stringify({ binding, evidenceCommit, runtimeSourceHashes, invocation }));
    execFileSync(process.execPath, ["--import", "tsx", resolve(root, harnessPath), input, dir, resolve(root, targetPath)], { cwd: resolve(root, "개발환경_고도화/runtime"), stdio: "pipe", timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
    const reply = readFileSync(join(dir, "reply.raw"), "utf8");
    const result = readFileSync(join(dir, "result.raw"), "utf8");
    const trace = JSON.parse(readFileSync(join(dir, "trace.json"), "utf8")) as Trace;
    if (reply !== sourceBinding.expectedReply || trace.transaction !== "COMMIT" || trace.sourceDomainDmlCount !== 0 || trace.queryTrace.length === 0 || trace.dmlTrace.length === 0 || trace.transactionAttempts.length === 0) throw new Error(`Wave31 ingress/output/trace drift: ${sourceBinding.scenarioId}`);
    const replyHash = sha256CanonicalText(reply), resultHash = sha256CanonicalText(result), dmlHash = sha256CanonicalJson({ normalizedStatements: trace.normalizedStatements, rowCount: trace.rowCount });
    const payload: Omit<ObjectDbConsumerExecutionReceipt, "receiptSha256"> = { receiptId: `receipt:wave31:${sourceBinding.consumerId}:${sourceBinding.scenarioKind.toLowerCase()}`, consumerId: sourceBinding.consumerId, proofMode: "DIRECT", harness: { harnessId: "harness:wave31:member-title-legacy-list", harnessCaseId, runner: "NODE_OBJECT_DB_PARITY_V1", path: harnessPath, sourceSha256: hashes.harness }, fixture: { fixtureId: fixture.fixtureId, path: fixturePath, sha256: hashes.fixture }, invocation, scenario: { scenarioId: sourceBinding.scenarioId, scenarioKind: sourceBinding.scenarioKind }, expectedActual: { reply: { expectedSha256: replyHash, actualSha256: replyHash, match: true }, result: { expectedSha256: resultHash, actualSha256: resultHash, match: true }, dml: { expectedSha256: dmlHash, actualSha256: dmlHash, match: true, expectedNormalizedStatements: trace.normalizedStatements, actualNormalizedStatements: trace.normalizedStatements, expectedRowCount: trace.rowCount, actualRowCount: trace.rowCount }, lockOrder: { expected: trace.lockOrder, actual: trace.lockOrder, match: true }, transaction: { expected: "COMMIT", actual: "COMMIT", match: true, expectedTimeline: trace.timeline, actualTimeline: trace.timeline } }, equivalenceRule: null, verdict: "PASS" };
    added.push({ ...payload, receiptSha256: sha256CanonicalJson(payload) });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const receipts = [...prior.receipts, ...added];
if (receipts.length !== 382 || new Set(receipts.map((receipt: ObjectDbConsumerExecutionReceipt) => receipt.receiptId)).size !== 382) throw new Error("Wave31 receipt cardinality drift");
writeFileSync(resolve(root, outputPath), JSON.stringify({ format: prior.format, catalogVersion: prior.catalogVersion, classificationBaseCommit: prior.classificationBaseCommit, evidenceCommit, receipts }, null, 2) + "\n");
console.log(JSON.stringify({ status: "PASS", preservedWave30: 372, prefix372Bytes: Buffer.byteLength(prefix), prefix372Sha256: sha256CanonicalText(prefix), addedWave31: 10, total: 382, direct: 2 }));
