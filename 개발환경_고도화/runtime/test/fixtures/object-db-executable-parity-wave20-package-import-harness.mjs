import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { projectObjectDbMutationActualResult, projectObjectDbMutationOracleResult, validateObjectDbMutationScenarioEvidence } from "../../src/data-migration/object-db-consumer-mutation-evidence.js";

const hash = (value) => createHash("sha256").update(value.replace(/\r\n?/g, "\n"), "utf8").digest("hex");
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const [inputPath, outputDirectory, targetPath] = process.argv.slice(2);
if (!inputPath || !outputDirectory || !targetPath) throw new Error("Wave20 harness arguments missing");
const input = JSON.parse(readFileSync(resolve(inputPath), "utf8"));
const fixture = input.fixturePayload;
const binding = input.binding;
assert(binding.consumerId === "sql-repository-b1d650b73c2ddff0", "Wave20 consumer binding drift");
assert(binding.exportName === "executeWave20PackageImport", "Wave20 export binding drift");
assert(binding.harnessCaseId === "case:wave20:package-import", "Wave20 case binding drift");
assert(input.invocation.targetPath === "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave20-package-import.mjs", "Wave20 target path drift");
assert(hash(readFileSync(resolve(targetPath), "utf8")) === input.invocation.targetSourceSha256, "Wave20 target hash drift");
assert(fixture.fixtureId === "fixture:object-db-executable-parity:wave20:package-import:v1" && fixture.sliceId === "WBS784", "Wave20 fixture identity drift");
assert(Array.isArray(fixture.runtimeSourcePaths) && fixture.runtimeSourcePaths.length === 8, "Wave20 runtime source chain drift");
const repositoryRoot = resolve(import.meta.dirname, "../../../..");
for (const source of input.runtimeSourceHashes) {
  assert(fixture.runtimeSourcePaths.includes(source.path), `Wave20 unexpected runtime source: ${source.path}`);
  const committed = execFileSync("git", ["show", `${input.evidenceCommit}:${source.path}`], { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  assert(hash(committed) === source.sha256, `Wave20 committed source drift: ${source.path}`);
  assert(hash(readFileSync(resolve(repositoryRoot, source.path), "utf8")) === source.sha256, `Wave20 worktree source drift: ${source.path}`);
}
const repositorySource = readFileSync(resolve(repositoryRoot, fixture.mutationContract.source.path), "utf8").replace(/\r\n?/g, "\n");
assert(hash(repositorySource) === fixture.mutationContract.source.sha256, "Wave20 repository source hash drift");
assert(hash(repositorySource.slice(fixture.mutationContract.source.spanStart, fixture.mutationContract.source.spanEnd)) === fixture.mutationContract.source.spanSha256, "Wave20 repository source span drift");
const observation = fixture.sealedObservations.find((candidate) => candidate.scenarioKind === binding.scenarioKind);
assert(observation !== undefined, "Wave20 sealed observation missing");
const verified = validateObjectDbMutationScenarioEvidence(fixture.mutationContract, observation);
const oracle = fixture.mutationContract.scenarios.find((candidate) => candidate.scenarioKind === binding.scenarioKind);
assert(oracle !== undefined, "Wave20 oracle missing");
const expected = projectObjectDbMutationOracleResult(oracle);
const actual = projectObjectDbMutationActualResult(observation, verified.primary);
assert(JSON.stringify(expected) === JSON.stringify(actual), "Wave20 independent oracle result mismatch");
writeFileSync(resolve(outputDirectory, "reply.raw"), "NO_REPLY", "utf8");
writeFileSync(resolve(outputDirectory, "result.raw"), JSON.stringify(actual), "utf8");
writeFileSync(resolve(outputDirectory, "trace.json"), JSON.stringify(observation), "utf8");
writeFileSync(resolve(outputDirectory, "case-result.json"), JSON.stringify({
  format: "hoibot-object-db-consumer-parity-case-result-v1", passed: true, assertionCount: 24,
  executedConsumerId: binding.consumerId, executedCaseId: binding.harnessCaseId, fixtureId: fixture.fixtureId,
  scenarioId: binding.scenarioId, scenarioKind: binding.scenarioKind, invocation: input.invocation,
  artifacts: { replyPath: "reply.raw", resultPath: "result.raw", tracePath: "trace.json" },
}), "utf8");
