import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DML = /^(?:INSERT|UPDATE|DELETE|REPLACE|MERGE|TRUNCATE)\b/iu;
const SOURCE_TABLES = new Set([
  "players", "player_profiles", "player_legacy_rank_profiles", "player_title_read_delegates",
  "admin_operator_external_identities", "admin_operators", "admin_operator_roles", "admin_roles",
  "admin_role_permissions", "player_title_instances", "player_titles", "title_definitions",
]);
const TARGET = "object-db-executable-parity-wave30-player-title-read-target.mjs";
const CONSUMERS = new Set(["runtime-dispatch-e2445b135d4fb12c", "runtime-dispatch-e2dde461680d21ca"]);
const assert = (value, message) => { if (!value) throw new Error(message); };
const normalize = sql => String(sql).replace(/\s+/gu, " ").trim();
const hash = value => createHash("sha256").update(value.replace(/\r\n?/gu, "\n"), "utf8").digest("hex");
const safe = value => typeof value === "bigint" ? value.toString()
  : Array.isArray(value) ? value.map(safe)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, safe(child)]))
  : value;

function dmlTable(statement) {
  const match = statement.match(/^(?:INSERT(?:\s+IGNORE)?\s+INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM|MERGE\s+INTO|TRUNCATE(?:\s+TABLE)?)\s+([A-Za-z0-9_]+)/iu);
  if (DML.test(statement) && match === null) throw new Error(`Wave30 unparsed DML: ${statement}`);
  return match?.[1];
}

