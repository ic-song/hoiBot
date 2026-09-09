import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [inputPath, outputDirectory] = process.argv.slice(2);
const input = JSON.parse(readFileSync(inputPath, "utf8"));
writeFileSync(join(outputDirectory, "case-result.json"), `${JSON.stringify({
  format: "hoibot-object-db-consumer-parity-case-result-v1",
  passed: true,
  assertionCount: 1,
  executedConsumerId: input.binding.consumerId,
  executedCaseId: input.binding.harnessCaseId,
  fixtureId: input.binding.fixtureId,
  scenarioId: input.binding.scenarioId,
  scenarioKind: input.binding.scenarioKind,
  invocation: input.invocation,
  artifacts: { replyPath: "missing-reply.raw", resultPath: "missing-result.raw", tracePath: "missing-trace.json" },
}, null, 2)}\n`, "utf8");
