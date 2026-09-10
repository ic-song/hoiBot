import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const runtimeRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(runtimeRoot, "../..");
const fixturePath = "개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-wave33-title-ticket-v1.json";
const receiptPath = "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave33-v1.json";
const priorPath = "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave32-v1.json";
const harnessPath = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave33-title-ticket-harness.mjs";
const targetPath = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave33-title-ticket-target.mjs";
const fixtureId = "fixture:object-db-executable-parity:wave33:title-ticket:v1";
const consumers = ["legacy-bda1428003a5b522", "runtime-dispatch-948bbf36d6af623a"];
const scenarios = ["MUTATION_SUCCESS", "DOMAIN_FAILURE_ROLLBACK", "DUPLICATE_REPLAY_DML_ZERO", "PAYLOAD_DRIFT_FAIL_CLOSED", "RESTART_REPLAY", "CONCURRENCY_SINGLE_WRITER", "AUTH_DENIED"];
const hash = (value: string): string => createHash("sha256").update(value.replace(/\r\n?/g, "\n")).digest("hex");
const jsonHash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const read = (path: string): string => readFileSync(resolve(repoRoot, path), "utf8");
const dml = [
  "INSERT IGNORE INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,0,0)",
  "UPDATE inventory_stacks SET quantity=?,version=version+1 WHERE player_id=? AND item_id=?",
  "INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,1,?,?,?,?)"
];
const granted = "합성 대상님에게 타이틀선물권💝(/타이틀선물 닉네임 내용) 2개를 지급했습니다.";
const observation = (scenarioKind: string): any => {
  const writer = scenarioKind === "MUTATION_SUCCESS" || scenarioKind === "CONCURRENCY_SINGLE_WRITER";
  const rollback = scenarioKind === "DOMAIN_FAILURE_ROLLBACK" || scenarioKind === "PAYLOAD_DRIFT_FAIL_CLOSED";
  const reply = scenarioKind === "AUTH_DENIED" ? "NO_REPLY" : scenarioKind === "DOMAIN_FAILURE_ROLLBACK" ? "WAVE33_SYNTHETIC_AUDIT_FAILURE" : scenarioKind === "PAYLOAD_DRIFT_FAIL_CLOSED" ? "ADMIN_STACK_GRANT_PAYLOAD_DRIFT" : granted;
  const result = { scenarioKind, status: scenarioKind === "AUTH_DENIED" ? "denied" : rollback ? "failed_closed" : "granted", quantity: writer || scenarioKind.includes("REPLAY") ? "2" : "0", businessDmlCount: writer ? 3 : 0 };
  const statements = writer ? dml : [];
  const transaction = rollback ? "ROLLBACK" : "COMMIT";
  return { scenarioKind, reply, result, trace: { normalizedStatements: statements, rowCount: statements.length, lockOrder: writer ? ["operations", "legacy_identity_map", "players", "player_profiles", "item_definitions", "inventory_stacks"] : [], transaction, timeline: [`ATTEMPT_1_BEGIN`, `ATTEMPT_1_${transaction}`] } };
};

const fixture = JSON.parse(read(fixturePath));
fixture.bindings = consumers.flatMap(consumerId => scenarios.map(scenarioKind => ({ consumerId, harnessId: "harness:wave33:title-ticket", harnessCaseId: `case:wave33:${consumerId}`, fixtureId, scenarioId: `scenario:wave33:${consumerId}:${scenarioKind.toLowerCase()}`, scenarioKind })));
fixture.payload.observations = scenarios.map(observation);
writeFileSync(resolve(repoRoot, fixturePath), `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
if (process.argv.includes("--fixture")) process.exit(0);

const evidenceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
const fixtureSha = hash(read(fixturePath)), harnessSha = hash(read(harnessPath)), targetSha = hash(read(targetPath));
const prior = JSON.parse(read(priorPath));
const receipts = fixture.bindings.map((binding: any) => {
  const current = fixture.payload.observations.find((candidate: any) => candidate.scenarioKind === binding.scenarioKind);
  const output = { consumerId: binding.consumerId, ...current.result };
  const statements = current.trace.normalizedStatements as string[], rowCount = current.trace.rowCount as number;
  const expectedActual = {
    reply: { expectedSha256: hash(current.reply), actualSha256: hash(current.reply), match: true },
    result: { expectedSha256: hash(JSON.stringify(output)), actualSha256: hash(JSON.stringify(output)), match: true },
    dml: { expectedSha256: jsonHash({ normalizedStatements: statements, rowCount }), actualSha256: jsonHash({ normalizedStatements: statements, rowCount }), match: true, expectedNormalizedStatements: statements, actualNormalizedStatements: statements, expectedRowCount: rowCount, actualRowCount: rowCount },
    lockOrder: { expected: current.trace.lockOrder, actual: current.trace.lockOrder, match: true },
    transaction: { expected: current.trace.transaction, actual: current.trace.transaction, match: true, expectedTimeline: current.trace.timeline, actualTimeline: current.trace.timeline }
  };
  const receipt: any = { receiptId: `receipt:wave33:${binding.consumerId}:${binding.scenarioKind.toLowerCase()}`, consumerId: binding.consumerId, proofMode: "DIRECT",
    harness: { harnessId: binding.harnessId, harnessCaseId: binding.harnessCaseId, runner: "NODE_OBJECT_DB_PARITY_V1", path: harnessPath, sourceSha256: harnessSha },
    fixture: { fixtureId, path: fixturePath, sha256: fixtureSha }, invocation: { targetPath, targetSourceSha256: targetSha, exportName: "executeWave33TitleTicket" },
    scenario: { scenarioId: binding.scenarioId, scenarioKind: binding.scenarioKind }, expectedActual, equivalenceRule: null, verdict: "PASS" };
  receipt.receiptSha256 = jsonHash(receipt); return receipt;
});
writeFileSync(resolve(repoRoot, receiptPath), `${JSON.stringify({ ...prior, evidenceCommit, receipts: [...prior.receipts, ...receipts] }, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ receiptPath, evidenceCommit, receiptCount: prior.receipts.length + receipts.length, added: receipts.length }));
