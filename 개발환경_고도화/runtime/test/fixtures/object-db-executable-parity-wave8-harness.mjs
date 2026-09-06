// Wave8 전용: 관리자 체인의 시도별 transaction 증거를 기록합니다.
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const DML_KEYWORDS = new Set([
  "INSERT",
  "UPDATE",
  "DELETE",
  "REPLACE",
  "MERGE",
  "TRUNCATE",
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeSql(sql) {
  return sql.replace(/\s+/g, " ").trim();
}

function jsonSafe(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, jsonSafe(child)]),
    );
  return value;
}

function matchesExpectedValue(actual, expected) {
  if (
    expected &&
    typeof expected === "object" &&
    !Array.isArray(expected) &&
    typeof expected.$bigint === "string"
  )
    return typeof actual === "bigint" && actual === BigInt(expected.$bigint);
  if (
    expected &&
    typeof expected === "object" &&
    !Array.isArray(expected) &&
    expected.matcher === "UUID_V4"
  ) {
    return (
      typeof actual === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        actual,
      )
    );
  }
  return JSON.stringify(jsonSafe(actual)) === JSON.stringify(expected);
}

function createRunnerDatabase(consumer, scenarioKind) {
  const calls = [];
  const transactionEvents = [];
  const transactionAttempts = [];
  const orderedRows = consumer.queryRowsByScenario?.[scenarioKind];
  const orderedPlan = Array.isArray(orderedRows)
    ? orderedRows.map((mockRows, index) => ({
        ...consumer.orderedQueries[index],
        mockRows,
      }))
    : undefined;
  const queueContract = consumer.queueReplyContract,
    handlerResult = consumer.expectedResultsByScenario?.[scenarioKind];
  const explicitQueryPlan = consumer.queryPlanByScenario?.[scenarioKind];
  const explicitMutationPlan = consumer.mutationPlanByScenario?.[scenarioKind];
  const mutationPlan = Array.isArray(explicitMutationPlan)
    ? explicitMutationPlan
    : queueContract?.queueScenarios?.includes(scenarioKind)
      ? [
          {
            expectedNormalizedSql: queueContract.operationSql,
            expectedValues: [{ matcher: queueContract.operationKeyMatcher }],
            affectedRows: 1,
            insertId: queueContract.operationInsertId,
          },
          {
            expectedNormalizedSql: queueContract.commandExecutionSql,
            expectedValues: [
              consumer.input.eventId,
              handlerResult.commandCode,
              queueContract.operationInsertId,
            ],
            affectedRows: 1,
            insertId: "0",
          },
          {
            expectedNormalizedSql: queueContract.outboxSql,
            expectedValues: [
              queueContract.operationInsertId,
              consumer.input.channelId,
              JSON.stringify({ data: handlerResult.message }),
            ],
            affectedRows: 1,
            insertId: queueContract.outboxInsertId,
          },
        ]
      : queueContract
        ? []
        : undefined;
  let orderedQueryIndex = 0;
  let orderedMutationIndex = 0;
  const record = (channel, sql, values, rowCount) => {
    const normalizedSql = normalizeSql(sql);
    calls.push({ channel, normalizedSql, values: jsonSafe(values), rowCount });
    return normalizedSql;
  };
  const database = {
    async ping() {},
    async verifyRollback() {
      return true;
    },
    async close() {},
    async withTransaction(work) {
      transactionEvents.push("BEGIN");
      const callStart = calls.length;
      const finishAttempt = (outcome) => {
        const attemptCalls = calls.slice(callStart);
        const dmlCalls = attemptCalls.filter(({ normalizedSql }) =>
          DML_KEYWORDS.has(normalizedSql.split(" ", 1)[0].toUpperCase()),
        );
        transactionAttempts.push({
          attemptNumber: transactionAttempts.length + 1,
          outcome,
          committed: outcome === "COMMIT",
          dmlStatements: dmlCalls.map(({ normalizedSql }) => normalizedSql),
          dmlRowCount: dmlCalls.reduce(
            (sum, { rowCount }) => sum + rowCount,
            0,
          ),
        });
      };
      try {
        const result = await work(database);
        transactionEvents.push("COMMIT");
        finishAttempt("COMMIT");
        return result;
      } catch (error) {
        transactionEvents.push("ROLLBACK");
        finishAttempt("ROLLBACK");
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
      if (Array.isArray(explicitQueryPlan)) {
        const step = explicitQueryPlan[orderedQueryIndex++];
        assert(
          step !== undefined,
          `${consumer.consumerId}: unexpected extra SELECT`,
        );
        assert(
          normalizedSql === step.expectedNormalizedSql,
          `${consumer.consumerId}: ordered SELECT SQL drift`,
        );
        assert(
          values.length === step.expectedValues.length &&
            values.every((value, index) =>
              matchesExpectedValue(value, step.expectedValues[index]),
            ),
          `${consumer.consumerId}: ordered SELECT values drift`,
        );
        record("query", sql, values, step.rows.length);
        if (step.error) {
          const error = new Error(step.error.message);
          error.code = step.error.code;
          error.errno = step.error.errno;
          throw error;
        }
        return reviveFixtureValue(step.rows);
      }
      if (Array.isArray(orderedPlan)) {
        const step = orderedPlan[orderedQueryIndex++];
        assert(
          step !== undefined,
          `${consumer.consumerId}: unexpected extra SELECT`,
        );
        assert(
          normalizedSql === step.expectedNormalizedSql,
          `${consumer.consumerId}: ordered SELECT SQL drift`,
        );
        assert(
          JSON.stringify(jsonSafe(values)) ===
            JSON.stringify(step.expectedQueryValues),
          `${consumer.consumerId}: ordered SELECT values drift`,
        );
        record("query", sql, values, step.mockRows.length);
        return mapOrderedRows(step.rowShape, step.mockRows);
      }
      assert(
        normalizedSql === consumer.expectedNormalizedSql,
        `${consumer.consumerId}: unexpected SELECT SQL`,
      );
      const expectedValues = consumer.expectedQueryValues ?? [
        consumer.input.playerId,
      ];
      assert(
        JSON.stringify(jsonSafe(values)) === JSON.stringify(expectedValues),
        `${consumer.consumerId}: unexpected SELECT values`,
      );
      record("query", sql, values, consumer.mockRows.length);
      if (consumer.databaseRowShape === "legacy-object-row")
        return consumer.mockRows.map((row) => ({
          legacy_object_id: BigInt(row.legacyObjectId),
          legacy_object_key: row.legacyObjectKey,
          object_type: row.objectType,
          object_identity_id: row.canonicalObjectIdentityId,
        }));
      if (consumer.databaseRowShape === "player-target-row")
        return consumer.mockRows.map((row) => ({
          legacy_player_id: BigInt(row.legacyPlayerId),
          canonical_player_id: row.canonicalPlayerId,
          external_identity_id: BigInt(row.externalIdentityId),
          display_name: row.displayName,
          rank_emoji: row.rankEmoji,
          provider_code: row.providerCode,
        }));
      if (consumer.databaseRowShape === "pet-title-read-row")
        return consumer.mockRows.map((row) => ({
          owned_pet_title_id: row.instanceId,
          title_name: row.displayName,
          acquisition_sequence: BigInt(row.acquisitionSequence),
          acquired_time: row.acquiredAt,
          acquisition_price:
            row.acquisitionPrice === null ? null : BigInt(row.acquisitionPrice),
          base_sale_price: BigInt(row.baseSalePrice),
          selected_flag: row.equipped ? 1 : 0,
        }));
      if (consumer.databaseRowShape === "placed-furniture-read-row")
        return consumer.mockRows.map((row) => ({
          owned_furniture_id: row.ownedFurnitureId,
          player_id: row.playerId,
          furniture_id: row.furnitureId,
          enhancement_level: BigInt(row.enhancementLevel),
          base_charm: BigInt(row.baseCharm),
          charm_per_enhancement: BigInt(row.charmPerEnhancement),
        }));
      return consumer.mockRows.map((row) => ({
        owned_title_id: row.ownedTitleId,
        title_definition_id: row.titleDefinitionId,
        title_name: row.titleName,
        base_sale_price: BigInt(row.baseSalePrice),
        acquisition_price:
          row.acquisitionPrice === null ? null : BigInt(row.acquisitionPrice),
        acquisition_sequence: BigInt(row.acquisitionSequence),
        acquired_time: row.acquiredTime,
        selected_flag: row.selected ? 1 : 0,
      }));
    },
    async execute(sql, values = []) {
      const step = Array.isArray(mutationPlan)
        ? mutationPlan[orderedMutationIndex++]
        : undefined;
      assert(step !== undefined, `${consumer.consumerId}: unexpected mutation`);
      const normalizedSql = normalizeSql(sql);
      assert(
        normalizedSql === step.expectedNormalizedSql,
        `${consumer.consumerId}: ordered mutation SQL drift`,
      );
      assert(
        values.length === step.expectedValues.length &&
          values.every((value, index) =>
            matchesExpectedValue(value, step.expectedValues[index]),
          ),
        `${consumer.consumerId}: ordered mutation values drift`,
      );
      record("execute", sql, values, step.affectedRows);
      if (step.error) {
        const error = new Error(step.error.message);
        error.code = step.error.code;
        error.errno = step.error.errno;
        throw error;
      }
      return {
        affectedRows: BigInt(step.affectedRows),
        insertId: BigInt(step.insertId),
      };
    },
  };
  return {
    database,
    transcript: { calls, transactionEvents, transactionAttempts },
    assertComplete() {
      const queryPlan = Array.isArray(explicitQueryPlan)
        ? explicitQueryPlan
        : orderedPlan;
      if (Array.isArray(queryPlan))
        assert(
          orderedQueryIndex === queryPlan.length,
          `${consumer.consumerId}: ordered SELECT count drift`,
        );
      if (Array.isArray(mutationPlan))
        assert(
          orderedMutationIndex === mutationPlan.length,
          `${consumer.consumerId}: ordered mutation count drift`,
        );
    },
  };
}

function reviveFixtureValue(value) {
  if (Array.isArray(value)) return value.map(reviveFixtureValue);
  if (value && typeof value === "object") {
    if (Object.keys(value).length === 1 && typeof value.$bigint === "string")
      return BigInt(value.$bigint);
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        reviveFixtureValue(child),
      ]),
    );
  }
  return value;
}

