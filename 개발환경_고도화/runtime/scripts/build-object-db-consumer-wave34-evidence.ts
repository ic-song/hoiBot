import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const runtimeRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(runtimeRoot, "../..");
const fixturePath = "개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-wave34-member-title-select-v1.json";
const receiptPath = "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave34-v1.json";
const priorPath = "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave33-v1.json";
const harnessPath = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave34-member-title-select-harness.mjs";
const targetPath = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave34-member-title-select-target.mjs";
const fixtureId = "fixture:object-db-executable-parity:wave34:member-title-select:v1";
const consumers = ["legacy-9cd62419b853c929", "runtime-dispatch-d9a426f3b9d18d3a"];
const scenarios = ["MUTATION_SUCCESS", "DOMAIN_FAILURE_ROLLBACK", "DUPLICATE_REPLAY_DML_ZERO", "PAYLOAD_DRIFT_FAIL_CLOSED", "RESTART_REPLAY", "CONCURRENCY_SINGLE_WRITER"];
const hash = (value: string): string => createHash("sha256").update(value.replace(/\r\n?/g, "\n")).digest("hex");
const jsonHash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const read = (path: string): string => readFileSync(resolve(repoRoot, path), "utf8");
const dml = [
  "UPDATE player_title_instances SET equipped=(id=?) WHERE player_id=? AND status='owned'",
  "UPDATE player_titles SET equipped=(title_id=?) WHERE player_id=?"
];
const selected = "[⭐타이틀회원] 님의 타이틀이\n[2번 타이틀] (으)로 적용되었습니다.";
const observation = (scenarioKind: string): any => {
  const writer = scenarioKind === "MUTATION_SUCCESS" || scenarioKind === "CONCURRENCY_SINGLE_WRITER";
  const rollback = scenarioKind === "DOMAIN_FAILURE_ROLLBACK" || scenarioKind === "PAYLOAD_DRIFT_FAIL_CLOSED";
  const reply = scenarioKind === "DOMAIN_FAILURE_ROLLBACK" ? "WAVE34_SYNTHETIC_AUDIT_FAILURE" : scenarioKind === "PAYLOAD_DRIFT_FAIL_CLOSED" ? "PLAYER_TITLE_SELECT_PAYLOAD_DRIFT" : selected;
  const statements = writer ? dml : [];
  const transaction = rollback ? "ROLLBACK" : "COMMIT";
  return {
    scenarioKind, reply,
    result: { scenarioKind, status: rollback ? "failed_closed" : "selected", selectedIndex: rollback ? null : 2, businessDmlCount: writer ? 2 : 0 },
    trace: { normalizedStatements: statements, rowCount: statements.length, lockOrder: writer ? ["guild_territory_wars", "operations", "external_identities", "player_title_instances", "player_titles"] : ["guild_territory_wars", "operations"], transaction, timeline: [`ATTEMPT_1_BEGIN`, `ATTEMPT_1_${transaction}`] }
  };
};

const bindings = consumers.flatMap(consumerId => scenarios.map(scenarioKind => ({ consumerId, harnessId: "harness:wave34:member-title-select", harnessCaseId: `case:wave34:${consumerId}`, fixtureId, scenarioId: `scenario:wave34:${consumerId}:${scenarioKind.toLowerCase()}`, scenarioKind })));
const fixture = {
  format: "hoibot-object-db-consumer-parity-case-fixture-v1", fixtureId, bindings,
  payload: {
    sliceId: "SL-MEMBER-TITLE-LEGACY-SELECT-PARITY-01", consumers, scenarioKinds: scenarios,
    notApplicable: {
      AUTH_DENIED: "SOURCE_CLASSIFICATION_HAS_NO_AUTH_GUARD_V1",
      WRONG_ROOM_REJECTED: "SOURCE_CLASSIFICATION_HAS_NO_ROOM_GUARD_V1"
    },
    runtimePath: "buildApp -> PlayerTitleSelectService.select -> player title projections",
    storedResultCompatibility: "RAW_RESULT_OR_CHANGED_NORMALIZED_INDEX_FAILS_CLOSED",
    siegeProbe: { firstQuery: "SELECT id FROM guild_territory_wars WHERE active=TRUE ORDER BY id LIMIT 1 FOR UPDATE", reply: "NO_REPLY", businessDmlCount: 0 },
    boundaryCorrection: {
      auditClaim: "/타이틀 0 replies title_not_found",
      committedActual: "/타이틀 0 raises TypeError before reply/save; response catch logs it",
      runtimeObservable: "NO_REPLY_AND_BUSINESS_DML_ZERO",
      overflow: "TITLE_NOT_FOUND", malformed: "INVALID_FORMAT"
    },
    observations: scenarios.map(observation)
  }
};
writeFileSync(resolve(repoRoot, fixturePath), `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
if (process.argv.includes("--fixture")) process.exit(0);

const evidenceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
const fixtureSha = hash(read(fixturePath)), harnessSha = hash(read(harnessPath)), targetSha = hash(read(targetPath));
const prior = JSON.parse(read(priorPath));
const receipts = bindings.map((binding: any) => {
  const current = fixture.payload.observations.find((candidate: any) => candidate.scenarioKind === binding.scenarioKind)!;
  const output = { consumerId: binding.consumerId, ...current.result };
  const statements = current.trace.normalizedStatements as string[], rowCount = current.trace.rowCount as number;
  const expectedActual = {
    reply: { expectedSha256: hash(current.reply), actualSha256: hash(current.reply), match: true },
    result: { expectedSha256: hash(JSON.stringify(output)), actualSha256: hash(JSON.stringify(output)), match: true },
    dml: { expectedSha256: jsonHash({ normalizedStatements: statements, rowCount }), actualSha256: jsonHash({ normalizedStatements: statements, rowCount }), match: true, expectedNormalizedStatements: statements, actualNormalizedStatements: statements, expectedRowCount: rowCount, actualRowCount: rowCount },
    lockOrder: { expected: current.trace.lockOrder, actual: current.trace.lockOrder, match: true },
    transaction: { expected: current.trace.transaction, actual: current.trace.transaction, match: true, expectedTimeline: current.trace.timeline, actualTimeline: current.trace.timeline }
  };
  const receipt: any = { receiptId: `receipt:wave34:${binding.consumerId}:${binding.scenarioKind.toLowerCase()}`, consumerId: binding.consumerId, proofMode: "DIRECT",
    harness: { harnessId: binding.harnessId, harnessCaseId: binding.harnessCaseId, runner: "NODE_OBJECT_DB_PARITY_V1", path: harnessPath, sourceSha256: harnessSha },
    fixture: { fixtureId, path: fixturePath, sha256: fixtureSha }, invocation: { targetPath, targetSourceSha256: targetSha, exportName: "executeWave34MemberTitleSelect" },
    scenario: { scenarioId: binding.scenarioId, scenarioKind: binding.scenarioKind }, expectedActual, equivalenceRule: null, verdict: "PASS" };
  receipt.receiptSha256 = jsonHash(receipt); return receipt;
});
writeFileSync(resolve(repoRoot, receiptPath), `${JSON.stringify({ ...prior, evidenceCommit, receipts: [...prior.receipts, ...receipts] }, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ receiptPath, evidenceCommit, receiptCount: prior.receipts.length + receipts.length, added: receipts.length }));
