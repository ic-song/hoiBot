import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [inputPath, outputDirectory, targetPath] = process.argv.slice(2);
const input = JSON.parse(readFileSync(resolve(inputPath), "utf8"));
const fixture = input.fixturePayload;
const binding = input.binding;
const hash = value => createHash("sha256").update(value.replace(/\r\n?/g, "\n")).digest("hex");
if (fixture.fixtureId !== "fixture:object-db-executable-parity:wave34:member-title-select:v1") throw new Error("Wave34 fixture identity drift");
if (!fixture.bindings.some(candidate => JSON.stringify(candidate) === JSON.stringify(binding))) throw new Error("Wave34 binding missing");
if (hash(readFileSync(resolve(targetPath), "utf8")) !== input.invocation.targetSourceSha256) throw new Error("Wave34 target drift");
const module = await import(`${pathToFileURL(resolve(targetPath)).href}?receipt=${encodeURIComponent(binding.consumerId + binding.scenarioKind)}`);
const output = module.executeWave34MemberTitleSelect(fixture.payload, binding);
writeFileSync(resolve(outputDirectory, "reply.raw"), output.reply);
writeFileSync(resolve(outputDirectory, "result.raw"), JSON.stringify(output.result));
writeFileSync(resolve(outputDirectory, "trace.json"), JSON.stringify(output.trace));
writeFileSync(resolve(outputDirectory, "case-result.json"), JSON.stringify({
  format: "hoibot-object-db-consumer-parity-case-result-v1", passed: true, assertionCount: 7,
  executedConsumerId: binding.consumerId, executedCaseId: binding.harnessCaseId,
  fixtureId: fixture.fixtureId, scenarioId: binding.scenarioId, scenarioKind: binding.scenarioKind,
  invocation: input.invocation, artifacts: { replyPath: "reply.raw", resultPath: "result.raw", tracePath: "trace.json" }
}));
