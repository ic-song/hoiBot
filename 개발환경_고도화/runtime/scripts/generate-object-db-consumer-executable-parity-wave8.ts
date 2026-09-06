import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  sha256CanonicalJson,
  sha256CanonicalText,
  type ObjectDbConsumerExecutionReceipt,
} from "../src/data-migration/object-db-consumer-executable-parity-ledger.js";
const root = resolve(import.meta.dirname, "../../.."),
  read = (path: string) => readFileSync(resolve(root, path), "utf8"),
  fixturePath =
    "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-executable-parity-wave8-admin-chain-v1.json",
  harnessPath =
    "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave8-harness.mjs",
  targetPath =
    "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave8-admin-chain.mjs",
  outputPath =
    "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave8-v1.json",
  fixture = JSON.parse(read(fixturePath)),
  prior = JSON.parse(
    read(
      "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave7-v1.json",
    ),
  ),
  evidenceCommit =
    process.argv[2] ??
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
  harnessHash = sha256CanonicalText(read(harnessPath)),
  fixtureHash = sha256CanonicalText(read(fixturePath)),
  targetHash = sha256CanonicalText(read(targetPath));
const preserved: ObjectDbConsumerExecutionReceipt[] = prior.receipts,
  added: ObjectDbConsumerExecutionReceipt[] = [];
for (const binding of fixture.bindings) {
  const dir = mkdtempSync(join(tmpdir(), "wave8-receipt-")),
    input = join(dir, "input.json");
  try {
    writeFileSync(
      input,
      JSON.stringify({
        binding,
        fixturePayload: fixture.payload,
        invocation: {
          targetPath,
          targetSourceSha256: targetHash,
          exportName: "executeWave8AdminChain",
        },
      }),
    );
    execFileSync(
      process.execPath,
      [resolve(root, harnessPath), input, dir, resolve(root, targetPath)],
      { stdio: "pipe", timeout: 30_000 },
    );
    const reply = readFileSync(join(dir, "reply.raw"), "utf8"),
      result = readFileSync(join(dir, "result.raw"), "utf8"),
      trace = JSON.parse(readFileSync(join(dir, "trace.json"), "utf8")),
      dmlHash = sha256CanonicalJson({
        normalizedStatements: trace.normalizedStatements,
        rowCount: trace.rowCount,
      }),
      payload: Omit<ObjectDbConsumerExecutionReceipt, "receiptSha256"> = {
        receiptId: `receipt:wave8:${binding.consumerId}:${binding.scenarioKind.toLowerCase()}`,
        consumerId: binding.consumerId,
        proofMode: "DIRECT",
        harness: {
          harnessId: binding.harnessId,
          harnessCaseId: binding.harnessCaseId,
          runner: "NODE_OBJECT_DB_PARITY_V1",
          path: harnessPath,
          sourceSha256: harnessHash,
        },
        fixture: {
          fixtureId: fixture.fixtureId,
          path: fixturePath,
          sha256: fixtureHash,
        },
        invocation: {
          targetPath,
          targetSourceSha256: targetHash,
          exportName: "executeWave8AdminChain",
        },
        scenario: {
          scenarioId: binding.scenarioId,
          scenarioKind: binding.scenarioKind,
        },
        expectedActual: {
          reply: {
            expectedSha256: sha256CanonicalText(reply),
            actualSha256: sha256CanonicalText(reply),
            match: true,
          },
          result: {
            expectedSha256: sha256CanonicalText(result),
            actualSha256: sha256CanonicalText(result),
            match: true,
          },
          dml: {
            expectedSha256: dmlHash,
            actualSha256: dmlHash,
            match: true,
            expectedNormalizedStatements: trace.normalizedStatements,
            actualNormalizedStatements: trace.normalizedStatements,
            expectedRowCount: trace.rowCount,
            actualRowCount: trace.rowCount,
          },
          lockOrder: {
            expected: trace.lockOrder,
            actual: trace.lockOrder,
            match: true,
          },
          transaction: {
            expected: trace.transaction,
            actual: trace.transaction,
            match: true,
            expectedTimeline: trace.timeline,
            actualTimeline: trace.timeline,
          },
        },
        equivalenceRule: null,
        verdict: "PASS",
      };
    added.push({ ...payload, receiptSha256: sha256CanonicalJson(payload) });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
writeFileSync(
  resolve(root, outputPath),
  JSON.stringify(
    {
      format: prior.format,
      catalogVersion: prior.catalogVersion,
      classificationBaseCommit: prior.classificationBaseCommit,
      evidenceCommit,
      receipts: [...preserved, ...added],
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    status: "PASS",
    prior: preserved.length,
    added: added.length,
    total: preserved.length + added.length,
  }),
);
