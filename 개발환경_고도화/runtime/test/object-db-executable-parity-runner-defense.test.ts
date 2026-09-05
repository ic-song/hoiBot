import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

import { assertTrustedWave1ConsumerFixtureMapping } from "../src/data-migration/object-db-consumer-executable-parity-ledger.js";

const runtimeRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(runtimeRoot, "../..");
const harnessPath = resolve(runtimeRoot, "test/fixtures/object-db-executable-parity-harness.mjs");
const fixturePath = resolve(repoRoot, "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-executable-parity-wave1-title-list-owned-v1.json");
const manifest = JSON.parse(readFileSync(resolve(repoRoot, "개발환경_고도화/migration-control/contracts/object-db-consumer-manifest.v1.json"), "utf8"));
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const memberId = "sql-repository-0dc3c380c54081a2";
const memberManifest = manifest.consumers.find((consumer: { consumerId: string }) => consumer.consumerId === memberId);
const memberConsumer = fixture.payload.cases[0].consumers.find((consumer: { consumerId: string }) => consumer.consumerId === memberId);

function sha256Text(path: string): string {
  return createHash("sha256").update(readFileSync(path, "utf8").replace(/\r\n?/g, "\n")).digest("hex");
}

function invokeHarness(targetName: string, exportName: string, scenarioKind: string): { outputDirectory: string; error: unknown } {
  const outputDirectory = mkdtempSync(join(tmpdir(), "hoibot-runner-defense-"));
  const targetPath = resolve(runtimeRoot, `test/fixtures/${targetName}`);
  const binding = { consumerId: memberId, harnessId: "defense", harnessCaseId: "case:canonical-title-list-owned", fixtureId: fixture.fixtureId, scenarioId: `defense:${scenarioKind}`, scenarioKind };
  const inputPath = join(outputDirectory, "input.json");
  writeFileSync(inputPath, JSON.stringify({ binding, fixturePayload: fixture.payload, invocation: { targetPath: `개발환경_고도화/runtime/test/fixtures/${targetName}`, targetSourceSha256: sha256Text(targetPath), exportName } }));
  let error: unknown = null;
  try { execFileSync(process.execPath, [harnessPath, inputPath, outputDirectory, targetPath], { stdio: "pipe" }); }
  catch (caught) { error = caught; }
  return { outputDirectory, error };
}

describe("object DB executable parity trusted runner defenses", () => {
  it("binds the trusted target to exact manifest/domain/table/ID configuration", () => {
    assert.doesNotThrow(() => assertTrustedWave1ConsumerFixtureMapping(memberId, memberConsumer, memberManifest));
    const domainSwap = structuredClone(memberConsumer);
    domainSwap.trustedConfig.domain = "pet"; domainSwap.input.domain = "pet"; domainSwap.negativeInput.domain = "pet";
    assert.throws(() => assertTrustedWave1ConsumerFixtureMapping(memberId, domainSwap, memberManifest), /trusted/);
    const symbolSwap = structuredClone(memberConsumer);
    symbolSwap.sourceLocator.symbol = "pet.listOwned";
    assert.throws(() => assertTrustedWave1ConsumerFixtureMapping(memberId, symbolSwap, memberManifest), /manifest/);
    const interfaceSwap = structuredClone(memberConsumer);
    interfaceSwap.sourceLocator.interfaceId = "pet-title.repository.maria-canonical-title-repository.pet.listOwned";
    assert.throws(() => assertTrustedWave1ConsumerFixtureMapping(memberId, interfaceSwap, memberManifest), /manifest/);
    const selectionSwap = structuredClone(memberConsumer);
    selectionSwap.trustedConfig.selectionTable = "canonical_pet_title_selections";
    selectionSwap.assertions[2] = "canonical_pet_title_selections";
    selectionSwap.expectedNormalizedSql = selectionSwap.expectedNormalizedSql.replaceAll("canonical_member_title_selections", "canonical_pet_title_selections");
    assert.throws(() => assertTrustedWave1ConsumerFixtureMapping(memberId, selectionSwap, memberManifest), /trusted|SQL/);
  });

  it("derives DML from query-channel SQL instead of accepting declared DML0", () => {
    const run = invokeHarness("object-db-executable-parity-query-delete-target.mjs", "executeQueryDelete", "SOURCE_DOMAIN_DML_ZERO");
    try {
      assert.equal(run.error, null);
      const trace = JSON.parse(readFileSync(join(run.outputDirectory, "trace.json"), "utf8"));
      assert.deepEqual(trace.normalizedStatements, ["DELETE FROM canonical_owned_member_title_instances WHERE player_id=?"]);
      assert.equal(trace.rowCount, 1);
      assert.equal(trace.transaction, "COMMIT");
    } finally { rmSync(run.outputDirectory, { recursive: true, force: true }); }
  });

  it("rejects a target-declared trace and a fake restart module identity", () => {
    for (const [target, exportName, scenario, pattern] of [
      ["object-db-executable-parity-self-trace-target.mjs", "executeSelfTrace", "READ_POSITIVE", /target-declared trace is forbidden/],
      ["object-db-executable-parity-fake-restart-target.mjs", "executeFakeRestart", "RESTART_CONSISTENCY", /restart reused module execution/],
    ] as const) {
      const run = invokeHarness(target, exportName, scenario);
      try {
        assert.ok(run.error);
        const stderr = (run.error as { stderr?: Buffer }).stderr?.toString("utf8") ?? String(run.error);
        assert.match(stderr, pattern);
      } finally { rmSync(run.outputDirectory, { recursive: true, force: true }); }
    }
  });
});
