import { createHash } from "node:crypto";

export const OBJECT_DB_MUTATION_EVIDENCE_FORMAT = "hoibot-object-db-consumer-mutation-evidence-v1" as const;

const SEALED_ORACLE_SHA256_BY_CONSUMER: Readonly<Record<string, string>> = Object.freeze({
  "sql-repository-b1d650b73c2ddff0": "b40690fc50b87b42cc87294ce2fffed64a6bb0aa3146d0db3cea4337d9300fec",
  "sql-repository-4f896a4a6feb5ec1": "9d19c75cabbcc382e05d6837f94a69d960d39782350bf3f3d61f33671781fb8d",
  "sql-repository-6a8f4b07e980a91f": "7ebd1d7b46f7623070870161b122e248ea070f365ab0ae4681d31d53312d8460",
  "sql-repository-818137c4fb22037a": "022fba37efa29ff601b35a6e47ff85957b20c27c9bd7555e47f95f2d758f7ba6",
  "sql-repository-f6c531148a436a21": "202262ac9e504a89b2a7ba0f8d1af1c10c2d70f81fb6fdcbd48a2f4f02663249",
  "sql-repository-31c4099080d9c9c1": "cb503a649bd47dd07c23081afda753d2bc4c9231b4477f74b7a38e35f60f3fbc",
});

const STRENGTHENED_MUTATION_CONSUMERS = new Set([
  "sql-repository-6a8f4b07e980a91f",
  "sql-repository-818137c4fb22037a",
  "sql-repository-f6c531148a436a21",
  "sql-repository-31c4099080d9c9c1",
]);

export const OBJECT_DB_MUTATION_SCENARIOS = [
  "MUTATION_SUCCESS",
  "DOMAIN_FAILURE_ROLLBACK",
  "DUPLICATE_REPLAY_DML_ZERO",
  "PAYLOAD_DRIFT_FAIL_CLOSED",
  "RESTART_REPLAY",
  "CONCURRENCY_SINGLE_WRITER",
] as const;

export type ObjectDbMutationScenario = typeof OBJECT_DB_MUTATION_SCENARIOS[number];

export type ObjectDbMutationPostState = Record<string, number>;

export interface ObjectDbMutationTrace {
  processId: number;
  moduleExecutionId: string;
  role: "PRIMARY" | "SEED" | "REPLAY" | "CONCURRENT";
  source: { path: string; sha256: string; spanStart: number; spanEnd: number; spanSha256: string; catalogSpanStart: number; catalogSpanEnd: number; catalogSpanSha256: string; relocationDiffSha256: string };
  database: { host: string; port: number; name: string };
  transactionAttempts: Array<{
    attempt: number;
    outcome: "COMMIT" | "ROLLBACK";
    attemptedDmlStatements: string[];
    affectedDmlStatements: string[];
    affectedRowCount: number;
    lockOrder?: string[];
    failure?: { code: string | null; errno: number | null; errorKind: string; constraintName: string | null } | null;
  }>;
  committedDmlStatements: string[];
  committedRowCount: number;
  rolledBackAffectedRowCount: number;
  lockOrder: string[];
  before: ObjectDbMutationPostState;
  after: ObjectDbMutationPostState;
  replayed: boolean | null;
  errorCode: string | null;
  externalNetworkCalls: number;
  replyCalls: number;
  locatorMode?: "LEGACY_RAW" | "SHA256_OVERFLOW";
  beforeSha256?: string;
  afterSha256?: string;
  locatorProjection?: { mode: "RAW_COMPOSITE"; playerId?: string; idempotencyScope?: string; idempotencyKey?: string; key?: Record<string, string>; rows: Array<Record<string, unknown>>; locatorOK: true };
  beforeRows?: Record<string, Array<Record<string, unknown>>>;
  afterRows?: Record<string, Array<Record<string, unknown>>>;
}

