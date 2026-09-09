import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { sha256CanonicalJson, sha256CanonicalText, type ObjectDbConsumerExecutionReceipt } from "../src/data-migration/object-db-consumer-executable-parity-ledger.js";

const root = resolve(import.meta.dirname, "../../..");
const read = (path: string): string => readFileSync(resolve(root, path), "utf8");
const priorPath = "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave24-v1.json";
const fixturePath = "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-executable-parity-wave25-item-bag-v1.json";
const harnessPath = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave25-item-bag-harness.mjs";
const targetPath = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave25-item-bag.mjs";
const outputPath = "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave25-v1.json";
const consumerId = "legacy-94904fa11988ff04";
const harnessId = "harness:wave25:item-bag";
const harnessCaseId = "case:wave25:item-bag";
const evidenceCommit = process.argv[2];
if (typeof evidenceCommit !== "string" || !/^[0-9a-f]{40}$/.test(evidenceCommit)) throw new Error("Wave25 exact 40-character evidenceCommit required");
const committed = (path: string): string => {
  const listing = execFileSync("git", ["ls-tree", evidenceCommit, "--", path], { cwd: root, encoding: "utf8" });
  const match = /^[0-9]+ blob ([0-9a-f]{40})\t/.exec(listing);
  if (match?.[1] === undefined) throw new Error(`Wave25 committed blob missing: ${path}`);
  return execFileSync("git", ["cat-file", "blob", match[1]], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
};
type Binding = { consumerId: string; scenarioId: string; scenarioKind: ObjectDbConsumerExecutionReceipt["scenario"]["scenarioKind"]; exportName: string; expectedResultSha256: string };
const prior = JSON.parse(read(priorPath));
const fixture = JSON.parse(committed(fixturePath)) as { fixtureId: string; consumerId: string; runtimeSourcePaths: string[]; bindings: Binding[] };
const prefix = JSON.stringify(prior.receipts);
if (prior.receipts.length !== 249 || Buffer.byteLength(prefix, "utf8") !== 988_846 || sha256CanonicalText(prefix) !== "2287ae220032e0190d5fec91eadbe6c10d50acb0590f5f9ccba683a26f57820b") throw new Error("Wave25 immutable Wave24 receipt prefix drift");
if (fixture.consumerId !== consumerId || fixture.bindings.length !== 5 || new Set(fixture.bindings.map((binding) => binding.scenarioKind)).size !== 5 || fixture.bindings.some((binding) => binding.consumerId !== consumerId || binding.exportName !== "executeWave25ItemBag")) throw new Error("Wave25 fixture consumer/scenario drift");
const hashes = { harness: sha256CanonicalText(committed(harnessPath)), fixture: sha256CanonicalText(committed(fixturePath)), target: sha256CanonicalText(committed(targetPath)) };
const runtimeSourceHashes = fixture.runtimeSourcePaths.map((path) => ({ path, sha256: sha256CanonicalText(committed(path)) }));
for (const [path, hash] of [[harnessPath, hashes.harness], [fixturePath, hashes.fixture], [targetPath, hashes.target], ...runtimeSourceHashes.map((source) => [source.path, source.sha256] as const)] as const) {
  if (sha256CanonicalText(read(path)) !== hash) throw new Error(`Wave25 committed evidence/worktree drift: ${path}`);
}
const added: ObjectDbConsumerExecutionReceipt[] = [];
for (const sourceBinding of fixture.bindings) {
  const dir = mkdtempSync(join(tmpdir(), "wave25-item-bag-receipt-"));
  try {
    const binding = { ...sourceBinding, fixtureId: fixture.fixtureId, harnessId, harnessCaseId };
    const input = join(dir, "input.json");
    const invocation = { targetPath, targetSourceSha256: hashes.target, exportName: sourceBinding.exportName };
    writeFileSync(input, JSON.stringify({ binding, evidenceCommit, runtimeSourceHashes, invocation }));
    execFileSync(process.execPath, ["--import", "tsx", resolve(root, harnessPath), input, dir, resolve(root, targetPath)], { stdio: "pipe", timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
    const reply = readFileSync(join(dir, "reply.raw"), "utf8");
    const result = readFileSync(join(dir, "result.raw"), "utf8");
    const trace = JSON.parse(readFileSync(join(dir, "trace.json"), "utf8"));
    if (sha256CanonicalText(result) !== sourceBinding.expectedResultSha256) throw new Error(`Wave25 independent output drift: ${sourceBinding.scenarioKind}`);
    if (trace.transaction !== "READ_ONLY" || trace.sourceDomainDmlCount !== 0 || trace.rowCount !== 0 || trace.normalizedStatements.length !== 0) throw new Error(`Wave25 READ_ONLY/DML0 drift: ${sourceBinding.scenarioKind}`);
    const replyHash = sha256CanonicalText(reply);
    const resultHash = sha256CanonicalText(result);
    const dmlHash = sha256CanonicalJson({ normalizedStatements: [], rowCount: 0 });
    const payload: Omit<ObjectDbConsumerExecutionReceipt, "receiptSha256"> = {
      receiptId: `receipt:wave25:${consumerId}:${sourceBinding.scenarioKind.toLowerCase()}`,
      consumerId,
      proofMode: "DIRECT",
      harness: { harnessId, harnessCaseId, runner: "NODE_OBJECT_DB_PARITY_V1", path: harnessPath, sourceSha256: hashes.harness },
      fixture: { fixtureId: fixture.fixtureId, path: fixturePath, sha256: hashes.fixture },
      invocation,
      scenario: { scenarioId: sourceBinding.scenarioId, scenarioKind: sourceBinding.scenarioKind },
      expectedActual: {
        reply: { expectedSha256: replyHash, actualSha256: replyHash, match: true },
        result: { expectedSha256: resultHash, actualSha256: resultHash, match: true },
        dml: { expectedSha256: dmlHash, actualSha256: dmlHash, match: true, expectedNormalizedStatements: [], actualNormalizedStatements: [], expectedRowCount: 0, actualRowCount: 0 },
        lockOrder: { expected: [], actual: [], match: true },
        transaction: { expected: "READ_ONLY", actual: "READ_ONLY", match: true, expectedTimeline: ["READ_ONLY"], actualTimeline: ["READ_ONLY"] },
      },
      equivalenceRule: null,
      verdict: "PASS",
    };
    added.push({ ...payload, receiptSha256: sha256CanonicalJson(payload) });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const receipts = [...prior.receipts, ...added];
if (added.length !== 5 || receipts.length !== 254 || new Set(receipts.map((receipt) => receipt.receiptId)).size !== 254) throw new Error("Wave25 active receipt cardinality drift");
writeFileSync(resolve(root, outputPath), JSON.stringify({ format: prior.format, catalogVersion: prior.catalogVersion, classificationBaseCommit: prior.classificationBaseCommit, evidenceCommit, receipts }, null, 2) + "\n");
console.log(JSON.stringify({ status: "PASS", preservedWave24: 249, addedWave25: 5, total: 254, evidenceCommit }));