function mapOrderedRows(shape, rows) {
  if (shape === "point-shop-head-row")
    return rows.map((row) => ({ version: BigInt(row.version) }));
  if (shape === "point-shop-entry-row")
    return rows.map((row) => ({
      product_id: row.productId,
      product_key: row.productKey,
      display_name: row.displayName,
      display_order: row.displayOrder,
      price: BigInt(row.price),
      row_version: BigInt(row.rowVersion),
    }));
  if (shape === "point-shop-state-row")
    return rows.map((row) => ({
      tax_rate_basis_points: row.taxRateBasisPoints,
      lord_guild_name: row.lordGuildName,
    }));
  if (shape === "package-player-row")
    return rows.map((row) => ({ player_id: row.playerId }));
  if (shape === "package-bag-row")
    return rows.map((row) => ({
      package_id: row.packageId,
      display_name: row.displayName,
      quantity: row.quantity,
      max_open_count: row.maxOpenCount,
    }));
  if (shape === "wizard-operator-row")
    return rows.map((row) => ({ operator_id: BigInt(row.operatorId) }));
  if (shape === "wizard-replay-row")
    return rows.map((row) => ({ result_json: row.resultJson }));
  if (shape === "player-context-row")
    return rows.map((row) => ({
      legacy_player_id: BigInt(row.legacyPlayerId),
      canonical_player_id: row.canonicalPlayerId,
      external_identity_id: BigInt(row.externalIdentityId),
      display_name: row.displayName,
      rank_emoji: row.rankEmoji,
      provider_code: row.providerCode,
      caller_link_id: row.callerLinkId ?? null,
    }));
  if (shape === "bag-identity-row")
    return rows.map((row) => ({
      legacy_player_id: BigInt(row.legacyPlayerId),
      display_name: row.displayName,
      legacy_identity_status: row.legacyIdentityStatus,
      canonical_player_id: row.canonicalPlayerId,
      crosswalk_status: row.crosswalkStatus,
    }));
  if (shape === "legacy-stack-row")
    return rows.map((row) => ({
      record_id: BigInt(row.recordId),
      display_name: row.displayName,
      quantity: BigInt(row.quantity),
      legacy_bag_order:
        row.legacyBagOrder === null ? null : BigInt(row.legacyBagOrder),
      stackable_flag: row.stackableFlag ? 1 : 0,
    }));
  if (shape === "canonical-stack-row")
    return rows.map((row) => ({
      record_id: row.recordId,
      display_name: row.displayName,
      quantity: BigInt(row.quantity),
      legacy_bag_order:
        row.legacyBagOrder === null ? null : BigInt(row.legacyBagOrder),
      stackable_flag: row.stackableFlag ? 1 : 0,
    }));
  if (shape === "canonical-instance-row")
    return rows.map((row) => ({
      record_id: row.recordId,
      display_name: row.displayName,
    }));
  throw new Error(`unsupported ordered row shape: ${shape}`);
}