function createStatefulDatabase() {
  const calls = [], transactions = [], transactionAttempts = [];
  const operations = new Map(), outboxes = new Map();
  let nextId = 100n, lastRoute = null, lastHandlerKey = null;
  const titleRows = [
    { instance_id: 1n, title_id: 1n, display_name: "첫 번째", acquired_display: "2026-08-27 23:00", acquisition_price: "9999", equipped: 0, display_order: 1n },
    { instance_id: 2n, title_id: 2n, display_name: "두 번째", acquired_display: "2026-08-27 23:10", acquisition_price: "15000", equipped: 1, display_order: 2n },
  ];
  const record = (channel, sql, values, rowCount) => {
    const normalizedSql = normalize(sql);
    calls.push({ channel, normalizedSql, values: safe(values), rowCount });
    return normalizedSql;
  };
  const database = {
    async ping() {},
    async verifyRollback() { return true; },
    async close() {},
    async query(sql, values = []) {
      const n = normalize(sql);
      let rows;
      if (n === "SELECT DATABASE() AS database_identity") rows = [{ database_identity: "wave30_synthetic" }];
      else if (n.includes("FROM command_aliases a")) {
        const command = values[0];
        rows = command === "/타이틀목록"
          ? [{ command_code: "PLAYER_TITLE_LIST_READ", handler_key: "player_title_list_read", auth_scope: "VERIFIED_USER", rollout_state: "ACTIVE" }]
          : command === "/타이틀정보"
            ? [{ command_code: "PLAYER_TITLE_INFO_READ", handler_key: "player_title_info_read", auth_scope: "VERIFIED_USER", rollout_state: "ACTIVE" }]
            : [];
        lastHandlerKey = rows[0]?.handler_key ?? null;
      } else if (n.startsWith("SELECT id FROM channels")) rows = [{ id: 1n }];
      else if (n.startsWith("SELECT id FROM external_identities")) rows = [{ id: 10n }];
      else if (n.includes("FROM external_identities identity") && n.includes("JOIN players player")) {
        rows = [{ external_identity_id: 10n, player_id: 20n, display_name: "조회회원", rank_emoji: "⭐" }];
      } else if (n.includes("FROM player_title_read_delegates")) rows = [{ allowed: 1 }];
      else if (n.startsWith("SELECT id,result_json FROM operations")) {
        const operation = operations.get(`${values[0]}:${values[1]}`);
        rows = operation === undefined ? [] : [{ id: operation.id, result_json: operation.resultJson }];
      } else if (n.includes("BINARY profile.current_display_name")) {
        rows = values[0] === "대상회원" ? [{ player_id: 21n, display_name: "대상회원", rank_emoji: "🌙" }] : [];
      } else if (n.startsWith("SELECT instance_row.id instance_id") && n.includes("FROM player_title_instances instance_row")) {
        rows = values[0] === 21n ? titleRows.slice(0, 1) : titleRows;
      } else if (n.includes("FROM player_titles owned")) rows = [];
      else if (n.startsWith("SELECT attempt_count + 1 AS next_attempt FROM outbox_messages")) {
        const current = outboxes.get(String(values[0]));
        rows = [{ next_attempt: BigInt((current?.attemptCount ?? 0) + 1) }];
      } else throw new Error(`Wave30 unexpected SELECT: ${n}`);
      record("query", sql, values, rows.length);
      return rows;
    },
    async execute(sql, values = []) {
      const n = normalize(sql);
      let insertId = 0n, affectedRows = 1n;
      if (n.startsWith("INSERT INTO command_routing_decisions")) lastRoute = values[3] ?? null;
      else if (n.startsWith("INSERT INTO operations")) {
        insertId = nextId++;
        operations.set(`${values[1]}:${values[2]}`, { id: insertId, resultJson: null });
      } else if (n.startsWith("INSERT INTO outbox_messages")) {
        insertId = nextId++;
        outboxes.set(insertId.toString(), { attemptCount: 0 });
      } else if (n.startsWith("UPDATE operations SET status='completed'")) {
        const operation = [...operations.values()].find(candidate => candidate.id === values[1]);
        if (operation !== undefined) operation.resultJson = values[0];
      } else if (n.startsWith("UPDATE outbox_messages SET status")) {
        const outbox = outboxes.get(String(values[5]));
        if (outbox !== undefined) outbox.attemptCount = Number(values[1]);
      } else if (n.startsWith("INSERT INTO delivery_attempts")
        || n.startsWith("INSERT INTO command_executions") || n.startsWith("INSERT INTO command_audit")
        || n.startsWith("INSERT INTO channels") || n.startsWith("INSERT INTO external_identities")
        || n.startsWith("INSERT INTO channel_memberships") || n.startsWith("INSERT INTO event_inbox")
        || n.startsWith("INSERT INTO normalized_provider_events") || n.startsWith("INSERT INTO channel_activity_daily")
        || n.startsWith("UPDATE event_inbox SET processing_status")) {
        // 실제 앱이 요청한 인프라 쓰기를 기록하고 성공 결과를 돌려줍니다.
      } else throw new Error(`Wave30 unexpected mutation: ${n}`);
      record("execute", sql, values, Number(affectedRows));
      return { affectedRows, insertId };
    },
    async withTransaction(work) {
      const state = { operations: structuredClone(operations), outboxes: structuredClone(outboxes), nextId };
      const start = calls.length;
      transactions.push("BEGIN");
      try {
        const result = await work(database);
        transactions.push("COMMIT");
        const dml = calls.slice(start).filter(call => DML.test(call.normalizedSql));
        transactionAttempts.push({ attemptNumber: transactionAttempts.length + 1, outcome: "COMMIT", committed: true, dmlStatements: dml.map(call => call.normalizedSql), dmlRowCount: dml.reduce((sum, call) => sum + call.rowCount, 0) });
        return result;
      } catch (error) {
        operations.clear(); for (const [key, value] of state.operations) operations.set(key, value);
        outboxes.clear(); for (const [key, value] of state.outboxes) outboxes.set(key, value);
        nextId = state.nextId;
        transactions.push("ROLLBACK");
        const dml = calls.slice(start).filter(call => DML.test(call.normalizedSql));
        transactionAttempts.push({ attemptNumber: transactionAttempts.length + 1, outcome: "ROLLBACK", committed: false, dmlStatements: dml.map(call => call.normalizedSql), dmlRowCount: dml.reduce((sum, call) => sum + call.rowCount, 0) });
        throw error;
      }
    },
    evidence() {
      return {
        calls, transactions, transactionAttempts,
        sourceDomainDmlCount: calls.filter(call => DML.test(call.normalizedSql) && SOURCE_TABLES.has(dmlTable(call.normalizedSql))).length,
        registryAliasQueryCount: calls.filter(call => call.channel === "query" && call.normalizedSql.includes("FROM command_aliases a")).length,
        titleDomainQueryCount: calls.filter(call => call.channel === "query" && /(?:player_title|title_definitions)/u.test(call.normalizedSql)).length,
        lastRoute, lastHandlerKey,
      };
    },
  };
  database.withRootTransaction = database.withTransaction;
  return database;
}

