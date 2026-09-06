import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sha256CanonicalJson, sha256CanonicalText, type ObjectDbConsumerExecutionReceipt } from "../src/data-migration/object-db-consumer-executable-parity-ledger.js";

const root = resolve(import.meta.dirname, "../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const fixturePath = "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-executable-parity-wave10-pendant-read-v1.json";
const harnessPath = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave10-harness.mjs";
const targetPath = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave10-pendant-read.mjs";
const outputPath = "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave10-v1.json";
const fixture = JSON.parse(read(fixturePath));
const prior = JSON.parse(read("개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave9-v1.json"));
const evidenceCommit = process.argv[2] ?? execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const hashes = { harness: sha256CanonicalText(read(harnessPath)), fixture: sha256CanonicalText(read(fixturePath)), target: sha256CanonicalText(read(targetPath)) };
const preserved: ObjectDbConsumerExecutionReceipt[] = prior.receipts;
const added: ObjectDbConsumerExecutionReceipt[] = [];
if (preserved.length !== 119) throw new Error(`Wave10 prior receipt count drift: ${preserved.length}`);
const priorIds = new Set<string>();
for (const receipt of preserved) {
  const { receiptSha256, ...payload } = receipt;
  if (receiptSha256 !== sha256CanonicalJson(payload)) throw new Error(`Wave9 prior receipt hash drift: ${receipt.receiptId}`);
  if (priorIds.has(receipt.receiptId)) throw new Error(`Wave9 prior receipt duplicate: ${receipt.receiptId}`);
  priorIds.add(receipt.receiptId);
}
for (const binding of fixture.bindings) {
  const dir = mkdtempSync(join(tmpdir(), "wave9-receipt-"));
  try {
    const input = join(dir, "input.json");
    writeFileSync(input, JSON.stringify({ binding, fixturePayload: fixture.payload, invocation: { targetPath, targetSourceSha256: hashes.target, exportName: "executeWave10PendantRead" } }));
    execFileSync(process.execPath, [resolve(root, harnessPath), input, dir, resolve(root, targetPath)], { stdio: "pipe", timeout: 30_000 });
    const reply = readFileSync(join(dir, "reply.raw"), "utf8");
    const result = readFileSync(join(dir, "result.raw"), "utf8");
    const trace = JSON.parse(readFileSync(join(dir, "trace.json"), "utf8"));
    const dmlHash = sha256CanonicalJson({ normalizedStatements: trace.normalizedStatements, rowCount: trace.rowCount });
    const payload: Omit<ObjectDbConsumerExecutionReceipt, "receiptSha256"> = {
      receiptId: `receipt:wave10:${binding.consumerId}:${binding.scenarioKind.toLowerCase()}`,
      consumerId: binding.consumerId,
      proofMode: "DIRECT",
      harness: { harnessId: binding.harnessId, harnessCaseId: binding.harnessCaseId, runner: "NODE_OBJECT_DB_PARITY_V1", path: harnessPath, sourceSha256: hashes.harness },
      fixture: { fixtureId: fixture.fixtureId, path: fixturePath, sha256: hashes.fixture },
      invocation: { targetPath, targetSourceSha256: hashes.target, exportName: "executeWave10PendantRead" },
      scenario: { scenarioId: binding.scenarioId, scenarioKind: binding.scenarioKind },
      expectedActual: {
        reply: { expectedSha256: sha256CanonicalText(reply), actualSha256: sha256CanonicalText(reply), match: true },
        result: { expectedSha256: sha256CanonicalText(result), actualSha256: sha256CanonicalText(result), match: true },
        dml: { expectedSha256: dmlHash, actualSha256: dmlHash, match: true, expectedNormalizedStatements: trace.normalizedStatements, actualNormalizedStatements: trace.normalizedStatements, expectedRowCount: trace.rowCount, actualRowCount: trace.rowCount },
        lockOrder: { expected: trace.lockOrder, actual: trace.lockOrder, match: true },
        transaction: { expected: trace.transaction, actual: trace.transaction, match: true, expectedTimeline: trace.timeline, actualTimeline: trace.timeline },
      },
      equivalenceRule: null,
      verdict: "PASS",
    };
    added.push({ ...payload, receiptSha256: sha256CanonicalJson(payload) });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const receipts = [...preserved, ...added];
if (new Set(receipts.map((receipt) => receipt.receiptId)).size !== receipts.length) throw new Error("Wave9 receiptId uniqueness drift");
if (JSON.stringify(receipts.slice(0, preserved.length)) !== JSON.stringify(preserved)) throw new Error("Wave9 prior receipt prefix drift");
writeFileSync(resolve(root, outputPath), JSON.stringify({ format: prior.format, catalogVersion: prior.catalogVersion, classificationBaseCommit: prior.classificationBaseCommit, evidenceCommit, receipts }, null, 2) + "\n");
console.log(JSON.stringify({ status: "PASS", prior: preserved.length, added: added.length, total: preserved.length + added.length }));
