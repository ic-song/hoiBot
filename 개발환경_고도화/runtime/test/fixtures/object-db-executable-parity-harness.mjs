import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [inputPath, outputDirectory, targetPath] = process.argv.slice(2);
if (!inputPath || !outputDirectory || !targetPath) throw new Error("missing harness arguments");
const input = JSON.parse(readFileSync(inputPath, "utf8"));
const normalizedTarget = readFileSync(targetPath, "utf8").replace(/\r\n?/g, "\n");
const targetSourceSha256 = createHash("sha256").update(normalizedTarget).digest("hex");
if (targetSourceSha256 !== input.invocation.targetSourceSha256) throw new Error("target source hash mismatch");
const target = await import(pathToFileURL(targetPath).href);
const invoke = target[input.invocation.exportName];
if (typeof invoke !== "function") throw new Error("target export is not callable");
const execution = await invoke({
  consumerId: input.binding.consumerId,
  harnessCaseId: input.binding.harnessCaseId,
  fixtureId: input.binding.fixtureId,
  scenarioId: input.binding.scenarioId,
  scenarioKind: input.binding.scenarioKind,
  fixturePayload: input.fixturePayload,
});
let assertionCount = 0;
function assert(condition, message) {
  assertionCount += 1;
  if (!condition) throw new Error(message);
}
assert(execution && typeof execution === "object", "execution result missing");
assert(execution.executedConsumerId === input.binding.consumerId, "executed consumer mismatch");
assert(execution.executedCaseId === input.binding.harnessCaseId, "executed case mismatch");
assert(typeof execution.reply === "string", "raw reply missing");
assert(typeof execution.result === "string", "raw result missing");
assert(execution.trace && typeof execution.trace === "object", "raw trace missing");
assert(Array.isArray(execution.trace.normalizedStatements), "DML trace missing");
assert(Number.isSafeInteger(execution.trace.rowCount) && execution.trace.rowCount >= 0, "row count missing");
assert(Array.isArray(execution.trace.lockOrder), "lock trace missing");
assert(Array.isArray(execution.trace.timeline), "transaction timeline missing");
writeFileSync(join(outputDirectory, "reply.raw"), Buffer.from(execution.reply, "utf8"));
writeFileSync(join(outputDirectory, "result.raw"), Buffer.from(execution.result, "utf8"));
writeFileSync(join(outputDirectory, "trace.json"), `${JSON.stringify(execution.trace, null, 2)}\n`, "utf8");
writeFileSync(join(outputDirectory, "case-result.json"), `${JSON.stringify({
  format: "hoibot-object-db-consumer-parity-case-result-v1",
  passed: true,
  assertionCount,
  executedConsumerId: execution.executedConsumerId,
  executedCaseId: execution.executedCaseId,
  fixtureId: input.binding.fixtureId,
  scenarioId: input.binding.scenarioId,
  scenarioKind: input.binding.scenarioKind,
  invocation: {
    targetPath: input.invocation.targetPath,
    targetSourceSha256,
    exportName: input.invocation.exportName,
  },
  artifacts: { replyPath: "reply.raw", resultPath: "result.raw", tracePath: "trace.json" },
}, null, 2)}\n`, "utf8");