async function runWorker(inputPath, targetPath) {
  const input = JSON.parse(readFileSync(inputPath, "utf8"));
  const parityCase = input.fixturePayload.cases.find(
    (candidate) => candidate.caseId === input.binding.harnessCaseId,
  );
  assert(parityCase, "runner case mapping missing");
  const consumer = parityCase.consumers.find(
    (candidate) => candidate.consumerId === input.binding.consumerId,
  );
  assert(consumer, "runner consumer mapping missing");
  const normalizedTarget = readFileSync(targetPath, "utf8").replace(
    /\r\n?/g,
    "\n",
  );
  const targetSourceSha256 = createHash("sha256")
    .update(normalizedTarget)
    .digest("hex");
  assert(
    targetSourceSha256 === input.invocation.targetSourceSha256,
    "target source hash mismatch",
  );
  const target = await import(
    `${pathToFileURL(targetPath).href}?worker=${process.pid}-${randomUUID()}`
  );
  const invoke = target[input.invocation.exportName];
  assert(typeof invoke === "function", "target export is not callable");
  const instrumentation = createRunnerDatabase(
    consumer,
    input.binding.scenarioKind,
  );
  const execution = await invoke({
    consumerId: input.binding.consumerId,
    harnessCaseId: input.binding.harnessCaseId,
    fixtureId: input.binding.fixtureId,
    scenarioId: input.binding.scenarioId,
    scenarioKind: input.binding.scenarioKind,
    fixturePayload: input.fixturePayload,
    database: instrumentation.database,
  });
  instrumentation.assertComplete();
  assert(
    execution && typeof execution === "object",
    "execution result missing",
  );
  assert(
    !Object.prototype.hasOwnProperty.call(execution, "trace"),
    "target-declared trace is forbidden",
  );
  process.stdout.write(
    JSON.stringify({
      execution: jsonSafe(execution),
      transcript: instrumentation.transcript,
      processId: process.pid,
      moduleExecutionId: execution.moduleExecutionId,
    }),
  );
}

