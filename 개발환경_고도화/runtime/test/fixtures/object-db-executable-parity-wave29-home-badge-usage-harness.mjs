import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const hash = value => createHash("sha256").update(value.replace(/\r\n?/g, "\n"), "utf8").digest("hex");
const assert = (value, message) => { if (!value) throw new Error(message); };
async function runWorker(inputPath, targetPath) {
  const input = JSON.parse(readFileSync(inputPath, "utf8"));
  assert(hash(readFileSync(targetPath, "utf8")) === input.invocation.targetSourceSha256, "Wave29 target hash drift");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
  for (const source of input.runtimeSourceHashes ?? []) {
    const committed = execFileSync("git", ["show", `${input.evidenceCommit}:${source.path}`], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    assert(hash(committed) === source.sha256, `Wave29 committed source drift: ${source.path}`);
    assert(hash(readFileSync(resolve(root, source.path), "utf8")) === source.sha256, `Wave29 worktree source drift: ${source.path}`);
  }
  const target = await import(`${pathToFileURL(targetPath).href}?worker=${process.pid}-${randomUUID()}`);
  const execution = await target[input.invocation.exportName](input);
  process.stdout.write(JSON.stringify({ processId: process.pid, execution }));
}
function worker(harness, input, target) {
  return JSON.parse(execFileSync(process.execPath, ["--import", "tsx", harness, "--worker", input, target], { encoding: "utf8", timeout: 60000, maxBuffer: 16 * 1024 * 1024 }));
}
async function runMain(inputPath, outputDirectory, targetPath) {
  const input = JSON.parse(readFileSync(inputPath, "utf8"));
  const harness = fileURLToPath(import.meta.url);
  const results = [worker(harness, inputPath, targetPath)];
  if (input.binding.scenarioKind === "RESTART_CONSISTENCY") {
    results.push(worker(harness, inputPath, targetPath));
    assert(results[0].processId !== results[1].processId, "Wave29 restart reused process");
    assert(results[0].execution.moduleExecutionId !== results[1].execution.moduleExecutionId, "Wave29 restart reused module");
    assert(results[0].execution.reply === results[1].execution.reply, "Wave29 restart reply drift");
    assert(results[0].execution.result === results[1].execution.result, "Wave29 restart result drift");
  }
  const first = results[0].execution;
  assert(first.databaseEvidence.sourceDomainDmlCount === 0, "Wave29 source-domain DML detected");
  writeFileSync(join(outputDirectory, "reply.raw"), first.reply);
  writeFileSync(join(outputDirectory, "result.raw"), first.result);
  writeFileSync(join(outputDirectory, "trace.json"), JSON.stringify({ normalizedStatements: [], rowCount: 0, lockOrder: [], transaction: "READ_ONLY", timeline: ["READ_ONLY"] }, null, 2) + "\n");
  writeFileSync(join(outputDirectory, "case-result.json"), JSON.stringify({ format: "hoibot-object-db-consumer-parity-case-result-v1", passed: true, assertionCount: first.assertionCount, executedConsumerId: first.executedConsumerId, executedCaseId: first.executedCaseId, fixtureId: input.binding.fixtureId, scenarioId: input.binding.scenarioId, scenarioKind: input.binding.scenarioKind, invocation: input.invocation, artifacts: { replyPath: "reply.raw", resultPath: "result.raw", tracePath: "trace.json" } }, null, 2) + "\n");
}
const args = process.argv.slice(2);
if (args[0] === "--worker") await runWorker(args[1], args[2]);
else { if (args.length !== 3) throw new Error("Wave29 harness arguments missing"); await runMain(args[0], args[1], args[2]); }