async function runWorker(inputPath, targetPath) {
  const input = JSON.parse(readFileSync(inputPath, "utf8"));
  assert(CONSUMERS.has(input.binding?.consumerId), "Wave30 consumer not allowlisted");
  assert(input.invocation?.exportName === "executeWave30PlayerTitleRead", "Wave30 export drift");
  assert(targetPath.endsWith(TARGET), "Wave30 target drift");
  assert(hash(readFileSync(targetPath, "utf8")) === input.invocation.targetSourceSha256, "Wave30 target hash drift");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
  for (const source of input.runtimeSourceHashes ?? []) {
    const committed = execFileSync("git", ["show", `${input.evidenceCommit}:${source.path}`], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    assert(hash(committed) === source.sha256, `Wave30 committed source drift: ${source.path}`);
    assert(hash(readFileSync(resolve(root, source.path), "utf8")) === source.sha256, `Wave30 worktree source drift: ${source.path}`);
  }
  const target = await import(`${pathToFileURL(targetPath).href}?worker=${process.pid}-${randomUUID()}`);
  const execution = await target[input.invocation.exportName]({ ...input, database: createStatefulDatabase() });
  process.stdout.write(JSON.stringify({ processId: process.pid, execution: safe(execution) }));
}

function runChild(harness, input, target) {
  return JSON.parse(execFileSync(process.execPath, ["--import", "tsx", harness, "--worker", input, target], { encoding: "utf8", timeout: 60000, maxBuffer: 16 * 1024 * 1024 }));
}

function deriveTrace(results, scenarioKind) {
  const calls = results.flatMap(result => result.execution.databaseEvidence.calls);
  const queryTrace = calls.filter(call => !DML.test(call.normalizedSql));
  const dmlTrace = calls.filter(call => DML.test(call.normalizedSql));
  const lockOrder = [];
  for (const call of calls) if (/\bFOR UPDATE\b/iu.test(call.normalizedSql)) {
    for (const match of call.normalizedSql.matchAll(/\b(?:FROM|JOIN)\s+([A-Za-z0-9_]+)/giu)) if (!lockOrder.includes(match[1])) lockOrder.push(match[1]);
  }
  const timeline = scenarioKind === "RESTART_CONSISTENCY"
    ? results.flatMap((result, index) => [index === 0 ? "CHILD_PROCESS_1" : "RESTART_CHILD_PROCESS_2", ...result.execution.databaseEvidence.transactions])
    : results[0].execution.databaseEvidence.transactions;
  return {
    queryTrace, dmlTrace,
    normalizedStatements: dmlTrace.map(call => call.normalizedSql),
    rowCount: dmlTrace.reduce((sum, call) => sum + call.rowCount, 0),
    lockOrder, transaction: "COMMIT",
    transactionAttempts: results.flatMap(result => result.execution.databaseEvidence.transactionAttempts).map((attempt, index) => ({ ...attempt, attemptNumber: index + 1 })),
    timeline,
    sourceDomainDmlCount: results.reduce((sum, result) => sum + result.execution.databaseEvidence.sourceDomainDmlCount, 0),
    restartProcessIds: results.map(result => result.processId),
    restartModuleIds: results.map(result => result.execution.moduleExecutionId),
    restartResults: results.map(result => result.execution.result),
  };
}

async function runMain(inputPath, outputDirectory, targetPath) {
  const input = JSON.parse(readFileSync(inputPath, "utf8")), harness = fileURLToPath(import.meta.url);
  const results = [runChild(harness, inputPath, targetPath)];
  if (input.binding.scenarioKind === "RESTART_CONSISTENCY") results.push(runChild(harness, inputPath, targetPath));
  const first = results[0].execution;
  if (results.length === 2) {
    assert(results[0].processId !== results[1].processId, "Wave30 restart reused process");
    assert(results[0].execution.moduleExecutionId !== results[1].execution.moduleExecutionId, "Wave30 restart reused module");
    assert(results[0].execution.reply === results[1].execution.reply, "Wave30 restart reply drift");
    assert(results[0].execution.result === results[1].execution.result, "Wave30 restart result drift");
  }
  const trace = deriveTrace(results, input.binding.scenarioKind);
  assert(trace.sourceDomainDmlCount === 0, "Wave30 source-domain DML detected");
  assert(trace.queryTrace.length > 0 && trace.dmlTrace.length > 0 && trace.transactionAttempts.length > 0, "Wave30 observed trace missing");
  writeFileSync(join(outputDirectory, "reply.raw"), first.reply);
  writeFileSync(join(outputDirectory, "result.raw"), first.result);
  writeFileSync(join(outputDirectory, "trace.json"), `${JSON.stringify(trace, null, 2)}\n`);
  writeFileSync(join(outputDirectory, "case-result.json"), `${JSON.stringify({ format: "hoibot-object-db-consumer-parity-case-result-v1", passed: true, assertionCount: first.assertionCount + 6, executedConsumerId: first.executedConsumerId, executedCaseId: first.executedCaseId, fixtureId: input.binding.fixtureId, scenarioId: input.binding.scenarioId, scenarioKind: input.binding.scenarioKind, invocation: input.invocation, artifacts: { replyPath: "reply.raw", resultPath: "result.raw", tracePath: "trace.json" } }, null, 2)}\n`);
}

const args = process.argv.slice(2);
if (args[0] === "--worker") await runWorker(args[1], args[2]);
else { if (args.length !== 3) throw new Error("Wave30 harness arguments missing"); await runMain(args[0], args[1], args[2]); }