function deriveTrace(workerResults, scenarioKind) {
  const allCalls = workerResults.flatMap(({ transcript }) => transcript.calls);
  const queryTrace = allCalls
    .filter(
      ({ normalizedSql }) =>
        !DML_KEYWORDS.has(normalizedSql.split(" ", 1)[0].toUpperCase()),
    )
    .map(({ channel, normalizedSql, values, rowCount }) => ({
      channel,
      normalizedSql,
      values,
      rowCount,
    }));
  const dmlCalls = allCalls.filter(({ normalizedSql }) =>
    DML_KEYWORDS.has(normalizedSql.split(" ", 1)[0].toUpperCase()),
  );
  const dmlTrace = dmlCalls.map(
    ({ channel, normalizedSql, values, rowCount }) => ({
      channel,
      normalizedSql,
      values,
      rowCount,
    }),
  );
  const normalizedStatements = dmlCalls.map(
    ({ normalizedSql }) => normalizedSql,
  );
  const rowCount = dmlCalls.reduce((sum, { rowCount: rows }) => sum + rows, 0);
  const lockOrder = [];
  for (const { normalizedSql } of allCalls) {
    if (!/\bFOR UPDATE\b/i.test(normalizedSql)) continue;
    for (const match of normalizedSql.matchAll(
      /\b(?:FROM|JOIN)\s+([A-Za-z0-9_]+)/gi,
    ))
      if (!lockOrder.includes(match[1])) lockOrder.push(match[1]);
  }
  const transactionEvents = workerResults.flatMap(
    ({ transcript }) => transcript.transactionEvents,
  );
  const transactionAttempts = workerResults.flatMap(
    ({ transcript }) => transcript.transactionAttempts,
  ).map((attempt, index) => ({ ...attempt, attemptNumber: index + 1 }));
  const transaction = transactionEvents.at(-1) === "ROLLBACK"
    ? "ROLLBACK"
    : transactionEvents.at(-1) === "COMMIT" || dmlCalls.length > 0
      ? "COMMIT"
      : "READ_ONLY";
  let timeline;
  if (scenarioKind === "NEGATIVE_GUARD" && allCalls.length === 0)
    timeline = ["GUARD_REJECTED"];
  else if (scenarioKind === "RESTART_CONSISTENCY")
    timeline =
      dmlCalls.length > 0
        ? ["CHILD_PROCESS_1:COMMIT", "RESTART", "CHILD_PROCESS_2:COMMIT"]
        : ["CHILD_PROCESS_1:READ", "RESTART", "CHILD_PROCESS_2:READ"];
  else if (transactionEvents.length > 0) timeline = transactionEvents.slice();
  else
    timeline = allCalls.map(({ normalizedSql }) =>
      DML_KEYWORDS.has(normalizedSql.split(" ", 1)[0].toUpperCase())
        ? "DML"
        : "READ",
    );
  return {
    queryTrace,
    dmlTrace,
    normalizedStatements,
    rowCount,
    lockOrder,
    transaction,
    transactionAttempts,
    timeline,
  };
}

