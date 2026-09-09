import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sha256CanonicalJson, sha256CanonicalText, type ObjectDbConsumerExecutionReceipt } from "../src/data-migration/object-db-consumer-executable-parity-ledger.js";

const root = resolve(import.meta.dirname, "../../..");
const read = (path: string): string => readFileSync(resolve(root, path), "utf8");
const priorPath = "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave27-v1.json";
const fixturePath = "개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-wave29-home-badge-usage-v1.json";
const harnessPath = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave29-home-badge-usage-harness.mjs";
const targetPath = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave29-home-badge-usage-target.mjs";
const outputPath = "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave29-v1.json";
const evidenceCommit = process.argv[2];
if (typeof evidenceCommit !== "string" || !/^[0-9a-f]{40}$/.test(evidenceCommit)) throw new Error("Wave29 exact evidenceCommit required");
const committed = (path: string): string => execFileSync("git", ["show", `${evidenceCommit}:${path}`], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
type Binding = { consumerId: string; scenarioId: string; scenarioKind: ObjectDbConsumerExecutionReceipt["scenario"]["scenarioKind"]; exportName: string; variant: string; input: string; negativeInput: string; expectedReply: string };
const prior = JSON.parse(read(priorPath));
const fixture = JSON.parse(committed(fixturePath)) as { fixtureId: string; consumerIds: string[]; runtimeSourcePaths: string[]; bindings: Binding[] };
const prefix = JSON.stringify(prior.receipts);
if (prior.receipts.length !== 352 || Buffer.byteLength(prefix, "utf8") !== 1_361_204 || sha256CanonicalText(prefix) !== "70fca768ac020cc1b8dcbceb221c0beeba927e2b16e7bfc32ad09677b95cec5b") throw new Error("Wave29 immutable Wave27 receipt prefix drift");
if (fixture.consumerIds.length !== 2 || fixture.bindings.length !== 10 || new Set(fixture.bindings.map(binding => `${binding.consumerId}:${binding.scenarioKind}`)).size !== 10) throw new Error("Wave29 fixture consumer/scenario drift");
const hashes = { harness: sha256CanonicalText(committed(harnessPath)), fixture: sha256CanonicalText(committed(fixturePath)), target: sha256CanonicalText(committed(targetPath)) };
const runtimeSourceHashes = fixture.runtimeSourcePaths.map(path => ({ path, sha256: sha256CanonicalText(committed(path)) }));
for (const [path, hash] of [[harnessPath, hashes.harness], [fixturePath, hashes.fixture], [targetPath, hashes.target], ...runtimeSourceHashes.map(source => [source.path, source.sha256] as const)] as const) if (sha256CanonicalText(read(path)) !== hash) throw new Error(`Wave29 committed evidence/worktree drift: ${path}`);
const added: ObjectDbConsumerExecutionReceipt[] = [];
for (const sourceBinding of fixture.bindings) {
  const dir = mkdtempSync(join(tmpdir(), "wave29-home-badge-usage-"));
  try {
    const harnessCaseId = `case:wave29:${sourceBinding.consumerId}`;
    const binding = { ...sourceBinding, fixtureId: fixture.fixtureId, harnessId: "harness:wave29:home-badge-usage", harnessCaseId };
    const input = join(dir, "input.json");
    const invocation = { targetPath, targetSourceSha256: hashes.target, exportName: sourceBinding.exportName };
    writeFileSync(input, JSON.stringify({ binding, evidenceCommit, runtimeSourceHashes, invocation }));
    execFileSync(process.execPath, ["--import", "tsx", resolve(root, harnessPath), input, dir, resolve(root, targetPath)], { cwd: resolve(root, "개발환경_고도화/runtime"), stdio: "pipe", timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
    const reply = readFileSync(join(dir, "reply.raw"), "utf8");
    const result = readFileSync(join(dir, "result.raw"), "utf8");
    const trace = JSON.parse(readFileSync(join(dir, "trace.json"), "utf8"));
    if (reply !== sourceBinding.expectedReply || trace.transaction !== "READ_ONLY" || trace.rowCount !== 0 || trace.normalizedStatements.length !== 0) throw new Error(`Wave29 exact output/DML0 drift: ${sourceBinding.scenarioId}`);
    const replyHash = sha256CanonicalText(reply), resultHash = sha256CanonicalText(result), dmlHash = sha256CanonicalJson({ normalizedStatements: [], rowCount: 0 });
    const payload: Omit<ObjectDbConsumerExecutionReceipt, "receiptSha256"> = { receiptId: `receipt:wave29:${sourceBinding.consumerId}:${sourceBinding.scenarioKind.toLowerCase()}`, consumerId: sourceBinding.consumerId, proofMode: "DIRECT", harness: { harnessId: "harness:wave29:home-badge-usage", harnessCaseId, runner: "NODE_OBJECT_DB_PARITY_V1", path: harnessPath, sourceSha256: hashes.harness }, fixture: { fixtureId: fixture.fixtureId, path: fixturePath, sha256: hashes.fixture }, invocation, scenario: { scenarioId: sourceBinding.scenarioId, scenarioKind: sourceBinding.scenarioKind }, expectedActual: { reply: { expectedSha256: replyHash, actualSha256: replyHash, match: true }, result: { expectedSha256: resultHash, actualSha256: resultHash, match: true }, dml: { expectedSha256: dmlHash, actualSha256: dmlHash, match: true, expectedNormalizedStatements: [], actualNormalizedStatements: [], expectedRowCount: 0, actualRowCount: 0 }, lockOrder: { expected: [], actual: [], match: true }, transaction: { expected: "READ_ONLY", actual: "READ_ONLY", match: true, expectedTimeline: ["READ_ONLY"], actualTimeline: ["READ_ONLY"] } }, equivalenceRule: null, verdict: "PASS" };
    added.push({ ...payload, receiptSha256: sha256CanonicalJson(payload) });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const receipts = [...prior.receipts, ...added];
if (receipts.length !== 362 || new Set(receipts.map((receipt: ObjectDbConsumerExecutionReceipt) => receipt.receiptId)).size !== 362) throw new Error("Wave29 receipt cardinality drift");
writeFileSync(resolve(root, outputPath), JSON.stringify({ format: prior.format, catalogVersion: prior.catalogVersion, classificationBaseCommit: prior.classificationBaseCommit, evidenceCommit, receipts }, null, 2) + "\n");
console.log(JSON.stringify({ status: "PASS", preservedWave27: 352, prefix352Bytes: Buffer.byteLength(prefix), prefix352Sha256: sha256CanonicalText(prefix), addedWave29: 10, total: 362, direct: 2 }));