export interface ObjectDbMutationScenarioOracle {
  scenarioKind: ObjectDbMutationScenario;
  traceRoles: ObjectDbMutationTrace["role"][];
  primaryRole: ObjectDbMutationTrace["role"];
  primaryTransactionOutcome: "COMMIT" | "ROLLBACK";
  primaryTransactionAttempts: number;
  expectedAttemptedDmlTableSequence: string[];
  expectedAffectedDmlTableSequence: string[];
  expectedDmlTableSequence: string[];
  expectedLockOrder: string[];
  expectedCommittedRowCount: number;
  expectedRolledBackAffectedRowCount: number;
  expectedBefore: ObjectDbMutationPostState;
  expectedAfter: ObjectDbMutationPostState;
  expectedReplayed: boolean | null;
  expectedErrorCode: string | null;
  distinctProcessRoles: ObjectDbMutationTrace["role"][];
  expectedAttemptFailures?: Array<ObjectDbMutationTrace["transactionAttempts"][number]["failure"]>;
  expectedLockOrderByAttempt?: string[][];
  expectedBeforeRows?: Record<string, Array<Record<string, unknown>>>;
  expectedAfterRows?: Record<string, Array<Record<string, unknown>>>;
  expectedLocatorProjection?: ObjectDbMutationTrace["locatorProjection"];
  expectedBeforeSha256?: string;
  expectedAfterSha256?: string;
}

export interface ObjectDbMutationEvidenceContract {
  format: typeof OBJECT_DB_MUTATION_EVIDENCE_FORMAT;
  consumerId: string;
  source: ObjectDbMutationTrace["source"];
  database: { host: "127.0.0.1"; forbiddenPort: 3306; namePrefix: string };
  allowedTables: string[];
  scenarios: ObjectDbMutationScenarioOracle[];
}

export interface ObjectDbMutationScenarioEvidence {
  scenarioKind: ObjectDbMutationScenario;
  traces: ObjectDbMutationTrace[];
}

const exactKeys = (value: object, expected: readonly string[], label: string): void => {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error(`${label} keys drift`);
};