function invokeWorker(harnessPath, workerInputPath, targetPath) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [harnessPath, "--worker", workerInputPath, targetPath],
      { encoding: "utf8", timeout: 10_000, maxBuffer: 1024 * 1024 },
    ),
  );
}

async function runMain(inputPath, outputDirectory, targetPath) {
  const input = JSON.parse(readFileSync(inputPath, "utf8"));
  const harnessPath = fileURLToPath(import.meta.url);
  const workerInputPath = join(outputDirectory, "worker-input.json");
  writeFileSync(workerInputPath, `${JSON.stringify(input)}\n`, "utf8");
  const workerResults = [
    invokeWorker(harnessPath, workerInputPath, targetPath),
  ];
  if (input.binding.scenarioKind === "RESTART_CONSISTENCY")
    workerResults.push(invokeWorker(harnessPath, workerInputPath, targetPath));
  const first = workerResults[0].execution;
  let assertionCount = 0;
  const check = (condition, message) => {
    assertionCount += 1;
    assert(condition, message);
  };
  check(
    first.executedConsumerId === input.binding.consumerId,
    "executed consumer mismatch",
  );
  check(
    first.executedCaseId === input.binding.harnessCaseId,
    "executed case mismatch",
  );
  check(typeof first.reply === "string", "raw reply missing");
  check(typeof first.result === "string", "raw result missing");
  check(
    Number.isSafeInteger(first.assertionCount) && first.assertionCount > 0,
    "target assertions missing",
  );
  if (workerResults.length === 2) {
    const second = workerResults[1];
    check(
      workerResults[0].processId !== second.processId,
      "restart reused process",
    );
    check(
      workerResults[0].moduleExecutionId !== second.moduleExecutionId,
      "restart reused module execution",
    );
    const { moduleExecutionId: _firstModule, ...firstComparable } = first;
    const { moduleExecutionId: _secondModule, ...secondComparable } =
      second.execution;
    check(
      JSON.stringify(firstComparable) === JSON.stringify(secondComparable),
      "restart execution result drift",
    );
    const operationKeys = workerResults
      .map(
        ({ transcript }) =>
          transcript.calls.find(
            ({ channel, normalizedSql }) =>
              channel === "execute" &&
              normalizedSql.startsWith("INSERT INTO operations"),
          )?.values?.[0],
      )
      .filter((value) => value !== undefined);
    let distinctOperationKeys;
    if (operationKeys.length > 0) {
      check(
        operationKeys.length === 2,
        "restart operation key capture missing",
      );
      check(
        operationKeys.every(
          (value) =>
            typeof value === "string" &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
              value,
            ),
        ),
        "restart operation key UUIDv4 drift",
      );
      check(
        operationKeys[0] !== operationKeys[1],
        "restart reused operation key",
      );
      distinctOperationKeys = true;
    }
    first.result = JSON.stringify({
      result: JSON.parse(first.result),
      restartEvidence: {
        processExecutions: 2,
        distinctProcessIds: true,
        distinctModuleExecutions: true,
        ...(distinctOperationKeys === true
          ? { distinctOperationKeys: true }
          : {}),
      },
    });
  }
  const trace = deriveTrace(workerResults, input.binding.scenarioKind);
  writeFileSync(
    join(outputDirectory, "reply.raw"),
    Buffer.from(first.reply, "utf8"),
  );
  writeFileSync(
    join(outputDirectory, "result.raw"),
    Buffer.from(first.result, "utf8"),
  );
  writeFileSync(
    join(outputDirectory, "trace.json"),
    `${JSON.stringify(trace, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    join(outputDirectory, "case-result.json"),
    `${JSON.stringify(
      {
        format: "hoibot-object-db-consumer-parity-case-result-v1",
        passed: true,
        assertionCount: assertionCount + first.assertionCount,
        executedConsumerId: first.executedConsumerId,
        executedCaseId: first.executedCaseId,
        fixtureId: input.binding.fixtureId,
        scenarioId: input.binding.scenarioId,
        scenarioKind: input.binding.scenarioKind,
        invocation: {
          targetPath: input.invocation.targetPath,
          targetSourceSha256: input.invocation.targetSourceSha256,
          exportName: input.invocation.exportName,
        },
        artifacts: {
          replyPath: "reply.raw",
          resultPath: "result.raw",
          tracePath: "trace.json",
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

const args = process.argv.slice(2);
if (args[0] === "--worker") await runWorker(args[1], args[2]);
else {
  if (args.length !== 3) throw new Error("missing harness arguments");
  await runMain(args[0], args[1], args[2]);
}
