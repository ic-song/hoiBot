export const OBJECT_DB_MUTATION_EVIDENCE_FORMAT = "hoibot-object-db-consumer-mutation-evidence-v1" as const;

export const OBJECT_DB_MUTATION_SCENARIOS = [
  "MUTATION_SUCCESS",
  "DOMAIN_FAILURE_ROLLBACK",
  "DUPLICATE_REPLAY_DML_ZERO",
  "PAYLOAD_DRIFT_FAIL_CLOSED",
  "RESTART_REPLAY",
  "CONCURRENCY_SINGLE_WRITER",
] as const;

export type ObjectDbMutationScenario = typeof OBJECT_DB_MUTATION_SCENARIOS[number];

export interface ObjectDbMutationPostState {
  object_identities: number;
  object_identity_crosswalks: number;
  canonical_package_definitions: number;
  canonical_package_definition_imports: number;
  canonical_package_reward_groups: number;
  canonical_package_reward_entries: number;
  canonical_package_item_rewards: number;
  canonical_package_nested_rewards: number;
  canonical_package_reward_quarantines: number;
  canonical_package_definition_replays: number;
}

export interface ObjectDbMutationTrace {
  processId: number;
  moduleExecutionId: string;
  role: "PRIMARY" | "SEED" | "REPLAY" | "CONCURRENT";
  source: { path: string; sha256: string; spanStart: number; spanEnd: number; spanSha256: string };
  database: { host: string; port: number; name: string };
  transactionAttempts: Array<{
    attempt: number;
    outcome: "COMMIT" | "ROLLBACK";
    attemptedDmlStatements: string[];
    affectedDmlStatements: string[];
    affectedRowCount: number;
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
}

export interface ObjectDbMutationEvidenceContract {
  format: typeof OBJECT_DB_MUTATION_EVIDENCE_FORMAT;
  consumerId: string;
  source: { path: string; sha256: string; spanStart: number; spanEnd: number; spanSha256: string };
  database: { host: "127.0.0.1"; forbiddenPort: 3306; namePrefix: string };
  allowedTables: string[];
  scenarios: ObjectDbMutationScenarioOracle[];
}

export interface ObjectDbMutationScenarioEvidence {
  scenarioKind: ObjectDbMutationScenario;
  traces: ObjectDbMutationTrace[];
}

const OBJECT_DB_MUTATION_POST_STATE_KEYS = [
  "object_identities", "object_identity_crosswalks", "canonical_package_definitions", "canonical_package_definition_imports",
  "canonical_package_reward_groups", "canonical_package_reward_entries", "canonical_package_item_rewards", "canonical_package_nested_rewards",
  "canonical_package_reward_quarantines", "canonical_package_definition_replays",
] as const;

const exactKeys = (value: object, expected: readonly string[], label: string): void => {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error(`${label} keys drift`);
};

const assertPostState = (actual: ObjectDbMutationPostState, expected: ObjectDbMutationPostState, label: string): void => {
  exactKeys(actual, OBJECT_DB_MUTATION_POST_STATE_KEYS, label);
  exactKeys(expected, OBJECT_DB_MUTATION_POST_STATE_KEYS, `${label}.oracle`);
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
  exactKeys(contract.source, ["path","sha256","spanStart","spanEnd","spanSha256"], "mutation contract source");
  exactKeys(contract.database, ["host","forbiddenPort","namePrefix"], "mutation contract database");
  exactKeys(evidence, ["scenarioKind","traces"], "mutation evidence");
  if (contract.format !== OBJECT_DB_MUTATION_EVIDENCE_FORMAT) throw new Error("mutation evidence format drift");
  if (!/^([0-9a-f]{64})$/.test(contract.source.sha256) || !/^([0-9a-f]{64})$/.test(contract.source.spanSha256)
    || !Number.isSafeInteger(contract.source.spanStart) || !Number.isSafeInteger(contract.source.spanEnd) || contract.source.spanStart < 0 || contract.source.spanEnd <= contract.source.spanStart) throw new Error("mutation source provenance invalid");
  if (contract.database.host !== "127.0.0.1" || contract.database.forbiddenPort !== 3306 || contract.database.namePrefix.length === 0) throw new Error("mutation database isolation contract invalid");
  if (new Set(contract.allowedTables).size !== contract.allowedTables.length || contract.allowedTables.length === 0) throw new Error("mutation allowed table set invalid");
  if (contract.scenarios.length !== OBJECT_DB_MUTATION_SCENARIOS.length || new Set(contract.scenarios.map(({ scenarioKind }) => scenarioKind)).size !== OBJECT_DB_MUTATION_SCENARIOS.length
    || OBJECT_DB_MUTATION_SCENARIOS.some((scenarioKind) => !contract.scenarios.some((candidate) => candidate.scenarioKind === scenarioKind))) throw new Error("mutation scenario oracle set drift");
  const oracle = contract.scenarios.find((candidate) => candidate.scenarioKind === evidence.scenarioKind);
  if (oracle === undefined) throw new Error(`mutation oracle missing: ${evidence.scenarioKind}`);
  exactKeys(oracle, ["scenarioKind","traceRoles","primaryRole","primaryTransactionOutcome","primaryTransactionAttempts","expectedAttemptedDmlTableSequence","expectedAffectedDmlTableSequence","expectedDmlTableSequence","expectedLockOrder","expectedCommittedRowCount","expectedRolledBackAffectedRowCount","expectedBefore","expectedAfter","expectedReplayed","expectedErrorCode","distinctProcessRoles"], `${evidence.scenarioKind}.oracle`);
  if (evidence.traces.length !== oracle.traceRoles.length) throw new Error(`${evidence.scenarioKind} trace cardinality drift`);
  const roles = evidence.traces.map(({ role }) => role).sort();
  if (JSON.stringify(roles) !== JSON.stringify([...oracle.traceRoles].sort())) throw new Error(`${evidence.scenarioKind} trace role drift`);
  const allowed = new Set(contract.allowedTables);
  for (const trace of evidence.traces) {
    exactKeys(trace, ["processId","moduleExecutionId","role","source","database","transactionAttempts","committedDmlStatements","committedRowCount","rolledBackAffectedRowCount","lockOrder","before","after","replayed","errorCode","externalNetworkCalls","replyCalls"], `${evidence.scenarioKind}/${trace.role}.trace`);
    exactKeys(trace.source, ["path","sha256","spanStart","spanEnd","spanSha256"], `${evidence.scenarioKind}/${trace.role}.source`);
    exactKeys(trace.database, ["host","port","name"], `${evidence.scenarioKind}/${trace.role}.database`);
    if (JSON.stringify(trace.source) !== JSON.stringify(contract.source)) throw new Error(`${evidence.scenarioKind}/${trace.role} source provenance drift`);
    if (trace.database.host !== contract.database.host || trace.database.port === contract.database.forbiddenPort || !trace.database.name.startsWith(contract.database.namePrefix)) throw new Error(`${evidence.scenarioKind}/${trace.role} database isolation drift`);
    if (trace.externalNetworkCalls !== 0 || trace.replyCalls !== 0) throw new Error(`${evidence.scenarioKind}/${trace.role} external side effect detected`);
    if (!Number.isSafeInteger(trace.processId) || trace.processId <= 0 || !/^[0-9a-f-]{36}$/.test(trace.moduleExecutionId)) throw new Error(`${evidence.scenarioKind}/${trace.role} child identity invalid`);
    if (trace.transactionAttempts.length === 0 || trace.transactionAttempts.some((attempt, index) => attempt.attempt !== index + 1)) throw new Error(`${evidence.scenarioKind}/${trace.role} transaction attempt sequence drift`);
    for (const attempt of trace.transactionAttempts) {
      exactKeys(attempt, ["attempt","outcome","attemptedDmlStatements","affectedDmlStatements","affectedRowCount"], `${evidence.scenarioKind}/${trace.role}.attempt`);
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
    assertPostState(trace.before, trace.before, `${evidence.scenarioKind}/${trace.role}.before-shape`);
    assertPostState(trace.after, trace.after, `${evidence.scenarioKind}/${trace.role}.after-shape`);
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
  assertPostState(primary.before, oracle.expectedBefore, `${evidence.scenarioKind}.before`);
  assertPostState(primary.after, oracle.expectedAfter, `${evidence.scenarioKind}.after`);
  if (primary.replayed !== oracle.expectedReplayed || primary.errorCode !== oracle.expectedErrorCode) throw new Error(`${evidence.scenarioKind} result oracle mismatch`);
  const distinct = evidence.traces.filter(({ role }) => oracle.distinctProcessRoles.includes(role)).map(({ processId }) => processId);
  if (new Set(distinct).size !== distinct.length) throw new Error(`${evidence.scenarioKind} child process reuse detected`);
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
