import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const runtimeRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(runtimeRoot, "../..");
const fixturePath = resolve(repoRoot, "개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-wave32-member-title-legacy-info-v1.json");
const priorPath = resolve(repoRoot, "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave31-v1.json");
const forbiddenOutput = resolve(repoRoot, "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave32-v1.json");
const sha = (value: string): string => createHash("sha256").update(value.replace(/\r\n?/gu, "\n"), "utf8").digest("hex");

test("Wave32 executes the committed legacy and modern paths and freezes the castle-siege P1 without receipts", () => {
  const evidenceCommit = process.env.WAVE32_EVIDENCE_COMMIT;
  assert.match(evidenceCommit ?? "", /^[0-9a-f]{40}$/u, "WAVE32_EVIDENCE_COMMIT is required");
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  assert.equal(fixture.consumerIds[0], "legacy-798257cac0e93e27");
  assert.deepEqual(fixture.bindings.map((binding: { scenarioKind: string }) => binding.scenarioKind).sort(),
    ["READ_POSITIVE", "NEGATIVE_GUARD", "EXACT_OUTPUT", "SOURCE_DOMAIN_DML_ZERO", "RESTART_CONSISTENCY"].sort());

  const directory = mkdtempSync(join(tmpdir(), "wave32-blocker-test-"));
  const observationPath = join(directory, "observation.json");
  try {
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/generate-object-db-consumer-executable-parity-wave32-member-title-legacy-info.ts", evidenceCommit!], {
      cwd: runtimeRoot, encoding: "utf8", timeout: 120_000,
      env: { ...process.env, WAVE32_GAP_OBSERVATION_PATH: observationPath },
    });
    assert.notEqual(result.status, 0, "Wave32 must remain blocked until the modern siege guard exists");
    assert.match(result.stderr, /P1_CASTLE_SIEGE_PARITY_GAP/u);
    const observation = JSON.parse(readFileSync(observationPath, "utf8"));
    assert.equal(observation.priorReceiptCount, 382);
    assert.equal(observation.expectedNewReceiptCount, 5);
    assert.equal(observation.generatedPassCandidateCount, 4);
    assert.equal(observation.blocked, true);
    assert.equal(observation.observations.length, 5);
    const siege = observation.observations.find((value: { scenarioKind: string }) => value.scenarioKind === "NEGATIVE_GUARD");
    assert.equal(siege.legacyReply, "NO_REPLY");
    assert.equal(siege.modernReply, "[⭐조회회원] 님의 타이틀 [두 번째] 상세정보\n획득일:2026-08-27 23:10\n구매액: 🅟15,000\n판매가: 🅟4,500");
    assert.equal(siege.parityMatch, false);
    assert.equal(siege.route, "MODERN");
    assert.equal(siege.handlerKey, "player_title_info_read");
    assert.equal(siege.serviceInvocationCount, 1);
    for (const value of observation.observations) {
      assert.equal(value.transaction, "COMMIT");
      assert.equal(value.sourceDomainDmlCount, 0);
    }
    for (const value of observation.observations.filter((item: { scenarioKind: string }) => item.scenarioKind !== "NEGATIVE_GUARD")) assert.equal(value.parityMatch, true);
    const restart = observation.observations.find((value: { scenarioKind: string }) => value.scenarioKind === "RESTART_CONSISTENCY");
    assert.equal(new Set(restart.restartProcessIds).size, 2);
    assert.equal(new Set(restart.restartModuleIds).size, 2);
    assert.equal(existsSync(forbiddenOutput), false, "blocked Wave32 must not write a cumulative receipt bundle");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("Wave32 preserves the exact Wave31 receipt prefix and records the missing guard ownership", () => {
  const prior = JSON.parse(readFileSync(priorPath, "utf8"));
  const prefix = JSON.stringify(prior.receipts);
  assert.equal(prior.receipts.length, 382);
  assert.equal(Buffer.byteLength(prefix), 1_588_071);
  assert.equal(sha(prefix), "df05843c2df41428086464814adab831961f78d784100b5e9eda962cc106b506");
  const main = readFileSync(resolve(repoRoot, "main.js"), "utf8");
  const service = readFileSync(resolve(runtimeRoot, "src/player/player-title-read-service.ts"), "utf8");
  const branchStart = main.indexOf('if (msg.startsWith("/타이틀정보"))');
  const branchEnd = main.indexOf('if (msg.startsWith("/타이틀판매"))', branchStart);
  assert.ok(branchStart >= 0 && branchEnd > branchStart);
  assert.match(main.slice(branchStart, branchEnd), /if \(castleSiegeFlag\) return;/u);
  const readStart = service.indexOf("async read(");
  assert.ok(readStart >= 0);
  assert.doesNotMatch(service.slice(readStart), /guild_territory_wars|castle_battle_seasons|blocked_by_castle_siege/u);
});