const assertPostState = (actual: ObjectDbMutationPostState, expected: ObjectDbMutationPostState, tables: readonly string[], label: string): void => {
  exactKeys(actual, tables, label);
  exactKeys(expected, tables, `${label}.oracle`);
  for (const [table, count] of Object.entries(actual)) if (!Number.isSafeInteger(count) || count < 0) throw new Error(`${label}.${table} invalid`);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} mismatch`);
};

const dmlTable = (statement: string): string => {
  const match = /^(?:INSERT(?:\s+IGNORE)?\s+INTO|UPDATE|DELETE\s+FROM)\s+([A-Za-z0-9_]+)/i.exec(statement);
  if (match?.[1] === undefined) throw new Error(`mutation evidence contains non-DML statement: ${statement}`);
  return match[1];
};

// 사전 고정 oracle과 실제 mutation trace를 대조하여 시나리오 증거를 fail-close 검증합니다.
export function validateObjectDbMutationScenarioEvidence(
  contract: ObjectDbMutationEvidenceContract,
  evidence: ObjectDbMutationScenarioEvidence,
): { primary: ObjectDbMutationTrace; processIds: number[] } {
  exactKeys(contract, ["format","consumerId","source","database","allowedTables","scenarios"], "mutation contract");
  exactKeys(contract.source, ["path","sha256","spanStart","spanEnd","spanSha256","catalogSpanStart","catalogSpanEnd","catalogSpanSha256","relocationDiffSha256"], "mutation contract source");
  exactKeys(contract.database, ["host","forbiddenPort","namePrefix"], "mutation contract database");
  exactKeys(evidence, ["scenarioKind","traces"], "mutation evidence");
  if (contract.format !== OBJECT_DB_MUTATION_EVIDENCE_FORMAT) throw new Error("mutation evidence format drift");
  if (![contract.source.sha256,contract.source.spanSha256,contract.source.catalogSpanSha256,contract.source.relocationDiffSha256].every((value)=>/^([0-9a-f]{64})$/.test(value))
    || !Number.isSafeInteger(contract.source.spanStart) || !Number.isSafeInteger(contract.source.spanEnd) || contract.source.spanStart < 0 || contract.source.spanEnd <= contract.source.spanStart
    || !Number.isSafeInteger(contract.source.catalogSpanStart) || !Number.isSafeInteger(contract.source.catalogSpanEnd) || contract.source.catalogSpanStart < 0 || contract.source.catalogSpanEnd <= contract.source.catalogSpanStart) throw new Error("mutation source provenance invalid");
  if (contract.database.host !== "127.0.0.1" || contract.database.forbiddenPort !== 3306 || contract.database.namePrefix.length === 0) throw new Error("mutation database isolation contract invalid");
  if (new Set(contract.allowedTables).size !== contract.allowedTables.length || contract.allowedTables.length === 0) throw new Error("mutation allowed table set invalid");
  const oracleSha256 = createHash("sha256").update(JSON.stringify({ allowedTables: contract.allowedTables, scenarios: contract.scenarios })).digest("hex");
  if (oracleSha256 !== SEALED_ORACLE_SHA256_BY_CONSUMER[contract.consumerId]) throw new Error("mutation independent oracle seal drift");
  if (contract.scenarios.length !== OBJECT_DB_MUTATION_SCENARIOS.length || new Set(contract.scenarios.map(({ scenarioKind }) => scenarioKind)).size !== OBJECT_DB_MUTATION_SCENARIOS.length
    || OBJECT_DB_MUTATION_SCENARIOS.some((scenarioKind) => !contract.scenarios.some((candidate) => candidate.scenarioKind === scenarioKind))) throw new Error("mutation scenario oracle set drift");
  const oracle = contract.scenarios.find((candidate) => candidate.scenarioKind === evidence.scenarioKind);
  if (oracle === undefined) throw new Error(`mutation oracle missing: ${evidence.scenarioKind}`);
  const oracleKeys = ["scenarioKind","traceRoles","primaryRole","primaryTransactionOutcome","primaryTransactionAttempts","expectedAttemptedDmlTableSequence","expectedAffectedDmlTableSequence","expectedDmlTableSequence","expectedLockOrder","expectedCommittedRowCount","expectedRolledBackAffectedRowCount","expectedBefore","expectedAfter","expectedReplayed","expectedErrorCode","distinctProcessRoles"];
  if (STRENGTHENED_MUTATION_CONSUMERS.has(contract.consumerId)) oracleKeys.push("expectedAttemptFailures","expectedLockOrderByAttempt","expectedBeforeRows","expectedAfterRows","expectedLocatorProjection","expectedBeforeSha256","expectedAfterSha256");
  exactKeys(oracle, oracleKeys, `${evidence.scenarioKind}.oracle`);
  if (evidence.traces.length !== oracle.traceRoles.length) throw new Error(`${evidence.scenarioKind} trace cardinality drift`);
  const roles = evidence.traces.map(({ role }) => role).sort();
  if (JSON.stringify(roles) !== JSON.stringify([...oracle.traceRoles].sort())) throw new Error(`${evidence.scenarioKind} trace role drift`);
  const allowed = new Set(contract.allowedTables);
  for (const trace of evidence.traces) {
    const traceKeys = ["processId","moduleExecutionId","role","source","database","transactionAttempts","committedDmlStatements","committedRowCount","rolledBackAffectedRowCount","lockOrder","before","after","replayed","errorCode","externalNetworkCalls","replyCalls"];
    if (contract.consumerId === "sql-repository-4f896a4a6feb5ec1") traceKeys.push("locatorMode", "beforeSha256", "afterSha256");
    if (STRENGTHENED_MUTATION_CONSUMERS.has(contract.consumerId)) traceKeys.push("locatorProjection", "beforeRows", "afterRows", "beforeSha256", "afterSha256");
    exactKeys(trace, traceKeys, `${evidence.scenarioKind}/${trace.role}.trace`);
    exactKeys(trace.source, ["path","sha256","spanStart","spanEnd","spanSha256","catalogSpanStart","catalogSpanEnd","catalogSpanSha256","relocationDiffSha256"], `${evidence.scenarioKind}/${trace.role}.source`);
    exactKeys(trace.database, ["host","port","name"], `${evidence.scenarioKind}/${trace.role}.database`);
    if (JSON.stringify(trace.source) !== JSON.stringify(contract.source)) throw new Error(`${evidence.scenarioKind}/${trace.role} source provenance drift`);
    if (trace.database.host !== contract.database.host || trace.database.port === contract.database.forbiddenPort || !trace.database.name.startsWith(contract.database.namePrefix)) throw new Error(`${evidence.scenarioKind}/${trace.role} database isolation drift`);
    if (trace.externalNetworkCalls !== 0 || trace.replyCalls !== 0) throw new Error(`${evidence.scenarioKind}/${trace.role} external side effect detected`);
    if (!Number.isSafeInteger(trace.processId) || trace.processId <= 0 || !/^[0-9a-f-]{36}$/.test(trace.moduleExecutionId)) throw new Error(`${evidence.scenarioKind}/${trace.role} child identity invalid`);
    if (trace.transactionAttempts.length === 0 || trace.transactionAttempts.some((attempt, index) => attempt.attempt !== index + 1)) throw new Error(`${evidence.scenarioKind}/${trace.role} transaction attempt sequence drift`);
    for (const attempt of trace.transactionAttempts) {
      const attemptKeys = ["attempt","outcome","attemptedDmlStatements","affectedDmlStatements","affectedRowCount"];
      if (STRENGTHENED_MUTATION_CONSUMERS.has(contract.consumerId)) attemptKeys.push("lockOrder","failure");
      exactKeys(attempt, attemptKeys, `${evidence.scenarioKind}/${trace.role}.attempt`);
      for (const statement of [...attempt.attemptedDmlStatements, ...attempt.affectedDmlStatements]) if (!allowed.has(dmlTable(statement))) throw new Error(`${evidence.scenarioKind}/${trace.role} non-allowlisted DML table`);
      if (!Number.isSafeInteger(attempt.affectedRowCount) || attempt.affectedRowCount < 0 || attempt.affectedDmlStatements.length > attempt.attemptedDmlStatements.length) throw new Error(`${evidence.scenarioKind}/${trace.role} attempt DML accounting drift`);
    }
    for (const statement of trace.committedDmlStatements) if (!allowed.has(dmlTable(statement))) throw new Error(`${evidence.scenarioKind}/${trace.role} committed non-allowlisted DML table`);
    const committed = trace.transactionAttempts.filter(({ outcome }) => outcome === "COMMIT");
    const rolledBack = trace.transactionAttempts.filter(({ outcome }) => outcome === "ROLLBACK");
    const committedRows = committed.reduce((sum, attempt) => sum + attempt.affectedRowCount, 0);
    const rolledBackRows = rolledBack.reduce((sum, attempt) => sum + attempt.affectedRowCount, 0);
    if (!Number.isSafeInteger(trace.committedRowCount) || !Number.isSafeInteger(trace.rolledBackAffectedRowCount) || trace.committedRowCount !== committedRows || trace.rolledBackAffectedRowCount !== rolledBackRows) throw new Error(`${evidence.scenarioKind}/${trace.role} commit/rollback accounting drift`);
    const committedStatements = committed.flatMap(({ affectedDmlStatements }) => affectedDmlStatements);
    if (JSON.stringify(trace.committedDmlStatements) !== JSON.stringify(committedStatements)) throw new Error(`${evidence.scenarioKind}/${trace.role} committed statement projection drift`);
    assertPostState(trace.before, trace.before, contract.allowedTables, `${evidence.scenarioKind}/${trace.role}.before-shape`);
    assertPostState(trace.after, trace.after, contract.allowedTables, `${evidence.scenarioKind}/${trace.role}.after-shape`);
    if (contract.consumerId === "sql-repository-4f896a4a6feb5ec1") {
      if (trace.locatorMode !== "LEGACY_RAW" && trace.locatorMode !== "SHA256_OVERFLOW") throw new Error(`${evidence.scenarioKind}/${trace.role} locator mode drift`);
      const beforeSha256 = createHash("sha256").update(JSON.stringify(trace.before)).digest("hex");
      const afterSha256 = createHash("sha256").update(JSON.stringify(trace.after)).digest("hex");
      if (trace.beforeSha256 !== beforeSha256 || trace.afterSha256 !== afterSha256) throw new Error(`${evidence.scenarioKind}/${trace.role} state hash drift`);
    }
    if (STRENGTHENED_MUTATION_CONSUMERS.has(contract.consumerId)) {
      const projection = trace.locatorProjection;
      const locatorKey = projection?.key ?? (projection?.playerId && projection.idempotencyScope && projection.idempotencyKey
        ? { player_id: projection.playerId, idempotency_scope: projection.idempotencyScope, idempotency_key: projection.idempotencyKey }
        : undefined);
      if (projection?.mode !== "RAW_COMPOSITE" || locatorKey === undefined || Object.keys(locatorKey).length < 2 || Object.values(locatorKey).some((value) => value.length === 0) || projection.rows.length > 1 || projection.locatorOK !== true
        || projection.rows.some((row) => Object.entries(locatorKey).some(([key, value]) => row[key] !== value))) throw new Error(`${evidence.scenarioKind}/${trace.role} locator projection drift`);
      if (trace.beforeRows === undefined || trace.afterRows === undefined) throw new Error(`${evidence.scenarioKind}/${trace.role} exact row projection missing`);
      exactKeys(trace.beforeRows, contract.allowedTables, `${evidence.scenarioKind}/${trace.role}.beforeRows`);
      exactKeys(trace.afterRows, contract.allowedTables, `${evidence.scenarioKind}/${trace.role}.afterRows`);
      if (trace.beforeSha256 !== createHash("sha256").update(JSON.stringify(trace.beforeRows)).digest("hex") || trace.afterSha256 !== createHash("sha256").update(JSON.stringify(trace.afterRows)).digest("hex")) throw new Error(`${evidence.scenarioKind}/${trace.role} exact row hash drift`);
    }
  }
  const primary = evidence.traces.find(({ role }) => role === oracle.primaryRole);
  if (primary === undefined) throw new Error(`${evidence.scenarioKind} primary trace missing`);
  if (primary.transactionAttempts.length !== oracle.primaryTransactionAttempts || primary.transactionAttempts.at(-1)?.outcome !== oracle.primaryTransactionOutcome) throw new Error(`${evidence.scenarioKind} transaction oracle mismatch`);
  const primaryAttempt = primary.transactionAttempts.at(-1)!;
  if (JSON.stringify(primaryAttempt.attemptedDmlStatements.map(dmlTable)) !== JSON.stringify(oracle.expectedAttemptedDmlTableSequence)
    || JSON.stringify(primaryAttempt.affectedDmlStatements.map(dmlTable)) !== JSON.stringify(oracle.expectedAffectedDmlTableSequence)
    || JSON.stringify(primary.committedDmlStatements.map(dmlTable)) !== JSON.stringify(oracle.expectedDmlTableSequence)
    || JSON.stringify(primary.lockOrder) !== JSON.stringify(oracle.expectedLockOrder)
    || primary.committedRowCount !== oracle.expectedCommittedRowCount
    || primary.rolledBackAffectedRowCount !== oracle.expectedRolledBackAffectedRowCount) throw new Error(`${evidence.scenarioKind} DML oracle mismatch`);
  assertPostState(primary.before, oracle.expectedBefore, contract.allowedTables, `${evidence.scenarioKind}.before`);
  assertPostState(primary.after, oracle.expectedAfter, contract.allowedTables, `${evidence.scenarioKind}.after`);
  if (primary.replayed !== oracle.expectedReplayed || primary.errorCode !== oracle.expectedErrorCode) throw new Error(`${evidence.scenarioKind} result oracle mismatch`);
  if (STRENGTHENED_MUTATION_CONSUMERS.has(contract.consumerId)) {
    const strengthenedActual = { failures: primary.transactionAttempts.map(({ failure }) => failure), locks: primary.transactionAttempts.map(({ lockOrder }) => lockOrder), beforeRows: primary.beforeRows, afterRows: primary.afterRows, locator: primary.locatorProjection, beforeSha256: primary.beforeSha256, afterSha256: primary.afterSha256 };
    const strengthenedExpected = { failures: oracle.expectedAttemptFailures, locks: oracle.expectedLockOrderByAttempt, beforeRows: oracle.expectedBeforeRows, afterRows: oracle.expectedAfterRows, locator: oracle.expectedLocatorProjection, beforeSha256: oracle.expectedBeforeSha256, afterSha256: oracle.expectedAfterSha256 };
    if (JSON.stringify(strengthenedActual) !== JSON.stringify(strengthenedExpected)) throw new Error(`${evidence.scenarioKind} Wave22 strengthened oracle mismatch: ${JSON.stringify({ actual: strengthenedActual, expected: strengthenedExpected })}`);
  }
  const distinct = evidence.traces.filter(({ role }) => oracle.distinctProcessRoles.includes(role)).map(({ processId }) => processId);
  if (new Set(distinct).size !== distinct.length) throw new Error(`${evidence.scenarioKind} child process reuse detected`);
  const distinctModules = evidence.traces.filter(({ role }) => oracle.distinctProcessRoles.includes(role)).map(({ moduleExecutionId }) => moduleExecutionId);
  if (new Set(distinctModules).size !== distinctModules.length) throw new Error(`${evidence.scenarioKind} module execution reuse detected`);
  if (evidence.scenarioKind === "CONCURRENCY_SINGLE_WRITER") {
    const committedWriters = evidence.traces.filter((trace) => trace.committedRowCount > 0);
    const replays = evidence.traces.filter((trace) => trace.replayed === true && trace.committedRowCount === 0);
    if (committedWriters.length !== 1 || replays.length !== 1) throw new Error("CONCURRENCY_SINGLE_WRITER writer/replay cardinality drift");
    if (JSON.stringify(committedWriters[0]!.after) !== JSON.stringify(replays[0]!.after)) throw new Error("CONCURRENCY_SINGLE_WRITER post-state drift");
  }
  return { primary, processIds: evidence.traces.map(({ processId }) => processId) };
}

// fixture oracle만으로 영수증의 독립 기대 결과를 만듭니다.
export function projectObjectDbMutationOracleResult(oracle: ObjectDbMutationScenarioOracle): Record<string, unknown> {
  return {
    scenarioKind: oracle.scenarioKind,
    transactionOutcome: oracle.primaryTransactionOutcome,
    transactionAttempts: oracle.primaryTransactionAttempts,
    attemptedDmlCount: oracle.expectedAttemptedDmlTableSequence.length,
    affectedDmlCount: oracle.expectedAffectedDmlTableSequence.length,
    committedRowCount: oracle.expectedCommittedRowCount,
    rolledBackAffectedRowCount: oracle.expectedRolledBackAffectedRowCount,
    after: oracle.expectedAfter,
    replayed: oracle.expectedReplayed,
    errorCode: oracle.expectedErrorCode,
    processCount: oracle.traceRoles.length,
  };
}

// 검증된 실제 trace에서 oracle와 독립적인 실제 결과를 투영합니다.
export function projectObjectDbMutationActualResult(evidence: ObjectDbMutationScenarioEvidence, primary: ObjectDbMutationTrace): Record<string, unknown> {
  const attempt = primary.transactionAttempts.at(-1)!;
  return {
    scenarioKind: evidence.scenarioKind,
    transactionOutcome: attempt.outcome,
    transactionAttempts: primary.transactionAttempts.length,
    attemptedDmlCount: attempt.attemptedDmlStatements.length,
    affectedDmlCount: attempt.affectedDmlStatements.length,
    committedRowCount: primary.committedRowCount,
    rolledBackAffectedRowCount: primary.rolledBackAffectedRowCount,
    after: primary.after,
    replayed: primary.replayed,
    errorCode: primary.errorCode,
    processCount: evidence.traces.length,
  };
}
