import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const DML_KEYWORDS = new Set(["INSERT", "UPDATE", "DELETE", "REPLACE", "MERGE", "TRUNCATE"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeSql(sql) {
  return sql.replace(/\s+/g, " ").trim();
}

function jsonSafe(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, jsonSafe(child)]));
  return value;
}

function createRunnerDatabase(consumer) {
  const calls = [];
  const transactionEvents = [];
  const record = (channel, sql, values, rowCount) => {
    const normalizedSql = normalizeSql(sql);
    calls.push({ channel, normalizedSql, values: jsonSafe(values), rowCount });
    return normalizedSql;
  };
  const database = {
    async ping() {},
    async verifyRollback() { return true; },
    async close() {},
    async withTransaction(work) {
      transactionEvents.push("BEGIN");
      try {
        const result = await work(database);
        transactionEvents.push("COMMIT");
        return result;
      } catch (error) {
        transactionEvents.push("ROLLBACK");
        throw error;
      }
    },
    async query(sql, values = []) {
      const normalizedSql = normalizeSql(sql);
      const keyword = normalizedSql.split(" ", 1)[0].toUpperCase();
      if (DML_KEYWORDS.has(keyword)) {
        record("query", sql, values, 1);
        return { affectedRows: 1n };
      }
      assert(normalizedSql === consumer.expectedNormalizedSql, `${consumer.consumerId}: unexpected SELECT SQL`);
      const expectedValues = consumer.expectedQueryValues ?? [consumer.input.playerId];
      assert(JSON.stringify(jsonSafe(values)) === JSON.stringify(expectedValues), `${consumer.consumerId}: unexpected SELECT values`);
      record("query", sql, values, consumer.mockRows.length);
      if (consumer.databaseRowShape === "legacy-object-row") return consumer.mockRows.map((row) => ({
        legacy_object_id: BigInt(row.legacyObjectId),
        legacy_object_key: row.legacyObjectKey,
        object_type: row.objectType,
        object_identity_id: row.canonicalObjectIdentityId,
      }));
      if (consumer.databaseRowShape === "player-target-row") return consumer.mockRows.map((row) => ({
        legacy_player_id: BigInt(row.legacyPlayerId), canonical_player_id: row.canonicalPlayerId,
        external_identity_id: BigInt(row.externalIdentityId), display_name: row.displayName,
        rank_emoji: row.rankEmoji, provider_code: row.providerCode,
      }));
      if (consumer.databaseRowShape === "pet-title-read-row") return consumer.mockRows.map((row) => ({
        owned_pet_title_id: row.instanceId, title_name: row.displayName,
        acquisition_sequence: BigInt(row.acquisitionSequence), acquired_time: row.acquiredAt,
        acquisition_price: row.acquisitionPrice === null ? null : BigInt(row.acquisitionPrice),
        base_sale_price: BigInt(row.baseSalePrice), selected_flag: row.equipped ? 1 : 0,
      }));
      if (consumer.databaseRowShape === "placed-furniture-read-row") return consumer.mockRows.map((row) => ({
        owned_furniture_id: row.ownedFurnitureId, player_id: row.playerId, furniture_id: row.furnitureId,
        enhancement_level: BigInt(row.enhancementLevel), base_charm: BigInt(row.baseCharm),
        charm_per_enhancement: BigInt(row.charmPerEnhancement),
      }));
      return consumer.mockRows.map((row) => ({
        owned_title_id: row.ownedTitleId,
        title_definition_id: row.titleDefinitionId,
        title_name: row.titleName,
        base_sale_price: BigInt(row.baseSalePrice),
        acquisition_price: row.acquisitionPrice === null ? null : BigInt(row.acquisitionPrice),
        acquisition_sequence: BigInt(row.acquisitionSequence),
        acquired_time: row.acquiredTime,
        selected_flag: row.selected ? 1 : 0,
      }));
    },
    async execute(sql, values = []) {
      record("execute", sql, values, 1);
      return { affectedRows: 1n, insertId: 0n };
    },
  };
  return { database, transcript: { calls, transactionEvents } };
}

async function runWorker(inputPath, targetPath) {
  const input = JSON.parse(readFileSync(inputPath, "utf8"));
  const parityCase = input.fixturePayload.cases.find((candidate) => candidate.caseId === input.binding.harnessCaseId);
  assert(parityCase, "runner case mapping missing");
  const consumer = parityCase.consumers.find((candidate) => candidate.consumerId === input.binding.consumerId);
  assert(consumer, "runner consumer mapping missing");
  const normalizedTarget = readFileSync(targetPath, "utf8").replace(/\r\n?/g, "\n");
  const targetSourceSha256 = createHash("sha256").update(normalizedTarget).digest("hex");
  assert(targetSourceSha256 === input.invocation.targetSourceSha256, "target source hash mismatch");
  const target = await import(`${pathToFileURL(targetPath).href}?worker=${process.pid}-${randomUUID()}`);
  const invoke = target[input.invocation.exportName];
  assert(typeof invoke === "function", "target export is not callable");
  const instrumentation = createRunnerDatabase(consumer);
  const execution = await invoke({
    consumerId: input.binding.consumerId,
    harnessCaseId: input.binding.harnessCaseId,
    fixtureId: input.binding.fixtureId,
    scenarioId: input.binding.scenarioId,
    scenarioKind: input.binding.scenarioKind,
    fixturePayload: input.fixturePayload,
    database: instrumentation.database,
  });
  assert(execution && typeof execution === "object", "execution result missing");
  assert(!Object.prototype.hasOwnProperty.call(execution, "trace"), "target-declared trace is forbidden");
  process.stdout.write(JSON.stringify({ execution: jsonSafe(execution), transcript: instrumentation.transcript, processId: process.pid, moduleExecutionId: execution.moduleExecutionId }));
}

