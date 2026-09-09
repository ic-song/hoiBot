import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { projectObjectDbMutationActualResult, projectObjectDbMutationOracleResult, validateObjectDbMutationScenarioEvidence } from "../../src/data-migration/object-db-consumer-mutation-evidence.js";

const hash = (value) => createHash("sha256").update(value.replace(/\r\n?/g, "\n"), "utf8").digest("hex");
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const [inputPath, outputDirectory, targetPath] = process.argv.slice(2);
if (!inputPath || !outputDirectory || !targetPath) throw new Error("Wave23 harness arguments missing");
const input = JSON.parse(readFileSync(resolve(inputPath), "utf8")), fixture = input.fixturePayload, binding = input.binding;
const caseFixture = fixture.cases.find((candidate) => candidate.consumerId === binding.consumerId);
assert(caseFixture !== undefined, "Wave23 consumer case missing");
assert(binding.exportName === "executeWave23Mutation" && binding.harnessCaseId === `case:wave23:${binding.consumerId}`, "Wave23 binding drift");
assert(input.invocation.targetPath === "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave23-target.mjs", "Wave23 target path drift");
assert(hash(readFileSync(resolve(targetPath), "utf8")) === input.invocation.targetSourceSha256, "Wave23 target hash drift");
assert(fixture.fixtureId === "fixture:object-db-executable-parity:wave23:mutations:v1" && fixture.sliceId === "WBS791", "Wave23 fixture identity drift");
assert(fixture.consumerIds.length === 3 && fixture.cases.length === 3, "Wave23 consumer cardinality drift");
const repositoryRoot = resolve(import.meta.dirname, "../../../..");
for (const source of input.runtimeSourceHashes) {
  assert(caseFixture.runtimeSourcePaths.includes(source.path), `Wave23 unexpected runtime source: ${source.path}`);
  const committed = execFileSync("git", ["show", `${input.evidenceCommit}:${source.path}`], { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  assert(hash(committed) === source.sha256, `Wave23 committed source drift: ${source.path}`);
  assert(hash(readFileSync(resolve(repositoryRoot, source.path), "utf8")) === source.sha256, `Wave23 worktree source drift: ${source.path}`);
}
const sourceText = readFileSync(resolve(repositoryRoot, caseFixture.mutationContract.source.path), "utf8").replace(/\r\n?/g, "\n");
assert(hash(sourceText) === caseFixture.mutationContract.source.sha256, "Wave23 repository source hash drift");
assert(hash(sourceText.slice(caseFixture.mutationContract.source.spanStart, caseFixture.mutationContract.source.spanEnd)) === caseFixture.mutationContract.source.spanSha256, "Wave23 repository source span drift");
const observation = caseFixture.sealedObservations.find((candidate) => candidate.scenarioKind === binding.scenarioKind);
const oracle = caseFixture.mutationContract.scenarios.find((candidate) => candidate.scenarioKind === binding.scenarioKind);
assert(observation && oracle, "Wave23 scenario evidence missing");
const verified = validateObjectDbMutationScenarioEvidence(caseFixture.mutationContract, observation);
const expected = projectObjectDbMutationOracleResult(oracle), actual = projectObjectDbMutationActualResult(observation, verified.primary);
assert(JSON.stringify(expected) === JSON.stringify(actual), "Wave23 independent oracle mismatch");
writeFileSync(resolve(outputDirectory, "reply.raw"), "NO_REPLY", "utf8");
writeFileSync(resolve(outputDirectory, "result.raw"), JSON.stringify(actual), "utf8");
writeFileSync(resolve(outputDirectory, "trace.json"), JSON.stringify(observation), "utf8");
writeFileSync(resolve(outputDirectory, "case-result.json"), JSON.stringify({ format:"hoibot-object-db-consumer-parity-case-result-v1", passed:true, assertionCount:30, executedConsumerId:binding.consumerId, executedCaseId:binding.harnessCaseId, fixtureId:fixture.fixtureId, scenarioId:binding.scenarioId, scenarioKind:binding.scenarioKind, invocation:input.invocation, artifacts:{replyPath:"reply.raw",resultPath:"result.raw",tracePath:"trace.json"} }), "utf8");