function deriveTrace(workerResults, scenarioKind) {
  const allCalls = workerResults.flatMap(({ transcript }) => transcript.calls);
  const dmlCalls = allCalls.filter(({ normalizedSql }) => DML_KEYWORDS.has(normalizedSql.split(" ", 1)[0].toUpperCase()));
  const normalizedStatements = dmlCalls.map(({ normalizedSql }) => normalizedSql);
  const rowCount = dmlCalls.reduce((sum, { rowCount: rows }) => sum + rows, 0);
  const lockOrder = [];
  for (const { normalizedSql } of allCalls) {
    if (!/\bFOR UPDATE\b/i.test(normalizedSql)) continue;
    for (const match of normalizedSql.matchAll(/\b(?:FROM|JOIN)\s+([A-Za-z0-9_]+)/gi)) if (!lockOrder.includes(match[1])) lockOrder.push(match[1]);
  }
  const transactionEvents = workerResults.flatMap(({ transcript }) => transcript.transactionEvents);
  const transaction = transactionEvents.includes("ROLLBACK") ? "ROLLBACK" : transactionEvents.includes("BEGIN") || dmlCalls.length > 0 ? "COMMIT" : "READ_ONLY";
  let timeline;
  if (scenarioKind === "NEGATIVE_GUARD" && allCalls.length === 0) timeline = ["GUARD_REJECTED"];
  else if (scenarioKind === "RESTART_CONSISTENCY") timeline = ["CHILD_PROCESS_1:READ", "RESTART", "CHILD_PROCESS_2:READ"];
  else if (transactionEvents.length > 0) timeline = transactionEvents.slice();
  else timeline = allCalls.map(({ normalizedSql }) => DML_KEYWORDS.has(normalizedSql.split(" ", 1)[0].toUpperCase()) ? "DML" : "READ");
  return { normalizedStatements, rowCount, lockOrder, transaction, timeline };
}

function invokeWorker(harnessPath, workerInputPath, targetPath) {
  return JSON.parse(execFileSync(process.execPath, [harnessPath, "--worker", workerInputPath, targetPath], { encoding: "utf8", timeout: 10_000, maxBuffer: 1024 * 1024 }));
}

async function runMain(inputPath, outputDirectory, targetPath) {
  const input = JSON.parse(readFileSync(inputPath, "utf8"));
  const harnessPath = fileURLToPath(import.meta.url);
  const workerInputPath = join(outputDirectory, "worker-input.json");
  writeFileSync(workerInputPath, `${JSON.stringify(input)}\n`, "utf8");
  const workerResults = [invokeWorker(harnessPath, workerInputPath, targetPath)];
  if (input.binding.scenarioKind === "RESTART_CONSISTENCY") workerResults.push(invokeWorker(harnessPath, workerInputPath, targetPath));
  const first = workerResults[0].execution;
  let assertionCount = 0;
  const check = (condition, message) => { assertionCount += 1; assert(condition, message); };
  check(first.executedConsumerId === input.binding.consumerId, "executed consumer mismatch");
  check(first.executedCaseId === input.binding.harnessCaseId, "executed case mismatch");
  check(typeof first.reply === "string", "raw reply missing");
  check(typeof first.result === "string", "raw result missing");
  check(Number.isSafeInteger(first.assertionCount) && first.assertionCount > 0, "target assertions missing");
  if (workerResults.length === 2) {
    const second = workerResults[1];
    check(workerResults[0].processId !== second.processId, "restart reused process");
    check(workerResults[0].moduleExecutionId !== second.moduleExecutionId, "restart reused module execution");
    const { moduleExecutionId: _firstModule, ...firstComparable } = first;
    const { moduleExecutionId: _secondModule, ...secondComparable } = second.execution;
    check(JSON.stringify(firstComparable) === JSON.stringify(secondComparable), "restart execution result drift");
    first.result = JSON.stringify({ result: JSON.parse(first.result), restartEvidence: { processExecutions: 2, distinctProcessIds: true, distinctModuleExecutions: true } });
  }
  const trace = deriveTrace(workerResults, input.binding.scenarioKind);
  writeFileSync(join(outputDirectory, "reply.raw"), Buffer.from(first.reply, "utf8"));
  writeFileSync(join(outputDirectory, "result.raw"), Buffer.from(first.result, "utf8"));
  writeFileSync(join(outputDirectory, "trace.json"), `${JSON.stringify(trace, null, 2)}\n`, "utf8");
  writeFileSync(join(outputDirectory, "case-result.json"), `${JSON.stringify({
    format: "hoibot-object-db-consumer-parity-case-result-v1",
    passed: true,
    assertionCount: assertionCount + first.assertionCount,
    executedConsumerId: first.executedConsumerId,
    executedCaseId: first.executedCaseId,
    fixtureId: input.binding.fixtureId,
    scenarioId: input.binding.scenarioId,
    scenarioKind: input.binding.scenarioKind,
    invocation: { targetPath: input.invocation.targetPath, targetSourceSha256: input.invocation.targetSourceSha256, exportName: input.invocation.exportName },
    artifacts: { replyPath: "reply.raw", resultPath: "result.raw", tracePath: "trace.json" },
  }, null, 2)}\n`, "utf8");
}

const args = process.argv.slice(2);
if (args[0] === "--worker") await runWorker(args[1], args[2]);
else {
  if (args.length !== 3) throw new Error("missing harness arguments");
  await runMain(args[0], args[1], args[2]);
}
