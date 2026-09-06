import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { canonicalizeObjectDbConsumerSourceText } from "./object-db-consumer-baseline.js";
import { predicateAcceptsRegistryCommand } from "./object-db-consumer-transition-audit.js";
import {
  createConsumerIdResolver,
  parseConsumerIdRegistry,
  type ConsumerIdRegistry,
  type StableConsumerIdentity,
} from "./object-db-consumer-id-registry.js";

export const OBJECT_DB_EXECUTABLE_PARITY_LEDGER_FORMAT = "hoibot-object-db-consumer-executable-parity-ledger-v1" as const;
export const OBJECT_DB_EXECUTABLE_PARITY_WAVE0_EVIDENCE_COMMIT = "f07021701d2f058531512b0e805dc0d9c4b2a3fb" as const;
const OBJECT_DB_PARITY_RUNNER = "NODE_OBJECT_DB_PARITY_V1" as const;
const OBJECT_DB_PARITY_HARNESS_PATH = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-harness.mjs" as const;
const OBJECT_DB_PARITY_WAVE1_TITLE_TARGET_PATH = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave1-title-list-owned.mjs" as const;
const OBJECT_DB_PARITY_WAVE2_COMPATIBILITY_TARGET_PATH = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave2-compatibility-resolver.mjs" as const;
const OBJECT_DB_PARITY_WAVE3_PLAYER_TARGET_PATH = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave3-player-target.mjs" as const;
const TRUSTED_WAVE1_TITLE_READS = {
  "sql-repository-0dc3c380c54081a2": { domain: "member", symbol: "member.listOwned", triggerOrPredicate: "SQL_METHOD:member:listOwned", interfaceId: "member-title.repository.maria-canonical-title-repository.member.listOwned", definitionTable: "canonical_member_title_definitions", definitionId: "member_title_id", ownershipTable: "canonical_owned_member_title_instances", ownedId: "owned_member_title_id", selectionTable: "canonical_member_title_selections" },
  "sql-repository-a0a5f5d8f3338d7b": { domain: "pet", symbol: "pet.listOwned", triggerOrPredicate: "SQL_METHOD:pet:listOwned", interfaceId: "pet-title.repository.maria-canonical-title-repository.pet.listOwned", definitionTable: "canonical_pet_title_definitions", definitionId: "pet_title_id", ownershipTable: "canonical_owned_pet_title_instances", ownedId: "owned_pet_title_id", selectionTable: "canonical_pet_title_selections" },
  "sql-repository-6a1bdfaafba10749": { domain: "mini_pet", symbol: "mini-pet.listOwned", triggerOrPredicate: "SQL_METHOD:mini-pet:listOwned", interfaceId: "mini-pet-title-collection.repository.maria-canonical-title-repository.mini-pet.listOwned", definitionTable: "canonical_mini_pet_title_definitions", definitionId: "mini_pet_title_id", ownershipTable: "canonical_owned_mini_pet_title_instances", ownedId: "owned_mini_pet_title_id", selectionTable: "canonical_mini_pet_title_selections" },
} as const;
const TRUSTED_WAVE2_COMPATIBILITY_READS = {
  "sql-repository-aa5b2d6d12d1268b": { method: "resolveLegacyObjectId", symbol: "resolveLegacyObjectId", triggerOrPredicate: "SQL_METHOD:resolveLegacyObjectId", interfaceId: "context-bridge.repository.object-catalog-compatibility-resolver.resolveLegacyObjectId", input: ["42", { expectedObjectType: "ITEM" }], negativeInput: ["0", { expectedObjectType: "ITEM" }], expectedQueryValues: ["42"], expectedGuardReason: "LEGACY_OBJECT_ID_INVALID", sqlSuffix: "WHERE registry.id = ?" },
  "sql-repository-fd1e8659cff045f9": { method: "resolveAlias", symbol: "resolveAlias", triggerOrPredicate: "SQL_METHOD:resolveAlias", interfaceId: "context-bridge.repository.object-catalog-compatibility-resolver.resolveAlias", input: ["ITEM", "legacy_name", "diamond-box", {}], negativeInput: ["ITEM", "invalid_alias_type", "diamond-box", {}], expectedQueryValues: ["ITEM", "legacy_name", "diamond-box"], expectedGuardReason: "LEGACY_OBJECT_ALIAS_INVALID", sqlSuffix: "JOIN object_aliases alias ON alias.object_id = registry.id AND alias.object_type = registry.object_type WHERE alias.object_type = ? AND alias.alias_type = ? AND alias.alias_value = ?" },
  "sql-repository-520566e376bf7ee8": { method: "resolveSource", symbol: "resolveSource", triggerOrPredicate: "SQL_METHOD:resolveSource", interfaceId: "context-bridge.repository.object-catalog-compatibility-resolver.resolveSource", input: [{ system: "LEGACY_JSON", table: "data/itemList.json", key: "diamond-box" }, { expectedObjectType: "ITEM" }], negativeInput: [{ system: "LEGACY_JSON", table: "not-allowlisted", key: "diamond-box" }, {}], expectedQueryValues: ["LEGACY_JSON", "data/itemList.json", "diamond-box"], expectedGuardReason: "LEGACY_OBJECT_SOURCE_INVALID", sqlSuffix: "JOIN object_source_bindings source ON source.object_id = registry.id AND source.object_type = registry.object_type WHERE source.source_system = ? AND source.source_table = ? AND source.source_key = ?" },
} as const;

export const OBJECT_DB_EXECUTABLE_PARITY_VERDICTS = [
  "STATIC_ONLY",
  "BLOCKED_DYNAMIC",
  "BLOCKED_REGISTRY_MISMATCH",
  "PARTIAL",
  "DIRECT_PASS",
  "EQUIVALENT_PASS",
] as const;

export type ObjectDbExecutableParityVerdict = typeof OBJECT_DB_EXECUTABLE_PARITY_VERDICTS[number];
export type ConsumerAccess = "READ" | "WRITE" | "READ_WRITE";
export type AccessClass = "READ" | "MUTATION";

type NullableHash = string | null;

export type ExpectedActualHash = {
  expectedSha256: NullableHash;
  actualSha256: NullableHash;
  match: boolean | null;
};

export type ExpectedActualSequence = {
  expected: string[] | null;
  actual: string[] | null;
  match: boolean | null;
};

export type ExpectedActualDml = ExpectedActualHash & {
  expectedNormalizedStatements: string[] | null;
  actualNormalizedStatements: string[] | null;
  expectedRowCount: number | null;
  actualRowCount: number | null;
};

export type ExpectedActualTransaction = {
  expected: "READ_ONLY" | "COMMIT" | "ROLLBACK" | null;
  actual: "READ_ONLY" | "COMMIT" | "ROLLBACK" | null;
  match: boolean | null;
  expectedTimeline: string[] | null;
  actualTimeline: string[] | null;
};

export type ExpectedActualEvidence = {
  reply: ExpectedActualHash;
  result: ExpectedActualHash;
  dml: ExpectedActualDml;
  lockOrder: ExpectedActualSequence;
  transaction: ExpectedActualTransaction;
};

export type ParityScenario = {
  receiptId: string;
  scenarioId: string;
  scenarioKind: ObjectDbParityScenarioKind;
  harnessCaseId: string;
  attributedConsumerIds: string[];
  expectedActual: ExpectedActualEvidence;
};

export const OBJECT_DB_PARITY_READ_SCENARIOS = [
  "READ_POSITIVE",
  "NEGATIVE_GUARD",
  "AUTH_DENIED",
  "WRONG_ROOM_REJECTED",
  "EXACT_OUTPUT",
  "SOURCE_DOMAIN_DML_ZERO",
  "RESTART_CONSISTENCY",
] as const;

export const OBJECT_DB_PARITY_MUTATION_SCENARIOS = [
  "MUTATION_SUCCESS",
  "DOMAIN_FAILURE_ROLLBACK",
  "DUPLICATE_REPLAY_DML_ZERO",
  "PAYLOAD_DRIFT_FAIL_CLOSED",
  "RESTART_REPLAY",
  "CONCURRENCY_SINGLE_WRITER",
  "AUTH_DENIED",
  "WRONG_ROOM_REJECTED",
] as const;

export type ObjectDbParityScenarioKind = typeof OBJECT_DB_PARITY_READ_SCENARIOS[number] | typeof OBJECT_DB_PARITY_MUTATION_SCENARIOS[number];

export type ScenarioRequirement = {
  scenarioKind: ObjectDbParityScenarioKind;
  disposition: "REQUIRED" | "NOT_APPLICABLE";
  notApplicable: null | {
    ruleId: "SOURCE_CLASSIFICATION_HAS_NO_AUTH_GUARD_V1" | "SOURCE_CLASSIFICATION_HAS_NO_ROOM_GUARD_V1";
    reasonCode: "NO_AUTH_GUARD" | "NO_ROOM_GUARD";
    reason: string;
    sourceEvidenceSha256: string;
  };
};

export type ParityHarness = {
  harnessId: string | null;
  runner: string | null;
  path: string | null;
  sha256: NullableHash;
};

export type ParityFixture = {
  fixtureId: string | null;
  path: string | null;
  sha256: NullableHash;
};

export type ParityInvocation = {
  targetPath: string | null;
  targetSourceSha256: NullableHash;
  exportName: string | null;
};

export type ParityEvidence = {
  evidenceIds: string[];
  attributedConsumerIds: string[];
  hashes: Array<{ path: string; sha256: string }>;
};

export type MechanicalEquivalenceRule = {
  ruleId: "SAME_INTERFACE_ACCESS_V1";
  ruleVersion: "1";
  mechanical: true;
  equivalenceKey: string;
  variantConsumerIds: string[];
};

export type ObjectDbConsumerExecutionReceipt = {
  receiptId: string;
  consumerId: string;
  proofMode: "DIRECT" | "EQUIVALENT";
  harness: { harnessId: string; harnessCaseId: string; runner: string; path: string; sourceSha256: string };
  fixture: { fixtureId: string; path: string; sha256: string };
  invocation: { targetPath: string; targetSourceSha256: string; exportName: string };
  scenario: { scenarioId: string; scenarioKind: ObjectDbParityScenarioKind };
  expectedActual: ExpectedActualEvidence;
  equivalenceRule: MechanicalEquivalenceRule | null;
  verdict: "PASS";
  receiptSha256: string;
};

export type ObjectDbConsumerExecutionReceiptBundle = {
  format: "hoibot-object-db-consumer-execution-receipts-v1";
  catalogVersion: "SC-20260902-1";
  classificationBaseCommit: string;
  evidenceCommit: string;
  receipts: ObjectDbConsumerExecutionReceipt[];
};

export type ConsumerManifestInput = {
  format: "hoibot-object-db-consumer-manifest-v1";
  baseCommit: string;
  sourceTextNormalization: "CRLF_AND_CR_TO_LF_BEFORE_SPAN_AND_HASH";
  consumerSetSha256: string;
  consumers: Array<StableConsumerIdentity & {
    consumerId: string;
    access: ConsumerAccess;
    interfaceId: string;
    unresolvedDynamicCallCount: number;
    sourceSpan: { start: number; end: number; sha256: string };
  }>;
  audit: {
    registrySourceMismatchCount: number;
    registrySourceMismatches: string[];
  };
};

export type ExecutableParityLedgerEntry = {
  consumerId: string;
  classification: {
    kind: string;
    file: string;
    symbol: string;
    triggerOrPredicate: string;
    access: ConsumerAccess;
    accessClass: AccessClass;
    interfaceId: string;
    unresolvedDynamicCallCount: number;
    registrySourceMismatchLabels: string[];
    sourceSpanSha256: string;
    classificationSha256: string;
  };
  verdict: ObjectDbExecutableParityVerdict;
  harness: ParityHarness;
  fixture: ParityFixture;
  invocation: ParityInvocation;
  scenarioRequirements: ScenarioRequirement[];
  scenarios: ParityScenario[];
  evidence: ParityEvidence;
  equivalenceRule: MechanicalEquivalenceRule | null;
};

export type ExecutableParityCoverage = {
  manifestConsumers: number;
  ledgerEntries: number;
  missingConsumerIds: number;
  duplicateConsumerIds: number;
  unknownConsumerIds: number;
  readConsumers: number;
  mutationConsumers: number;
  unresolvedDynamicConsumers: number;
  unresolvedDynamicCallCount: number;
  registrySourceMismatchCount: number;
  registrySourceMismatchAttributedCount: number;
  registrySourceMismatchUnattributedCount: number;
  provenConsumers: number;
  unprovenConsumers: number;
  directPassConsumers: number;
  equivalentPassConsumers: number;
  verdicts: Record<ObjectDbExecutableParityVerdict, number>;
};

export type ExecutableParityLedger = {
  format: typeof OBJECT_DB_EXECUTABLE_PARITY_LEDGER_FORMAT;
  catalogVersion: "SC-20260902-1";
  classificationBaseCommit: string;
  evidenceCommit: string;
  sourceTextNormalization: "CRLF_AND_CR_TO_LF_BEFORE_HASH";
  sources: {
    ledgerSchema: { path: string; sha256: string };
    executionReceiptSchema: { path: string; sha256: string };
    consumerManifest: { path: string; sha256: string; consumerSetSha256: string };
    consumerIdRegistry: { path: string; sha256: string };
    transitionContract: { path: string; sha256: string };
    executionReceipts: { path: string; sha256: string };
    classificationSources: Array<{ path: string; sha256: string }>;
  };
  registrySourceMismatchResolution: {
    bindings: Array<{ registrySourceMismatch: string; consumerId: string; sourceSpanSha256: string }>;
    unattributed: string[];
  };
  coverage: ExecutableParityCoverage;
  entries: ExecutableParityLedgerEntry[];
  entrySetSha256: string;
};

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const CONSUMER_ID_PATTERN = /^(?:legacy|automatic-callback|runtime-dispatch|admin-command|http-web-route|app-wiring|sql-repository)-[a-f0-9]{16}$/;
const VERDICTS = new Set<string>(OBJECT_DB_EXECUTABLE_PARITY_VERDICTS);
const PASS_VERDICTS = new Set<ObjectDbExecutableParityVerdict>(["DIRECT_PASS", "EQUIVALENT_PASS"]);

export function sha256CanonicalText(value: string): string {
  return createHash("sha256").update(canonicalizeObjectDbConsumerSourceText(value)).digest("hex");
}

export function sha256CanonicalJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function deriveSameInterfaceAccessEquivalenceKey(classification: Pick<ExecutableParityLedgerEntry["classification"], "interfaceId" | "accessClass">): string {
  return sha256CanonicalJson({
    ruleId: "SAME_INTERFACE_ACCESS_V1",
    interfaceId: classification.interfaceId,
    accessClass: classification.accessClass,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} keys drift: expected=${expected.join(",")} actual=${actual.join(",")}`);
}

function assertHash(value: unknown, label: string, nullable = false): asserts value is string | null {
  if (nullable && value === null) return;
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) throw new Error(`${label} must be sha256`);
}

function assertCommit(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !COMMIT_PATTERN.test(value)) throw new Error(`${label} must be a 40-character commit`);
}

function assertSortedUniqueStrings(values: unknown, label: string, allowEmpty = true): asserts values is string[] {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || value.length === 0)) throw new Error(`${label} must be string[]`);
  if (!allowEmpty && values.length === 0) throw new Error(`${label} must not be empty`);
  if (new Set(values).size !== values.length) throw new Error(`${label} contains duplicates`);
  if (values.some((value, index) => index > 0 && values[index - 1]! > value)) throw new Error(`${label} must be sorted`);
}

function assertUniqueStrings(values: unknown, label: string): asserts values is string[] {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || value.length === 0)) throw new Error(`${label} must be string[]`);
  if (new Set(values).size !== values.length) throw new Error(`${label} contains duplicates`);
}

function assertStringArray(values: unknown, label: string): asserts values is string[] {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || value.length === 0)) throw new Error(`${label} must be string[]`);
}

function emptyExpectedActual(): ExpectedActualEvidence {
  return {
    reply: { expectedSha256: null, actualSha256: null, match: null },
    result: { expectedSha256: null, actualSha256: null, match: null },
    dml: { expectedSha256: null, actualSha256: null, match: null, expectedNormalizedStatements: null, actualNormalizedStatements: null, expectedRowCount: null, actualRowCount: null },
    lockOrder: { expected: null, actual: null, match: null },
    transaction: { expected: null, actual: null, match: null, expectedTimeline: null, actualTimeline: null },
  };
}

function emptyExecutionEvidence(scenarioRequirements: ScenarioRequirement[]): Pick<ExecutableParityLedgerEntry, "harness" | "fixture" | "invocation" | "scenarioRequirements" | "scenarios" | "evidence" | "equivalenceRule"> {
  return {
    harness: { harnessId: null, runner: null, path: null, sha256: null },
    fixture: { fixtureId: null, path: null, sha256: null },
    invocation: { targetPath: null, targetSourceSha256: null, exportName: null },
    scenarioRequirements,
    scenarios: [],
    evidence: { evidenceIds: [], attributedConsumerIds: [], hashes: [] },
    equivalenceRule: null,
  };
}

function classificationProjection(consumer: ConsumerManifestInput["consumers"][number], registrySourceMismatchLabels: string[] = []): ExecutableParityLedgerEntry["classification"] {
  const projection = {
    kind: consumer.kind,
    file: consumer.file,
    symbol: consumer.symbol,
    triggerOrPredicate: consumer.triggerOrPredicate,
    access: consumer.access,
    accessClass: consumer.access === "READ" ? "READ" as const : "MUTATION" as const,
    interfaceId: consumer.interfaceId,
    unresolvedDynamicCallCount: consumer.unresolvedDynamicCallCount,
    registrySourceMismatchLabels: registrySourceMismatchLabels.slice().sort(),
    sourceSpanSha256: consumer.sourceSpan.sha256,
  };
  return { ...projection, classificationSha256: sha256CanonicalJson(projection) };
}

function baselineVerdict(consumer: ConsumerManifestInput["consumers"][number], registrySourceMismatchLabels: string[]): ObjectDbExecutableParityVerdict {
  if (registrySourceMismatchLabels.length > 0) return "BLOCKED_REGISTRY_MISMATCH";
  return consumer.unresolvedDynamicCallCount > 0 ? "BLOCKED_DYNAMIC" : "STATIC_ONLY";
}

function sourceClassificationHasAuthGuard(consumer: ConsumerManifestInput["consumers"][number]): boolean {
  const source = `${consumer.kind}|${consumer.triggerOrPredicate}|${consumer.symbol}|${consumer.interfaceId}`;
  return consumer.kind === "ADMIN_COMMAND" || /(?:^|[_.:/|-])admin(?:$|[_.:/|-])|auth|permission|role|isMaster|isAdmin|operator/i.test(source);
}

function sourceClassificationHasRoomGuard(consumer: ConsumerManifestInput["consumers"][number]): boolean {
  const source = `${consumer.triggerOrPredicate}|${consumer.symbol}|${consumer.interfaceId}`;
  return /room|channel|isGroupChat|operational/i.test(source);
}

function scenarioRequirementsFor(consumer: ConsumerManifestInput["consumers"][number], classificationSha256: string): ScenarioRequirement[] {
  const accessClass: AccessClass = consumer.access === "READ" ? "READ" : "MUTATION";
  const kinds = accessClass === "READ" ? OBJECT_DB_PARITY_READ_SCENARIOS : OBJECT_DB_PARITY_MUTATION_SCENARIOS;
  const authRequired = sourceClassificationHasAuthGuard(consumer);
  const roomRequired = sourceClassificationHasRoomGuard(consumer);
  return kinds.map((scenarioKind): ScenarioRequirement => {
    if (scenarioKind === "AUTH_DENIED" && !authRequired) return {
      scenarioKind,
      disposition: "NOT_APPLICABLE",
      notApplicable: {
        ruleId: "SOURCE_CLASSIFICATION_HAS_NO_AUTH_GUARD_V1",
        reasonCode: "NO_AUTH_GUARD",
        reason: "Frozen consumer classification contains no authentication or authorization guard.",
        sourceEvidenceSha256: classificationSha256,
      },
    };
    if (scenarioKind === "WRONG_ROOM_REJECTED" && !roomRequired) return {
      scenarioKind,
      disposition: "NOT_APPLICABLE",
      notApplicable: {
        ruleId: "SOURCE_CLASSIFICATION_HAS_NO_ROOM_GUARD_V1",
        reasonCode: "NO_ROOM_GUARD",
        reason: "Frozen consumer classification contains no room or channel guard.",
        sourceEvidenceSha256: classificationSha256,
      },
    };
    return { scenarioKind, disposition: "REQUIRED", notApplicable: null };
  });
}

function assertRepoRelativeEvidencePath(path: string, label: string): void {
  if (path.includes("\\") || path.startsWith("/") || /^[A-Za-z]:/.test(path) || path.split("/").includes("..")) throw new Error(`${label} must be a repo-relative POSIX path`);
}

export function parseObjectDbConsumerExecutionReceiptBundle(value: unknown): ObjectDbConsumerExecutionReceiptBundle {
  if (!isRecord(value)) throw new Error("execution receipt bundle must be an object");
  assertExactKeys(value, ["format", "catalogVersion", "classificationBaseCommit", "evidenceCommit", "receipts"], "execution receipt bundle");
  if (value.format !== "hoibot-object-db-consumer-execution-receipts-v1") throw new Error("unsupported execution receipt bundle format");
  if (value.catalogVersion !== "SC-20260902-1") throw new Error("unsupported execution receipt bundle catalogVersion");
  assertCommit(value.classificationBaseCommit, "execution receipt bundle classificationBaseCommit");
  assertCommit(value.evidenceCommit, "execution receipt bundle evidenceCommit");
  if (!Array.isArray(value.receipts)) throw new Error("execution receipt bundle receipts must be an array");
  return value as unknown as ObjectDbConsumerExecutionReceiptBundle;
}

export function listObjectDbExecutableParityEvidencePaths(executionReceiptsText: string): string[] {
  const bundle = parseObjectDbConsumerExecutionReceiptBundle(JSON.parse(canonicalizeObjectDbConsumerSourceText(executionReceiptsText)));
  const paths = new Set<string>();
  for (const receipt of bundle.receipts) {
    for (const path of [receipt.harness?.path, receipt.fixture?.path, receipt.invocation?.targetPath]) {
      if (path === null || path === undefined) continue;
      if (typeof path !== "string" || path.length === 0) throw new Error("evidence path invalid");
      assertRepoRelativeEvidencePath(path, "evidence path");
      paths.add(path);
    }
  }
  return [...paths].sort();
}

function receiptFingerprint(receipt: ObjectDbConsumerExecutionReceipt): string {
  const { receiptSha256: _receiptSha256, ...payload } = receipt;
  return sha256CanonicalJson(payload);
}

function receiptBinding(receipt: ObjectDbConsumerExecutionReceipt): Record<string, string> {
  return {
    consumerId: receipt.consumerId,
    harnessId: receipt.harness.harnessId,
    harnessCaseId: receipt.harness.harnessCaseId,
    fixtureId: receipt.fixture.fixtureId,
    scenarioId: receipt.scenario.scenarioId,
    scenarioKind: receipt.scenario.scenarioKind,
  };
}

function normalizedDmlFingerprint(statements: string[], rowCount: number): string {
  return sha256CanonicalJson({ normalizedStatements: statements, rowCount });
}

function resolveEvidenceFile(path: string, expectedText: string): string {
  let cursor = process.cwd();
  for (;;) {
    const candidate = resolve(cursor, path);
    if (existsSync(candidate)) {
      if (sha256CanonicalText(readFileSync(candidate, "utf8")) !== sha256CanonicalText(expectedText)) throw new Error(`on-disk invocation source hash drift: ${path}`);
      return candidate;
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  throw new Error(`allowlisted runner entrypoint is not present on disk: ${path}`);
}

function sha256Raw(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function gitRepositoryRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
}

function readCommitBlob(repositoryRoot: string, commit: string, path: string): string {
  try {
    return execFileSync("git", ["-c", "core.longpaths=true", "show", `${commit}:${path}`], { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  } catch {
    throw new Error(`evidenceCommit does not contain trusted input: ${path}`);
  }
}

function assertEvidenceCommitAncestry(repositoryRoot: string, evidenceCommit: string): void {
  try { execFileSync("git", ["cat-file", "-e", `${evidenceCommit}^{commit}`], { cwd: repositoryRoot, stdio: "ignore" }); }
  catch { throw new Error(`evidenceCommit does not exist: ${evidenceCommit}`); }
  try { execFileSync("git", ["merge-base", "--is-ancestor", evidenceCommit, "HEAD"], { cwd: repositoryRoot, stdio: "ignore" }); }
  catch { throw new Error(`evidenceCommit is not an ancestor of current HEAD: ${evidenceCommit}`); }
}

export function assertTrustedWave1ConsumerFixtureMapping(
  consumerId: string,
  consumer: Record<string, unknown>,
  manifestConsumer: ConsumerManifestInput["consumers"][number],
): void {
  const trusted = TRUSTED_WAVE1_TITLE_READS[consumerId as keyof typeof TRUSTED_WAVE1_TITLE_READS];
  if (trusted === undefined) return;
  const locator = consumer.sourceLocator as Record<string, unknown> | undefined;
  const trustedConfig = consumer.trustedConfig as Record<string, unknown> | undefined;
  const input = consumer.input as Record<string, unknown> | undefined;
  const negativeInput = consumer.negativeInput as Record<string, unknown> | undefined;
  if (locator === undefined || trustedConfig === undefined || input === undefined || negativeInput === undefined) throw new Error(`${consumerId} trusted Wave1 locator/config/input missing`);
  const exactLocator = { file: manifestConsumer.file, symbol: manifestConsumer.symbol, triggerOrPredicate: manifestConsumer.triggerOrPredicate, interfaceId: manifestConsumer.interfaceId, start: manifestConsumer.sourceSpan.start, end: manifestConsumer.sourceSpan.end, sha256: manifestConsumer.sourceSpan.sha256 };
  if (JSON.stringify(locator) !== JSON.stringify(exactLocator)) throw new Error(`${consumerId} exact manifest locator drift`);
  if (locator.symbol !== trusted.symbol || locator.triggerOrPredicate !== trusted.triggerOrPredicate || locator.interfaceId !== trusted.interfaceId) throw new Error(`${consumerId} trusted symbol/trigger/interface drift`);
  const exactTrustedConfig = { domain: trusted.domain, definitionTable: trusted.definitionTable, definitionId: trusted.definitionId, ownershipTable: trusted.ownershipTable, ownedId: trusted.ownedId, selectionTable: trusted.selectionTable };
  if (JSON.stringify(trustedConfig) !== JSON.stringify(exactTrustedConfig) || input.domain !== trusted.domain || negativeInput.domain !== trusted.domain || input.playerId !== "player01") throw new Error(`${consumerId} trusted domain/table/ID config drift`);
  const assertions = consumer.assertions as unknown;
  if (!Array.isArray(assertions) || JSON.stringify(assertions) !== JSON.stringify([trusted.ownershipTable, trusted.definitionTable, trusted.selectionTable, "owned.player_id=?", "owned.ownership_status='owned'", `ORDER BY owned.acquisition_sequence,owned.${trusted.ownedId}`])) throw new Error(`${consumerId} exact SQL semantics assertion drift`);
  const expectedSql = consumer.expectedNormalizedSql;
  for (const token of [trusted.ownershipTable, trusted.definitionTable, trusted.selectionTable, `definition_row.${trusted.definitionId}=owned.${trusted.definitionId}`, `selection_row.${trusted.ownedId}=owned.${trusted.ownedId}`, "owned.player_id=?", "owned.ownership_status='owned'", `ORDER BY owned.acquisition_sequence,owned.${trusted.ownedId}`]) if (typeof expectedSql !== "string" || !expectedSql.includes(token)) throw new Error(`${consumerId} exact normalized SQL/AST semantics drift`);
}

export function assertTrustedWave2ConsumerFixtureMapping(
  consumerId: string,
  consumer: Record<string, unknown>,
  manifestConsumer: ConsumerManifestInput["consumers"][number],
): void {
  const trusted = TRUSTED_WAVE2_COMPATIBILITY_READS[consumerId as keyof typeof TRUSTED_WAVE2_COMPATIBILITY_READS];
  if (trusted === undefined) return;
  const locator = consumer.sourceLocator as Record<string, unknown> | undefined;
  if (locator === undefined || consumer.consumerId !== consumerId) throw new Error(`${consumerId} trusted Wave2 source locator/consumer binding missing`);
  const exactLocator = { file: manifestConsumer.file, symbol: manifestConsumer.symbol, triggerOrPredicate: manifestConsumer.triggerOrPredicate, interfaceId: manifestConsumer.interfaceId, start: manifestConsumer.sourceSpan.start, end: manifestConsumer.sourceSpan.end, sha256: manifestConsumer.sourceSpan.sha256 };
  if (JSON.stringify(locator) !== JSON.stringify(exactLocator)) throw new Error(`${consumerId} exact manifest locator drift`);
  if (locator.symbol !== trusted.symbol || locator.triggerOrPredicate !== trusted.triggerOrPredicate || locator.interfaceId !== trusted.interfaceId || consumer.method !== trusted.method) throw new Error(`${consumerId} trusted Wave2 method/symbol/trigger/interface drift`);
  if (JSON.stringify(consumer.input) !== JSON.stringify(trusted.input) || JSON.stringify(consumer.negativeInput) !== JSON.stringify(trusted.negativeInput) || JSON.stringify(consumer.expectedQueryValues) !== JSON.stringify(trusted.expectedQueryValues) || consumer.expectedGuardReason !== trusted.expectedGuardReason) throw new Error(`${consumerId} trusted Wave2 input/guard drift`);
  if (consumer.databaseRowShape !== "legacy-object-row" || !Array.isArray(consumer.mockRows) || consumer.mockRows.length !== 1) throw new Error(`${consumerId} trusted Wave2 database row contract drift`);
  const assertions = consumer.assertions;
  if (!Array.isArray(assertions) || JSON.stringify(assertions) !== JSON.stringify(["object_registry registry", "object_identity_crosswalks crosswalk", "crosswalk.source_system = 'LEGACY_DB'", "crosswalk.source_namespace = 'object_registry.id'"])) throw new Error(`${consumerId} exact SQL semantics assertion drift`);
  const expectedSql = consumer.expectedNormalizedSql;
  if (typeof expectedSql !== "string") throw new Error(`${consumerId} exact normalized SQL semantics drift`);
  const sqlPrefix = "SELECT registry.id legacy_object_id,registry.object_key legacy_object_key,registry.object_type,crosswalk.object_identity_id FROM object_registry registry LEFT JOIN object_identity_crosswalks crosswalk ON crosswalk.source_system = 'LEGACY_DB' AND crosswalk.source_namespace = 'object_registry.id' AND crosswalk.source_identifier = CAST(registry.id AS CHAR) ";
  if (expectedSql !== sqlPrefix + trusted.sqlSuffix) throw new Error(`${consumerId} exact normalized SQL semantics drift`);
  for (const token of assertions) if (typeof token !== "string" || !expectedSql.includes(token)) throw new Error(`${consumerId} exact normalized SQL semantics drift`);
  const expectedMock = [{ legacyObjectId: "42", legacyObjectKey: "diamond-box", objectType: "ITEM", canonicalObjectIdentityId: "objid001" }];
  const expectedRow = { status: "RESOLVED", canonicalObjectIdentityId: "objid001", legacyObjectId: "42", legacyObjectKey: "diamond-box", objectType: "ITEM", quarantineReason: null };
  if (JSON.stringify(consumer.mockRows) !== JSON.stringify(expectedMock) || JSON.stringify(consumer.expectedRow) !== JSON.stringify(expectedRow)) throw new Error(`${consumerId} trusted Wave2 result fixture drift`);
}

export function assertTrustedWave3ConsumerFixtureMapping(
  consumerId: string,
  consumer: Record<string, unknown>,
  manifestConsumer: ConsumerManifestInput["consumers"][number],
): void {
  if (consumerId !== "sql-repository-261eb97022941f77") return;
  const locator = consumer.sourceLocator as Record<string, unknown> | undefined;
  const exactLocator = { file: manifestConsumer.file, symbol: manifestConsumer.symbol, triggerOrPredicate: manifestConsumer.triggerOrPredicate, interfaceId: manifestConsumer.interfaceId, start: manifestConsumer.sourceSpan.start, end: manifestConsumer.sourceSpan.end, sha256: manifestConsumer.sourceSpan.sha256 };
  const input = consumer.input as Record<string, unknown> | undefined;
  const queryValues = consumer.expectedQueryValues as unknown[] | undefined;
  const mockRows = consumer.mockRows as Array<Record<string, unknown>> | undefined;
  if (input === undefined || queryValues === undefined || mockRows === undefined || input.targetKey !== queryValues[0] || input.targetKey !== mockRows[0]?.displayName) throw new Error(`${consumerId} trusted Wave3 lookup/row equality drift`);
  if (locator === undefined || JSON.stringify(locator) !== JSON.stringify(exactLocator) || consumer.consumerId !== consumerId || JSON.stringify(consumer.input) !== JSON.stringify({ targetKey: "대상유저" }) || JSON.stringify(consumer.negativeInput) !== JSON.stringify({ targetKey: "" }) || JSON.stringify(consumer.expectedQueryValues) !== JSON.stringify(["대상유저"]) || consumer.expectedGuardError !== "PLAYER_CONTEXT_TARGET_INVALID" || consumer.databaseRowShape !== "player-target-row") throw new Error(`${consumerId} trusted Wave3 fixture drift`);
  if (typeof consumer.expectedNormalizedSql !== "string" || sha256CanonicalText(consumer.expectedNormalizedSql) !== "40c9e38957fa73a1295859c7d8a3c096c8512b18b350c4797fed07fa86b68199" || JSON.stringify(consumer.mockRows) !== JSON.stringify([{ legacyPlayerId: "42", canonicalPlayerId: "player01", externalIdentityId: "7", displayName: "대상유저", rankEmoji: "🏆", providerCode: "kakao" }]) || JSON.stringify(consumer.expectedRow) !== JSON.stringify({ canonicalPlayerId: "player01", legacyPlayerId: "42", displayName: "대상유저", rankEmoji: "🏆" })) throw new Error(`${consumerId} trusted Wave3 SQL/result drift`);
}

function assertTrustedWave1FixtureBinding(
  receipt: ObjectDbConsumerExecutionReceipt,
  fixtureText: string,
  manifestConsumer: ConsumerManifestInput["consumers"][number],
  repositoryRoot: string,
  evidenceCommit: string,
): void {
  const trusted = TRUSTED_WAVE1_TITLE_READS[receipt.consumerId as keyof typeof TRUSTED_WAVE1_TITLE_READS];
  if (trusted === undefined) {
    const wave2 = TRUSTED_WAVE2_COMPATIBILITY_READS[receipt.consumerId as keyof typeof TRUSTED_WAVE2_COMPATIBILITY_READS];
    if (wave2 === undefined) {
      if (receipt.consumerId !== "sql-repository-261eb97022941f77") return;
      if (receipt.invocation.targetPath !== OBJECT_DB_PARITY_WAVE3_PLAYER_TARGET_PATH || receipt.invocation.exportName !== "executeWave3PlayerTarget") throw new Error(`${receipt.receiptId} trusted Wave3 invocation target drift`);
      const fixture = JSON.parse(canonicalizeObjectDbConsumerSourceText(fixtureText)) as { payload?: { cases?: Array<{ caseId?: string; executablePath?: string; transactionPath?: string; consumers?: Array<Record<string, unknown>> }> } };
      const parityCase = fixture.payload?.cases?.find(({ caseId }) => caseId === receipt.harness.harnessCaseId);
      const consumer = parityCase?.consumers?.find((candidate) => candidate.consumerId === receipt.consumerId);
      if (parityCase?.executablePath !== "MariaPlayerContextProvider.resolveUniqueLegacyDisplayTarget" || parityCase.transactionPath !== "DatabaseClient.query:READ_ONLY" || consumer === undefined) throw new Error(`${receipt.receiptId} trusted Wave3 case/path binding drift`);
      const locator = consumer.sourceLocator as Record<string, unknown>;
      assertTrustedWave3ConsumerFixtureMapping(receipt.consumerId, consumer, manifestConsumer);
      const sourceBlob = readCommitBlob(repositoryRoot, evidenceCommit, locator.file as string);
      if (sha256CanonicalText(canonicalizeObjectDbConsumerSourceText(sourceBlob).slice(locator.start as number, locator.end as number)) !== locator.sha256) throw new Error(`${receipt.receiptId} evidenceCommit source span hash drift`);
      return;
    }
    if (receipt.invocation.targetPath !== OBJECT_DB_PARITY_WAVE2_COMPATIBILITY_TARGET_PATH || receipt.invocation.exportName !== "executeWave2CompatibilityResolver") throw new Error(`${receipt.receiptId} trusted Wave2 invocation target drift`);
    const fixture = JSON.parse(canonicalizeObjectDbConsumerSourceText(fixtureText)) as { payload?: { cases?: Array<{ caseId?: string; executablePath?: string; transactionPath?: string; consumers?: Array<Record<string, unknown>> }> } };
    const parityCase = fixture.payload?.cases?.find(({ caseId }) => caseId === receipt.harness.harnessCaseId);
    const consumer = parityCase?.consumers?.find((candidate) => candidate.consumerId === receipt.consumerId);
    if (parityCase?.executablePath !== "ObjectCatalogCompatibilityResolver" || parityCase.transactionPath !== "DatabaseClient.query:READ_ONLY" || consumer === undefined) throw new Error(`${receipt.receiptId} trusted Wave2 case/path binding drift`);
    assertTrustedWave2ConsumerFixtureMapping(receipt.consumerId, consumer, manifestConsumer);
    const locator = consumer.sourceLocator as Record<string, unknown>;
    const sourceBlob = readCommitBlob(repositoryRoot, evidenceCommit, locator.file as string);
    const sourceSpan = canonicalizeObjectDbConsumerSourceText(sourceBlob).slice(locator.start as number, locator.end as number);
    if (sha256CanonicalText(sourceSpan) !== locator.sha256) throw new Error(`${receipt.receiptId} evidenceCommit source span hash drift`);
    return;
  }
  if (receipt.invocation.targetPath !== OBJECT_DB_PARITY_WAVE1_TITLE_TARGET_PATH || receipt.invocation.exportName !== "executeWave1TitleListOwned") throw new Error(`${receipt.receiptId} trusted Wave1 invocation target drift`);
  const fixture = JSON.parse(canonicalizeObjectDbConsumerSourceText(fixtureText)) as { payload?: { cases?: Array<{ caseId?: string; executablePath?: string; transactionPath?: string; consumers?: Array<Record<string, unknown>> }> } };
  const parityCase = fixture.payload?.cases?.find(({ caseId }) => caseId === receipt.harness.harnessCaseId);
  const consumer = parityCase?.consumers?.find((candidate) => candidate.consumerId === receipt.consumerId);
  if (parityCase?.executablePath !== "MariaCanonicalTitleRepository.listOwned" || parityCase.transactionPath !== "DatabaseClient.query:READ_ONLY" || consumer === undefined) throw new Error(`${receipt.receiptId} trusted Wave1 case/path binding drift`);
  assertTrustedWave1ConsumerFixtureMapping(receipt.consumerId, consumer, manifestConsumer);
  const locator = consumer.sourceLocator as Record<string, unknown>;
  const sourceBlob = readCommitBlob(repositoryRoot, evidenceCommit, locator.file as string);
  const normalizedSource = canonicalizeObjectDbConsumerSourceText(sourceBlob);
  const sourceSpan = normalizedSource.slice(locator.start as number, locator.end as number);
  if (sha256CanonicalText(sourceSpan) !== locator.sha256) throw new Error(`${receipt.receiptId} evidenceCommit source span hash drift`);
}

function assertReceiptGitProvenance(
  receipt: ObjectDbConsumerExecutionReceipt,
  evidenceCommit: string,
  manifestConsumer: ConsumerManifestInput["consumers"][number],
): void {
  const repositoryRoot = gitRepositoryRoot();
  assertEvidenceCommitAncestry(repositoryRoot, evidenceCommit);
  for (const evidence of [
    { path: receipt.harness.path, sha256: receipt.harness.sourceSha256 },
    { path: receipt.fixture.path, sha256: receipt.fixture.sha256 },
    { path: receipt.invocation.targetPath, sha256: receipt.invocation.targetSourceSha256 },
  ]) {
    const blob = readCommitBlob(repositoryRoot, evidenceCommit, evidence.path);
    if (sha256CanonicalText(blob) !== evidence.sha256) throw new Error(`${receipt.receiptId} evidenceCommit blob hash drift: ${evidence.path}`);
  }
  const fixtureBlob = readCommitBlob(repositoryRoot, evidenceCommit, receipt.fixture.path);
  assertTrustedWave1FixtureBinding(receipt, fixtureBlob, manifestConsumer, repositoryRoot, evidenceCommit);
}

function assertReceiptExecutableBinding(
  receipt: ObjectDbConsumerExecutionReceipt,
  evidenceFileTexts: Readonly<Record<string, string>>,
  executionReceiptsPath: string,
): void {
  assertRepoRelativeEvidencePath(receipt.harness.path, `${receipt.receiptId}.harness.path`);
  assertRepoRelativeEvidencePath(receipt.fixture.path, `${receipt.receiptId}.fixture.path`);
  assertRepoRelativeEvidencePath(receipt.invocation.targetPath, `${receipt.receiptId}.invocation.targetPath`);
  const evidencePaths = [receipt.harness.path, receipt.fixture.path, receipt.invocation.targetPath];
  if (evidencePaths.includes(executionReceiptsPath) || new Set(evidencePaths).size !== evidencePaths.length) throw new Error(`${receipt.receiptId} self-hash or shared unrelated evidence path is forbidden`);
  const harnessText = evidenceFileTexts[receipt.harness.path];
  const fixtureText = evidenceFileTexts[receipt.fixture.path];
  const targetText = evidenceFileTexts[receipt.invocation.targetPath];
  if (harnessText === undefined || fixtureText === undefined || targetText === undefined) throw new Error(`${receipt.receiptId} executable harness/fixture/target file was not supplied`);
  if (sha256CanonicalText(harnessText) !== receipt.harness.sourceSha256) throw new Error(`${receipt.receiptId} harness source hash drift`);
  if (sha256CanonicalText(fixtureText) !== receipt.fixture.sha256) throw new Error(`${receipt.receiptId} fixture hash drift`);
  if (sha256CanonicalText(targetText) !== receipt.invocation.targetSourceSha256) throw new Error(`${receipt.receiptId} invocation target source hash drift`);
  const binding = receiptBinding(receipt);
  let fixture: unknown;
  try { fixture = JSON.parse(canonicalizeObjectDbConsumerSourceText(fixtureText)); } catch { throw new Error(`${receipt.receiptId} fixture must be JSON`); }
  if (!isRecord(fixture)) throw new Error(`${receipt.receiptId} fixture must be an object`);
  assertExactKeys(fixture, ["format", "fixtureId", "bindings", "payload"], `${receipt.receiptId}.fixture`);
  if (fixture.format !== "hoibot-object-db-consumer-parity-case-fixture-v1" || fixture.fixtureId !== receipt.fixture.fixtureId || !Array.isArray(fixture.bindings)) throw new Error(`${receipt.receiptId} fixture contract/binding mismatch`);
  const exactBinding = JSON.stringify(binding);
  if (!fixture.bindings.some((candidate) => isRecord(candidate) && JSON.stringify(candidate) === exactBinding)) throw new Error(`${receipt.receiptId} unrelated fixture lacks exact receipt binding`);
  if (receipt.harness.runner !== OBJECT_DB_PARITY_RUNNER) throw new Error(`${receipt.receiptId} runner metadata is not allowlisted`);
  if (receipt.harness.path !== OBJECT_DB_PARITY_HARNESS_PATH) throw new Error(`${receipt.receiptId} runner entrypoint is not allowlisted`);
  const harnessPath = resolveEvidenceFile(receipt.harness.path, harnessText);
  const targetPath = resolveEvidenceFile(receipt.invocation.targetPath, targetText);
  const runDirectory = mkdtempSync(join(tmpdir(), "hoibot-parity-"));
  try {
    const inputPath = join(runDirectory, "input.json");
    writeFileSync(inputPath, `${JSON.stringify({ binding, fixturePayload: fixture.payload, invocation: receipt.invocation }, null, 2)}\n`, "utf8");
    const stdout = execFileSync(process.execPath, [harnessPath, inputPath, runDirectory, targetPath], { encoding: "utf8", timeout: 10_000, maxBuffer: 1024 * 1024 });
    if (stdout.length !== 0) throw new Error(`${receipt.receiptId} print-only/stdout harness is forbidden`);
    const caseResult = JSON.parse(readFileSync(join(runDirectory, "case-result.json"), "utf8")) as unknown;
    if (!isRecord(caseResult)) throw new Error(`${receipt.receiptId} machine case-result invalid`);
    assertExactKeys(caseResult, ["format", "passed", "assertionCount", "executedConsumerId", "executedCaseId", "fixtureId", "scenarioId", "scenarioKind", "invocation", "artifacts"], `${receipt.receiptId}.caseResult`);
    if (caseResult.format !== "hoibot-object-db-consumer-parity-case-result-v1" || caseResult.passed !== true || !Number.isSafeInteger(caseResult.assertionCount) || (caseResult.assertionCount as number) <= 0) throw new Error(`${receipt.receiptId} machine case-result did not pass assertions`);
    if (caseResult.executedConsumerId !== receipt.consumerId || caseResult.executedCaseId !== receipt.harness.harnessCaseId || caseResult.fixtureId !== receipt.fixture.fixtureId || caseResult.scenarioId !== receipt.scenario.scenarioId || caseResult.scenarioKind !== receipt.scenario.scenarioKind) throw new Error(`${receipt.receiptId} machine case-result binding mismatch`);
    if (!isRecord(caseResult.invocation) || JSON.stringify(caseResult.invocation) !== JSON.stringify(receipt.invocation)) throw new Error(`${receipt.receiptId} invocation target path/source hash mismatch`);
    if (!isRecord(caseResult.artifacts)) throw new Error(`${receipt.receiptId} raw artifact registry invalid`);
    assertExactKeys(caseResult.artifacts, ["replyPath", "resultPath", "tracePath"], `${receipt.receiptId}.artifacts`);
    const artifactPath = (name: unknown): string => {
      if (typeof name !== "string" || name.length === 0 || isAbsolute(name) || name.includes("..") || name.includes("\\") || name.includes("/")) throw new Error(`${receipt.receiptId} raw artifact path invalid`);
      return join(runDirectory, name);
    };
    const replyHash = sha256Raw(readFileSync(artifactPath(caseResult.artifacts.replyPath)));
    const resultHash = sha256Raw(readFileSync(artifactPath(caseResult.artifacts.resultPath)));
    if (replyHash !== receipt.expectedActual.reply.actualSha256 || resultHash !== receipt.expectedActual.result.actualSha256) throw new Error(`${receipt.receiptId} raw reply/result capture hash mismatch`);
    const trace = JSON.parse(readFileSync(artifactPath(caseResult.artifacts.tracePath), "utf8")) as unknown;
    if (!isRecord(trace)) throw new Error(`${receipt.receiptId} raw execution trace invalid`);
    assertExactKeys(trace, ["normalizedStatements", "rowCount", "lockOrder", "transaction", "timeline"], `${receipt.receiptId}.trace`);
    assertStringArray(trace.normalizedStatements, `${receipt.receiptId}.trace.normalizedStatements`);
    if (!Number.isSafeInteger(trace.rowCount) || (trace.rowCount as number) < 0) throw new Error(`${receipt.receiptId} trace rowCount invalid`);
    assertUniqueStrings(trace.lockOrder, `${receipt.receiptId}.trace.lockOrder`);
    assertStringArray(trace.timeline, `${receipt.receiptId}.trace.timeline`);
    if (normalizedDmlFingerprint(trace.normalizedStatements, trace.rowCount as number) !== receipt.expectedActual.dml.actualSha256 || JSON.stringify(trace.normalizedStatements) !== JSON.stringify(receipt.expectedActual.dml.actualNormalizedStatements) || trace.rowCount !== receipt.expectedActual.dml.actualRowCount) throw new Error(`${receipt.receiptId} raw DML trace mismatch`);
    if (JSON.stringify(trace.lockOrder) !== JSON.stringify(receipt.expectedActual.lockOrder.actual) || trace.transaction !== receipt.expectedActual.transaction.actual || JSON.stringify(trace.timeline) !== JSON.stringify(receipt.expectedActual.transaction.actualTimeline)) throw new Error(`${receipt.receiptId} raw lock/transaction trace mismatch`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(receipt.receiptId)) throw error;
    throw new Error(`${receipt.receiptId} allowlisted harness execution failed`);
  } finally {
    rmSync(runDirectory, { recursive: true, force: true });
  }
}

function validateExecutionReceipt(
  value: unknown,
  manifestById: ReadonlyMap<string, ConsumerManifestInput["consumers"][number]>,
  evidenceFileTexts: Readonly<Record<string, string>>,
  executionReceiptsPath: string,
  evidenceCommit: string,
): ObjectDbConsumerExecutionReceipt {
  if (!isRecord(value)) throw new Error("execution receipt must be an object");
  assertExactKeys(value, ["receiptId", "consumerId", "proofMode", "harness", "fixture", "invocation", "scenario", "expectedActual", "equivalenceRule", "verdict", "receiptSha256"], "execution receipt");
  const receipt = value as unknown as ObjectDbConsumerExecutionReceipt;
  if (typeof receipt.receiptId !== "string" || !/^receipt:[a-z0-9._:-]+$/i.test(receipt.receiptId)) throw new Error("execution receiptId invalid");
  const manifestConsumer = manifestById.get(receipt.consumerId);
  if (manifestConsumer === undefined) throw new Error(`${receipt.receiptId} attributes unknown consumerId`);
  if (receipt.proofMode !== "DIRECT" && receipt.proofMode !== "EQUIVALENT") throw new Error(`${receipt.receiptId} proofMode invalid`);
  if (!isRecord(receipt.harness)) throw new Error(`${receipt.receiptId}.harness invalid`);
  assertExactKeys(receipt.harness, ["harnessId", "harnessCaseId", "runner", "path", "sourceSha256"], `${receipt.receiptId}.harness`);
  for (const key of ["harnessId", "harnessCaseId", "runner", "path"] as const) if (typeof receipt.harness[key] !== "string" || receipt.harness[key].length === 0) throw new Error(`${receipt.receiptId}.harness.${key} invalid`);
  assertHash(receipt.harness.sourceSha256, `${receipt.receiptId}.harness.sourceSha256`);
  if (!isRecord(receipt.fixture)) throw new Error(`${receipt.receiptId}.fixture invalid`);
  assertExactKeys(receipt.fixture, ["fixtureId", "path", "sha256"], `${receipt.receiptId}.fixture`);
  for (const key of ["fixtureId", "path"] as const) if (typeof receipt.fixture[key] !== "string" || receipt.fixture[key].length === 0) throw new Error(`${receipt.receiptId}.fixture.${key} invalid`);
  assertHash(receipt.fixture.sha256, `${receipt.receiptId}.fixture.sha256`);
  if (!isRecord(receipt.invocation)) throw new Error(`${receipt.receiptId}.invocation invalid`);
  assertExactKeys(receipt.invocation, ["targetPath", "targetSourceSha256", "exportName"], `${receipt.receiptId}.invocation`);
  if (typeof receipt.invocation.targetPath !== "string" || receipt.invocation.targetPath.length === 0 || typeof receipt.invocation.exportName !== "string" || receipt.invocation.exportName.length === 0) throw new Error(`${receipt.receiptId}.invocation metadata invalid`);
  assertHash(receipt.invocation.targetSourceSha256, `${receipt.receiptId}.invocation.targetSourceSha256`);
  if (!isRecord(receipt.scenario)) throw new Error(`${receipt.receiptId}.scenario invalid`);
  assertExactKeys(receipt.scenario, ["scenarioId", "scenarioKind"], `${receipt.receiptId}.scenario`);
  if (typeof receipt.scenario.scenarioId !== "string" || receipt.scenario.scenarioId.length === 0 || !new Set<string>([...OBJECT_DB_PARITY_READ_SCENARIOS, ...OBJECT_DB_PARITY_MUTATION_SCENARIOS]).has(receipt.scenario.scenarioKind)) throw new Error(`${receipt.receiptId}.scenario invalid`);
  assertExpectedActual(receipt.expectedActual, `${receipt.receiptId}.expectedActual`, true);
  if (receipt.verdict !== "PASS") throw new Error(`${receipt.receiptId} verdict must be PASS`);
  assertHash(receipt.receiptSha256, `${receipt.receiptId}.receiptSha256`);
  if (receiptFingerprint(receipt) !== receipt.receiptSha256) throw new Error(`${receipt.receiptId} receipt fingerprint drift`);
  const forbiddenSelfHashes = new Set([receipt.receiptSha256, receipt.harness.sourceSha256, receipt.fixture.sha256, receipt.invocation.targetSourceSha256]);
  for (const comparison of [receipt.expectedActual.reply, receipt.expectedActual.result, receipt.expectedActual.dml]) if (comparison.expectedSha256 !== null && forbiddenSelfHashes.has(comparison.expectedSha256)) throw new Error(`${receipt.receiptId} self-hash cannot stand in for reply/result/DML evidence`);
  const dml = receipt.expectedActual.dml;
  if (dml.expectedNormalizedStatements === null || dml.actualNormalizedStatements === null || dml.expectedRowCount === null || dml.actualRowCount === null) throw new Error(`${receipt.receiptId} DML statements and row counts are required`);
  if (normalizedDmlFingerprint(dml.expectedNormalizedStatements, dml.expectedRowCount) !== dml.expectedSha256 || normalizedDmlFingerprint(dml.actualNormalizedStatements, dml.actualRowCount) !== dml.actualSha256) throw new Error(`${receipt.receiptId} normalized DML fingerprint drift`);
  const transaction = receipt.expectedActual.transaction;
  if (transaction.expectedTimeline === null || transaction.actualTimeline === null) throw new Error(`${receipt.receiptId} transaction timeline is required`);
  if (receipt.scenario.scenarioKind === "DOMAIN_FAILURE_ROLLBACK" || receipt.scenario.scenarioKind === "PAYLOAD_DRIFT_FAIL_CLOSED") {
    if (transaction.actual !== "ROLLBACK") throw new Error(`${receipt.receiptId} failure scenario must rollback`);
  }
  if (receipt.scenario.scenarioKind === "DUPLICATE_REPLAY_DML_ZERO" || receipt.scenario.scenarioKind === "SOURCE_DOMAIN_DML_ZERO") {
    if (dml.actualRowCount !== 0 || dml.actualNormalizedStatements.length !== 0) throw new Error(`${receipt.receiptId} DML-zero scenario mutated source domain`);
  }
  const zeroDmlMutationKinds = new Set<ObjectDbParityScenarioKind>(["AUTH_DENIED", "WRONG_ROOM_REJECTED", "PAYLOAD_DRIFT_FAIL_CLOSED", "DUPLICATE_REPLAY_DML_ZERO", "RESTART_REPLAY"]);
  const accessClass: AccessClass = manifestConsumer.access === "READ" ? "READ" : "MUTATION";
  if (accessClass === "READ") {
    if (transaction.actual !== "READ_ONLY") throw new Error(`${receipt.receiptId} READ scenario must be READ_ONLY`);
    if (dml.actualRowCount !== 0 || dml.actualNormalizedStatements.length !== 0) throw new Error(`${receipt.receiptId} READ scenario must have business DML0`);
  } else if (zeroDmlMutationKinds.has(receipt.scenario.scenarioKind) && (dml.actualRowCount !== 0 || dml.actualNormalizedStatements.length !== 0)) {
    throw new Error(`${receipt.receiptId} ${receipt.scenario.scenarioKind} must have business DML0`);
  }
  assertReceiptGitProvenance(receipt, evidenceCommit, manifestConsumer);
  assertReceiptExecutableBinding(receipt, evidenceFileTexts, executionReceiptsPath);
  return receipt;
}

function deriveRegistrySourceMismatchResolution(
  manifest: ConsumerManifestInput,
  classificationSourceTexts: Readonly<Record<string, string>>,
): ExecutableParityLedger["registrySourceMismatchResolution"] {
  const bindings: ExecutableParityLedger["registrySourceMismatchResolution"]["bindings"] = [];
  const unattributed: string[] = [];
  for (const mismatch of manifest.audit.registrySourceMismatches) {
    const separator = mismatch.indexOf(":");
    const file = mismatch.slice(0, separator);
    const command = mismatch.slice(separator + 1);
    const sourceText = classificationSourceTexts[file];
    if (sourceText === undefined) throw new Error(`classification source was not supplied: ${file}`);
    const source = canonicalizeObjectDbConsumerSourceText(sourceText);
    const indexes: number[] = [];
    for (let index = source.indexOf(command); index >= 0; index = source.indexOf(command, index + command.length)) indexes.push(index);
    const candidates = new Map<string, ConsumerManifestInput["consumers"][number]>();
    for (const index of indexes) for (const consumer of manifest.consumers) {
      if (consumer.kind !== "LEGACY_COMMAND" || consumer.file !== file || consumer.sourceSpan === undefined) continue;
      if (!predicateAcceptsRegistryCommand(consumer.triggerOrPredicate, command)) continue;
      const fullConsumer = consumer as ConsumerManifestInput["consumers"][number] & { sourceSpan: { start?: number; end?: number; sha256: string } };
      if (!Number.isSafeInteger(fullConsumer.sourceSpan.start) || !Number.isSafeInteger(fullConsumer.sourceSpan.end)) continue;
      if (fullConsumer.sourceSpan.start! <= index && index < fullConsumer.sourceSpan.end!) {
        const span = source.slice(fullConsumer.sourceSpan.start!, fullConsumer.sourceSpan.end!);
        if (sha256CanonicalText(span) !== fullConsumer.sourceSpan.sha256) throw new Error(`registry mismatch source span drift: ${mismatch}:${consumer.consumerId}`);
        candidates.set(consumer.consumerId, consumer);
      }
    }
    if (candidates.size === 0) { unattributed.push(mismatch); continue; }
    if (candidates.size !== 1) throw new Error(`registry mismatch maps ambiguously to consumer IDs: ${mismatch}`);
    const consumer = [...candidates.values()][0]!;
    bindings.push({ registrySourceMismatch: mismatch, consumerId: consumer.consumerId, sourceSpanSha256: consumer.sourceSpan.sha256 });
  }
  bindings.sort((left, right) => left.registrySourceMismatch.localeCompare(right.registrySourceMismatch));
  unattributed.sort();
  return { bindings, unattributed };
}

export function buildObjectDbConsumerExecutableParityLedger(input: {
  consumerManifestText: string;
  consumerIdRegistryText: string;
  transitionContractText: string;
  executionReceiptsText: string;
  ledgerSchemaText: string;
  executionReceiptSchemaText: string;
  classificationSourceTexts: Readonly<Record<string, string>>;
  sourcePaths: {
    consumerManifest: string;
    consumerIdRegistry: string;
    transitionContract: string;
    executionReceipts: string;
    ledgerSchema: string;
    executionReceiptSchema: string;
  };
  evidenceFileTexts?: Readonly<Record<string, string>>;
}): ExecutableParityLedger {
  const manifest = JSON.parse(canonicalizeObjectDbConsumerSourceText(input.consumerManifestText)) as ConsumerManifestInput;
  if (manifest.format !== "hoibot-object-db-consumer-manifest-v1") throw new Error("unsupported consumer manifest format");
  assertCommit(manifest.baseCommit, "consumer manifest baseCommit");
  assertHash(manifest.consumerSetSha256, "consumer manifest consumerSetSha256");
  if (!Array.isArray(manifest.consumers)) throw new Error("consumer manifest consumers must be an array");
  if (!isRecord(manifest.audit) || !Number.isSafeInteger(manifest.audit.registrySourceMismatchCount) || manifest.audit.registrySourceMismatchCount < 0) throw new Error("invalid registrySourceMismatchCount");
  if (!Array.isArray(manifest.audit.registrySourceMismatches) || manifest.audit.registrySourceMismatches.length !== manifest.audit.registrySourceMismatchCount) throw new Error("registry source mismatch detail/count drift");
  if (sha256CanonicalJson(manifest.consumers) !== manifest.consumerSetSha256) throw new Error("consumer manifest consumerSetSha256 drift");

  const registry = parseConsumerIdRegistry(JSON.parse(canonicalizeObjectDbConsumerSourceText(input.consumerIdRegistryText)), manifest.baseCommit);
  const resolveStableId = createConsumerIdResolver(registry);
  const receiptBundle = parseObjectDbConsumerExecutionReceiptBundle(JSON.parse(canonicalizeObjectDbConsumerSourceText(input.executionReceiptsText)));
  if (receiptBundle.classificationBaseCommit !== manifest.baseCommit) throw new Error("classificationBaseCommit drift between manifest and execution receipts");
  const transition = JSON.parse(canonicalizeObjectDbConsumerSourceText(input.transitionContractText)) as Record<string, unknown>;
  if (transition.format !== "hoibot-object-db-consumer-transition-v1" || transition.catalogVersion !== receiptBundle.catalogVersion || transition.baseCommit !== manifest.baseCommit) throw new Error("transition/receipt/manifest provenance drift");

  const manifestIds = new Set<string>();
  for (const consumer of manifest.consumers) {
    if (!CONSUMER_ID_PATTERN.test(consumer.consumerId) || manifestIds.has(consumer.consumerId)) throw new Error(`invalid or duplicate manifest consumerId: ${consumer.consumerId}`);
    manifestIds.add(consumer.consumerId);
    if (resolveStableId(consumer) !== consumer.consumerId) throw new Error(`stable consumer ID registry drift: ${consumer.consumerId}`);
  }
  const manifestById = new Map(manifest.consumers.map((consumer) => [consumer.consumerId, consumer]));
  const mismatchResolution = deriveRegistrySourceMismatchResolution(manifest, input.classificationSourceTexts);
  const mismatchLabelsByConsumer = new Map<string, string[]>();
  for (const binding of mismatchResolution.bindings) mismatchLabelsByConsumer.set(binding.consumerId, [...(mismatchLabelsByConsumer.get(binding.consumerId) ?? []), binding.registrySourceMismatch].sort());

  const receiptIds = new Set<string>();
  const receiptScenarioKeys = new Set<string>();
  const receiptsByConsumer = new Map<string, ObjectDbConsumerExecutionReceipt[]>();
  for (const rawReceipt of receiptBundle.receipts) {
    const receipt = validateExecutionReceipt(rawReceipt, manifestById, input.evidenceFileTexts ?? {}, input.sourcePaths.executionReceipts, receiptBundle.evidenceCommit);
    if (receiptIds.has(receipt.receiptId)) throw new Error(`duplicate execution receiptId: ${receipt.receiptId}`);
    receiptIds.add(receipt.receiptId);
    const scenarioKey = `${receipt.consumerId}|${receipt.scenario.scenarioKind}`;
    if (receiptScenarioKeys.has(scenarioKey)) throw new Error(`duplicate consumer scenario receipt: ${scenarioKey}`);
    receiptScenarioKeys.add(scenarioKey);
    receiptsByConsumer.set(receipt.consumerId, [...(receiptsByConsumer.get(receipt.consumerId) ?? []), receipt]);
  }

  const entries = manifest.consumers.map((consumer): ExecutableParityLedgerEntry => {
    const mismatchLabels = mismatchLabelsByConsumer.get(consumer.consumerId) ?? [];
    const classification = classificationProjection(consumer, mismatchLabels);
    const requirements = scenarioRequirementsFor(consumer, classification.classificationSha256);
    const receipts = (receiptsByConsumer.get(consumer.consumerId) ?? []).sort((left, right) => left.scenario.scenarioKind.localeCompare(right.scenario.scenarioKind));
    if (mismatchLabels.length > 0 || consumer.unresolvedDynamicCallCount > 0) {
      if (receipts.length > 0) throw new Error(`${consumer.consumerId} cannot consume receipts while source classification blocker remains`);
      return { consumerId: consumer.consumerId, classification, verdict: baselineVerdict(consumer, mismatchLabels), ...emptyExecutionEvidence(requirements) };
    }
    if (receipts.length === 0) return { consumerId: consumer.consumerId, classification, verdict: "STATIC_ONLY", ...emptyExecutionEvidence(requirements) };
    const first = receipts[0]!;
    for (const receipt of receipts) {
      if (receipt.harness.harnessId !== first.harness.harnessId || receipt.harness.path !== first.harness.path || receipt.harness.sourceSha256 !== first.harness.sourceSha256 || receipt.fixture.fixtureId !== first.fixture.fixtureId || receipt.fixture.path !== first.fixture.path || receipt.fixture.sha256 !== first.fixture.sha256 || JSON.stringify(receipt.invocation) !== JSON.stringify(first.invocation) || receipt.proofMode !== first.proofMode || JSON.stringify(receipt.equivalenceRule) !== JSON.stringify(first.equivalenceRule)) throw new Error(`${consumer.consumerId} receipt binding drift within consumer`);
    }
    const requiredKinds = requirements.filter(({ disposition }) => disposition === "REQUIRED").map(({ scenarioKind }) => scenarioKind).sort();
    const receivedKinds = receipts.map(({ scenario }) => scenario.scenarioKind).sort();
    for (const scenarioKind of receivedKinds) if (!requiredKinds.includes(scenarioKind)) throw new Error(`${consumer.consumerId} receipt scenario is not source-required: ${scenarioKind}`);
    const complete = JSON.stringify(requiredKinds) === JSON.stringify(receivedKinds);
    const verdict: ObjectDbExecutableParityVerdict = complete ? (first.proofMode === "DIRECT" ? "DIRECT_PASS" : "EQUIVALENT_PASS") : "PARTIAL";
    if (first.proofMode === "DIRECT" && first.equivalenceRule !== null) throw new Error(`${consumer.consumerId} DIRECT receipts cannot declare equivalenceRule`);
    if (first.proofMode === "EQUIVALENT" && first.equivalenceRule === null) throw new Error(`${consumer.consumerId} EQUIVALENT receipts require equivalenceRule`);
    return {
      consumerId: consumer.consumerId,
      classification,
      verdict,
      harness: { harnessId: first.harness.harnessId, runner: first.harness.runner, path: first.harness.path, sha256: first.harness.sourceSha256 },
      fixture: { fixtureId: first.fixture.fixtureId, path: first.fixture.path, sha256: first.fixture.sha256 },
      invocation: { ...first.invocation },
      scenarioRequirements: requirements,
      scenarios: receipts.map((receipt) => ({ receiptId: receipt.receiptId, scenarioId: receipt.scenario.scenarioId, scenarioKind: receipt.scenario.scenarioKind, harnessCaseId: receipt.harness.harnessCaseId, attributedConsumerIds: [receipt.consumerId], expectedActual: receipt.expectedActual })),
      evidence: { evidenceIds: receipts.map(({ receiptId }) => receiptId).sort(), attributedConsumerIds: [consumer.consumerId], hashes: [{ path: first.harness.path, sha256: first.harness.sourceSha256 }, { path: first.fixture.path, sha256: first.fixture.sha256 }, { path: first.invocation.targetPath, sha256: first.invocation.targetSourceSha256 }].sort((left, right) => left.path.localeCompare(right.path)) },
      equivalenceRule: first.equivalenceRule,
    };
  }).sort((left, right) => left.consumerId.localeCompare(right.consumerId));

  const verdicts = Object.fromEntries(OBJECT_DB_EXECUTABLE_PARITY_VERDICTS.map((verdict) => [verdict, entries.filter((entry) => entry.verdict === verdict).length])) as Record<ObjectDbExecutableParityVerdict, number>;
  const coverage: ExecutableParityCoverage = {
    manifestConsumers: manifest.consumers.length, ledgerEntries: entries.length, missingConsumerIds: 0, duplicateConsumerIds: 0, unknownConsumerIds: 0,
    readConsumers: entries.filter(({ classification }) => classification.accessClass === "READ").length,
    mutationConsumers: entries.filter(({ classification }) => classification.accessClass === "MUTATION").length,
    unresolvedDynamicConsumers: entries.filter(({ classification }) => classification.unresolvedDynamicCallCount > 0).length,
    unresolvedDynamicCallCount: entries.reduce((sum, { classification }) => sum + classification.unresolvedDynamicCallCount, 0),
    registrySourceMismatchCount: manifest.audit.registrySourceMismatchCount,
    registrySourceMismatchAttributedCount: mismatchResolution.bindings.length,
    registrySourceMismatchUnattributedCount: mismatchResolution.unattributed.length,
    provenConsumers: verdicts.DIRECT_PASS + verdicts.EQUIVALENT_PASS,
    unprovenConsumers: entries.length - verdicts.DIRECT_PASS - verdicts.EQUIVALENT_PASS,
    directPassConsumers: verdicts.DIRECT_PASS, equivalentPassConsumers: verdicts.EQUIVALENT_PASS, verdicts,
  };
  const classificationSources = Object.entries(input.classificationSourceTexts).map(([path, text]) => ({ path, sha256: sha256CanonicalText(text) })).sort((left, right) => left.path.localeCompare(right.path));
  const ledger: ExecutableParityLedger = {
    format: OBJECT_DB_EXECUTABLE_PARITY_LEDGER_FORMAT, catalogVersion: receiptBundle.catalogVersion, classificationBaseCommit: manifest.baseCommit, evidenceCommit: receiptBundle.evidenceCommit,
    sourceTextNormalization: "CRLF_AND_CR_TO_LF_BEFORE_HASH",
    sources: {
      ledgerSchema: { path: input.sourcePaths.ledgerSchema, sha256: sha256CanonicalText(input.ledgerSchemaText) },
      executionReceiptSchema: { path: input.sourcePaths.executionReceiptSchema, sha256: sha256CanonicalText(input.executionReceiptSchemaText) },
      consumerManifest: { path: input.sourcePaths.consumerManifest, sha256: sha256CanonicalText(input.consumerManifestText), consumerSetSha256: manifest.consumerSetSha256 },
      consumerIdRegistry: { path: input.sourcePaths.consumerIdRegistry, sha256: sha256CanonicalText(input.consumerIdRegistryText) },
      transitionContract: { path: input.sourcePaths.transitionContract, sha256: sha256CanonicalText(input.transitionContractText) },
      executionReceipts: { path: input.sourcePaths.executionReceipts, sha256: sha256CanonicalText(input.executionReceiptsText) },
      classificationSources,
    },
    registrySourceMismatchResolution: mismatchResolution, coverage, entries, entrySetSha256: sha256CanonicalJson(entries),
  };
  validateObjectDbConsumerExecutableParityLedger(ledger, {
    manifest,
    registry,
    evidenceFileTexts: input.evidenceFileTexts ?? {},
    executionReceiptsText: input.executionReceiptsText,
    executionReceiptsPath: input.sourcePaths.executionReceipts,
    classificationSourceTexts: input.classificationSourceTexts,
  });
  return ledger;
}

function assertExpectedActual(value: unknown, label: string, requireMatch: boolean): asserts value is ExpectedActualEvidence {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  assertExactKeys(value, ["reply", "result", "dml", "lockOrder", "transaction"], label);
  for (const key of ["reply", "result"] as const) {
    const part = value[key];
    if (!isRecord(part)) throw new Error(`${label}.${key} must be an object`);
    assertExactKeys(part, ["expectedSha256", "actualSha256", "match"], `${label}.${key}`);
    assertHash(part.expectedSha256, `${label}.${key}.expectedSha256`, true);
    assertHash(part.actualSha256, `${label}.${key}.actualSha256`, true);
    if (part.match !== null && typeof part.match !== "boolean") throw new Error(`${label}.${key}.match invalid`);
    if (requireMatch && (part.match !== true || part.expectedSha256 === null || part.actualSha256 === null)) throw new Error(`${label}.${key} is not executable PASS evidence`);
    if (requireMatch && part.expectedSha256 !== part.actualSha256) throw new Error(`${label}.${key} expected/actual hash mismatch`);
  }
  const dml = value.dml;
  if (!isRecord(dml)) throw new Error(`${label}.dml must be an object`);
  assertExactKeys(dml, ["expectedSha256", "actualSha256", "match", "expectedNormalizedStatements", "actualNormalizedStatements", "expectedRowCount", "actualRowCount"], `${label}.dml`);
  assertHash(dml.expectedSha256, `${label}.dml.expectedSha256`, true);
  assertHash(dml.actualSha256, `${label}.dml.actualSha256`, true);
  if (dml.match !== null && typeof dml.match !== "boolean") throw new Error(`${label}.dml.match invalid`);
  for (const key of ["expectedNormalizedStatements", "actualNormalizedStatements"] as const) if (dml[key] !== null) assertStringArray(dml[key], `${label}.dml.${key}`);
  for (const key of ["expectedRowCount", "actualRowCount"] as const) {
    const rowCount = dml[key];
    if (rowCount !== null && (typeof rowCount !== "number" || !Number.isSafeInteger(rowCount) || rowCount < 0)) throw new Error(`${label}.dml.${key} invalid`);
  }
  if (requireMatch && (dml.match !== true || dml.expectedSha256 === null || dml.actualSha256 === null || dml.expectedNormalizedStatements === null || dml.actualNormalizedStatements === null || dml.expectedRowCount === null || dml.actualRowCount === null)) throw new Error(`${label}.dml is not executable PASS evidence`);
  if (requireMatch && (dml.expectedSha256 !== dml.actualSha256 || JSON.stringify(dml.expectedNormalizedStatements) !== JSON.stringify(dml.actualNormalizedStatements) || dml.expectedRowCount !== dml.actualRowCount)) throw new Error(`${label}.dml expected/actual mismatch`);
  const lockOrder = value.lockOrder;
  if (!isRecord(lockOrder)) throw new Error(`${label}.lockOrder must be an object`);
  assertExactKeys(lockOrder, ["expected", "actual", "match"], `${label}.lockOrder`);
  for (const key of ["expected", "actual"] as const) {
    if (lockOrder[key] !== null) assertUniqueStrings(lockOrder[key], `${label}.lockOrder.${key}`);
  }
  if (lockOrder.match !== null && typeof lockOrder.match !== "boolean") throw new Error(`${label}.lockOrder.match invalid`);
  if (requireMatch && (lockOrder.match !== true || lockOrder.expected === null || lockOrder.actual === null)) throw new Error(`${label}.lockOrder is not executable PASS evidence`);
  if (requireMatch && JSON.stringify(lockOrder.expected) !== JSON.stringify(lockOrder.actual)) throw new Error(`${label}.lockOrder expected/actual mismatch`);
  const transaction = value.transaction;
  if (!isRecord(transaction)) throw new Error(`${label}.transaction must be an object`);
  assertExactKeys(transaction, ["expected", "actual", "match", "expectedTimeline", "actualTimeline"], `${label}.transaction`);
  const transactionModes = new Set(["READ_ONLY", "COMMIT", "ROLLBACK", null]);
  if (!transactionModes.has(transaction.expected as string | null) || !transactionModes.has(transaction.actual as string | null)) throw new Error(`${label}.transaction mode invalid`);
  if (transaction.match !== null && typeof transaction.match !== "boolean") throw new Error(`${label}.transaction.match invalid`);
  for (const key of ["expectedTimeline", "actualTimeline"] as const) if (transaction[key] !== null) assertStringArray(transaction[key], `${label}.transaction.${key}`);
  if (requireMatch && (transaction.match !== true || transaction.expected === null || transaction.actual === null || transaction.expectedTimeline === null || transaction.actualTimeline === null)) throw new Error(`${label}.transaction is not executable PASS evidence`);
  if (requireMatch && (transaction.expected !== transaction.actual || JSON.stringify(transaction.expectedTimeline) !== JSON.stringify(transaction.actualTimeline))) throw new Error(`${label}.transaction expected/actual mismatch`);
}

function assertHarness(value: unknown, label: string, requireEvidence: boolean): asserts value is ParityHarness {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  assertExactKeys(value, ["harnessId", "runner", "path", "sha256"], label);
  for (const key of ["harnessId", "runner", "path"] as const) if (value[key] !== null && (typeof value[key] !== "string" || value[key].length === 0)) throw new Error(`${label}.${key} invalid`);
  assertHash(value.sha256, `${label}.sha256`, true);
  if (requireEvidence && (value.harnessId === null || value.runner === null || value.path === null || value.sha256 === null)) throw new Error(`${label} incomplete for PASS`);
}

function assertFixture(value: unknown, label: string, requireEvidence: boolean): asserts value is ParityFixture {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  assertExactKeys(value, ["fixtureId", "path", "sha256"], label);
  for (const key of ["fixtureId", "path"] as const) if (value[key] !== null && (typeof value[key] !== "string" || value[key].length === 0)) throw new Error(`${label}.${key} invalid`);
  assertHash(value.sha256, `${label}.sha256`, true);
  if (requireEvidence && (value.fixtureId === null || value.path === null || value.sha256 === null)) throw new Error(`${label} incomplete for PASS`);
}

function assertInvocation(value: unknown, label: string, requireEvidence: boolean): asserts value is ParityInvocation {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  assertExactKeys(value, ["targetPath", "targetSourceSha256", "exportName"], label);
  for (const key of ["targetPath", "exportName"] as const) if (value[key] !== null && (typeof value[key] !== "string" || value[key].length === 0)) throw new Error(`${label}.${key} invalid`);
  assertHash(value.targetSourceSha256, `${label}.targetSourceSha256`, true);
  if (requireEvidence && (value.targetPath === null || value.targetSourceSha256 === null || value.exportName === null)) throw new Error(`${label} incomplete for receipt evidence`);
}

function validateEntryEvidence(entry: ExecutableParityLedgerEntry, manifestIds: Set<string>, evidenceFileTexts: Readonly<Record<string, string>>): void {
  const pass = PASS_VERDICTS.has(entry.verdict);
  const hasReceipts = entry.scenarios.length > 0;
  assertHarness(entry.harness, `${entry.consumerId}.harness`, hasReceipts);
  assertFixture(entry.fixture, `${entry.consumerId}.fixture`, hasReceipts);
  assertInvocation(entry.invocation, `${entry.consumerId}.invocation`, hasReceipts);
  if (!Array.isArray(entry.scenarioRequirements)) throw new Error(`${entry.consumerId}.scenarioRequirements must be an array`);
  const expectedRequirements = scenarioRequirementsFor(entry.classification as unknown as ConsumerManifestInput["consumers"][number], entry.classification.classificationSha256);
  if (JSON.stringify(entry.scenarioRequirements) !== JSON.stringify(expectedRequirements)) throw new Error(`${entry.consumerId} source-derived scenario requirement drift`);
  if (!Array.isArray(entry.scenarios)) throw new Error(`${entry.consumerId}.scenarios must be an array`);
  const scenarioIds = new Set<string>();
  const receiptIds = new Set<string>();
  const scenarioKinds = new Set<string>();
  for (const [index, scenario] of entry.scenarios.entries()) {
    if (!isRecord(scenario)) throw new Error(`${entry.consumerId}.scenarios[${index}] invalid`);
    assertExactKeys(scenario, ["receiptId", "scenarioId", "scenarioKind", "harnessCaseId", "attributedConsumerIds", "expectedActual"], `${entry.consumerId}.scenarios[${index}]`);
    if (typeof scenario.receiptId !== "string" || scenario.receiptId.length === 0 || receiptIds.has(scenario.receiptId)) throw new Error(`${entry.consumerId} duplicate/invalid receiptId`);
    receiptIds.add(scenario.receiptId);
    if (typeof scenario.scenarioId !== "string" || scenario.scenarioId.length === 0 || scenarioIds.has(scenario.scenarioId)) throw new Error(`${entry.consumerId} duplicate/invalid scenarioId`);
    scenarioIds.add(scenario.scenarioId);
    if (!new Set<string>([...OBJECT_DB_PARITY_READ_SCENARIOS, ...OBJECT_DB_PARITY_MUTATION_SCENARIOS]).has(scenario.scenarioKind) || scenarioKinds.has(scenario.scenarioKind)) throw new Error(`${entry.consumerId} duplicate/invalid scenarioKind`);
    scenarioKinds.add(scenario.scenarioKind);
    if (typeof scenario.harnessCaseId !== "string" || scenario.harnessCaseId.length === 0) throw new Error(`${entry.consumerId} invalid harnessCaseId`);
    assertSortedUniqueStrings(scenario.attributedConsumerIds, `${entry.consumerId}.scenario.attributedConsumerIds`, false);
    for (const id of scenario.attributedConsumerIds) if (!manifestIds.has(id)) throw new Error(`${entry.consumerId} scenario attributes unknown consumerId: ${id}`);
    if (JSON.stringify(scenario.attributedConsumerIds) !== JSON.stringify([entry.consumerId])) throw new Error(`${entry.consumerId} receipt scenario must bind exactly this consumer ID`);
    assertExpectedActual(scenario.expectedActual, `${entry.consumerId}.scenario.${scenario.scenarioId}.expectedActual`, true);
  }
  if (!isRecord(entry.evidence)) throw new Error(`${entry.consumerId}.evidence must be an object`);
  assertExactKeys(entry.evidence, ["evidenceIds", "attributedConsumerIds", "hashes"], `${entry.consumerId}.evidence`);
  assertSortedUniqueStrings(entry.evidence.evidenceIds, `${entry.consumerId}.evidence.evidenceIds`, !hasReceipts);
  assertSortedUniqueStrings(entry.evidence.attributedConsumerIds, `${entry.consumerId}.evidence.attributedConsumerIds`, !hasReceipts);
  for (const id of entry.evidence.attributedConsumerIds) if (!manifestIds.has(id)) throw new Error(`${entry.consumerId} evidence attributes unknown consumerId: ${id}`);
  if (!Array.isArray(entry.evidence.hashes) || (hasReceipts && entry.evidence.hashes.length !== 3) || (!hasReceipts && entry.evidence.hashes.length !== 0)) throw new Error(`${entry.consumerId}.evidence.hashes invalid`);
  const hashPaths = new Set<string>();
  for (const hash of entry.evidence.hashes) {
    if (!isRecord(hash)) throw new Error(`${entry.consumerId}.evidence.hash invalid`);
    assertExactKeys(hash, ["path", "sha256"], `${entry.consumerId}.evidence.hash`);
    if (typeof hash.path !== "string" || hash.path.length === 0 || hashPaths.has(hash.path)) throw new Error(`${entry.consumerId}.evidence.hash path invalid/duplicate`);
    hashPaths.add(hash.path);
    assertHash(hash.sha256, `${entry.consumerId}.evidence.hash.sha256`);
  }
  if (hasReceipts) {
    if (JSON.stringify(entry.evidence.attributedConsumerIds) !== JSON.stringify([entry.consumerId])) throw new Error(`${entry.consumerId} evidence must bind exactly this consumer ID`);
    if (JSON.stringify(entry.evidence.evidenceIds) !== JSON.stringify([...receiptIds].sort())) throw new Error(`${entry.consumerId} evidence IDs must equal receipt IDs`);
    const files = [
      { path: entry.harness.path!, sha256: entry.harness.sha256! },
      { path: entry.fixture.path!, sha256: entry.fixture.sha256! },
      { path: entry.invocation.targetPath!, sha256: entry.invocation.targetSourceSha256! },
    ];
    if (JSON.stringify(entry.evidence.hashes) !== JSON.stringify(files.slice().sort((left, right) => left.path.localeCompare(right.path)))) throw new Error(`${entry.consumerId} evidence hashes must equal exact harness and fixture hashes`);
    for (const file of files) {
      assertRepoRelativeEvidencePath(file.path, `${entry.consumerId} evidence path`);
      const text = evidenceFileTexts[file.path];
      if (text === undefined) throw new Error(`${entry.consumerId} executable evidence file was not supplied: ${file.path}`);
      if (sha256CanonicalText(text) !== file.sha256) throw new Error(`${entry.consumerId} executable evidence file hash drift: ${file.path}`);
    }
  }
  const requiredKinds = entry.scenarioRequirements.filter(({ disposition }) => disposition === "REQUIRED").map(({ scenarioKind }) => scenarioKind).sort();
  const receivedKinds = [...scenarioKinds].sort();
  for (const scenarioKind of receivedKinds) if (!requiredKinds.includes(scenarioKind as ObjectDbParityScenarioKind)) throw new Error(`${entry.consumerId} receipt scenario is not source-required: ${scenarioKind}`);
  const complete = JSON.stringify(requiredKinds) === JSON.stringify(receivedKinds);
  const hasMismatch = entry.classification.registrySourceMismatchLabels.length > 0;
  const hasDynamic = entry.classification.unresolvedDynamicCallCount > 0;
  if (hasMismatch && entry.verdict !== "BLOCKED_REGISTRY_MISMATCH") throw new Error(`${entry.consumerId} registry mismatch verdict must take precedence`);
  if (!hasMismatch && hasDynamic && entry.verdict !== "BLOCKED_DYNAMIC") throw new Error(`${entry.consumerId} unresolved dynamic consumer verdict drift`);
  if (!hasMismatch && !hasDynamic && !hasReceipts && entry.verdict !== "STATIC_ONLY") throw new Error(`${entry.consumerId} evidence-free static consumer verdict drift`);
  if (!hasMismatch && !hasDynamic && hasReceipts && !complete && entry.verdict !== "PARTIAL") throw new Error(`${entry.consumerId} incomplete receipt matrix must be PARTIAL`);
  if (!hasMismatch && !hasDynamic && hasReceipts && complete && !pass) throw new Error(`${entry.consumerId} complete receipt matrix must be PASS`);
  if ((hasMismatch || hasDynamic) && hasReceipts) throw new Error(`${entry.consumerId} blocked consumer must not contain execution receipts`);
  if (entry.verdict === "DIRECT_PASS" && entry.equivalenceRule !== null) throw new Error(`${entry.consumerId} DIRECT_PASS must not declare equivalenceRule`);
  if (entry.verdict !== "EQUIVALENT_PASS" && entry.equivalenceRule !== null) throw new Error(`${entry.consumerId} non-equivalent verdict must not declare equivalenceRule`);
}

export function validateObjectDbConsumerExecutableParityLedger(
  value: unknown,
  inputs?: {
    manifest: ConsumerManifestInput;
    registry: ConsumerIdRegistry;
    evidenceFileTexts?: Readonly<Record<string, string>>;
    executionReceiptsText?: string;
    executionReceiptsPath?: string;
    classificationSourceTexts?: Readonly<Record<string, string>>;
  },
): ExecutableParityLedger {
  if (!isRecord(value)) throw new Error("executable parity ledger must be an object");
  assertExactKeys(value, ["format", "catalogVersion", "classificationBaseCommit", "evidenceCommit", "sourceTextNormalization", "sources", "registrySourceMismatchResolution", "coverage", "entries", "entrySetSha256"], "ledger");
  if (value.format !== OBJECT_DB_EXECUTABLE_PARITY_LEDGER_FORMAT) throw new Error("unsupported executable parity ledger format");
  if (value.catalogVersion !== "SC-20260902-1") throw new Error("unsupported executable parity ledger catalogVersion");
  assertCommit(value.classificationBaseCommit, "classificationBaseCommit");
  assertCommit(value.evidenceCommit, "evidenceCommit");
  if (value.sourceTextNormalization !== "CRLF_AND_CR_TO_LF_BEFORE_HASH") throw new Error("unsupported source text normalization");
  if (!isRecord(value.sources)) throw new Error("sources must be an object");
  assertExactKeys(value.sources, ["ledgerSchema", "executionReceiptSchema", "consumerManifest", "consumerIdRegistry", "transitionContract", "executionReceipts", "classificationSources"], "sources");
  for (const [key, source] of Object.entries(value.sources)) {
    if (key === "classificationSources") {
      if (!Array.isArray(source)) throw new Error("sources.classificationSources invalid");
      const paths = new Set<string>();
      for (const item of source) {
        if (!isRecord(item)) throw new Error("sources.classificationSources item invalid");
        assertExactKeys(item, ["path", "sha256"], "sources.classificationSources item");
        if (typeof item.path !== "string" || item.path.length === 0 || paths.has(item.path)) throw new Error("sources.classificationSources path invalid/duplicate");
        paths.add(item.path);
        assertHash(item.sha256, "sources.classificationSources sha256");
      }
      if (JSON.stringify([...paths]) !== JSON.stringify([...paths].sort())) throw new Error("sources.classificationSources must be sorted");
      continue;
    }
    if (!isRecord(source)) throw new Error(`sources.${key} invalid`);
    const expectedKeys = key === "consumerManifest" ? ["path", "sha256", "consumerSetSha256"] : ["path", "sha256"];
    assertExactKeys(source, expectedKeys, `sources.${key}`);
    if (typeof source.path !== "string" || source.path.length === 0) throw new Error(`sources.${key}.path invalid`);
    assertHash(source.sha256, `sources.${key}.sha256`);
    if (key === "consumerManifest") assertHash(source.consumerSetSha256, "sources.consumerManifest.consumerSetSha256");
  }
  const sources = value.sources as unknown as ExecutableParityLedger["sources"];
  if (!isRecord(value.registrySourceMismatchResolution)) throw new Error("registrySourceMismatchResolution must be an object");
  assertExactKeys(value.registrySourceMismatchResolution, ["bindings", "unattributed"], "registrySourceMismatchResolution");
  if (!Array.isArray(value.registrySourceMismatchResolution.bindings)) throw new Error("registrySourceMismatchResolution.bindings invalid");
  const mismatchResolution = value.registrySourceMismatchResolution as unknown as ExecutableParityLedger["registrySourceMismatchResolution"];
  const mismatchLabels = new Set<string>();
  for (const binding of mismatchResolution.bindings) {
    if (!isRecord(binding)) throw new Error("registrySourceMismatchResolution binding invalid");
    assertExactKeys(binding, ["registrySourceMismatch", "consumerId", "sourceSpanSha256"], "registrySourceMismatchResolution binding");
    if (typeof binding.registrySourceMismatch !== "string" || typeof binding.consumerId !== "string" || mismatchLabels.has(binding.registrySourceMismatch)) throw new Error("registrySourceMismatchResolution binding duplicate/invalid");
    mismatchLabels.add(binding.registrySourceMismatch);
    assertHash(binding.sourceSpanSha256, "registrySourceMismatchResolution sourceSpanSha256");
  }
  assertSortedUniqueStrings(mismatchResolution.unattributed, "registrySourceMismatchResolution.unattributed");
  for (const label of mismatchResolution.unattributed) {
    if (mismatchLabels.has(label)) throw new Error("registry source mismatch cannot be both bound and unattributed");
    mismatchLabels.add(label);
  }
  if (inputs !== undefined && JSON.stringify([...mismatchLabels].sort()) !== JSON.stringify(inputs.manifest.audit.registrySourceMismatches.slice().sort())) throw new Error("registry source mismatch resolution coverage drift");
  if (inputs?.classificationSourceTexts !== undefined && JSON.stringify(mismatchResolution) !== JSON.stringify(deriveRegistrySourceMismatchResolution(inputs.manifest, inputs.classificationSourceTexts))) throw new Error("registry source mismatch derivation drift");
  if (!Array.isArray(value.entries)) throw new Error("entries must be an array");
  const entries = value.entries as ExecutableParityLedgerEntry[];
  const ids = entries.map(({ consumerId }) => consumerId);
  assertSortedUniqueStrings(ids, "ledger consumerIds");
  const manifestIds = inputs === undefined ? new Set(ids) : new Set(inputs.manifest.consumers.map(({ consumerId }) => consumerId));
  for (const binding of mismatchResolution.bindings) if (!manifestIds.has(binding.consumerId)) throw new Error(`registry source mismatch binds unknown consumerId: ${binding.consumerId}`);
  for (const [index, entry] of entries.entries()) {
    if (!isRecord(entry)) throw new Error(`ledger entry ${index} invalid`);
    assertExactKeys(entry, ["consumerId", "classification", "verdict", "harness", "fixture", "invocation", "scenarioRequirements", "scenarios", "evidence", "equivalenceRule"], `entry ${index}`);
    if (typeof entry.consumerId !== "string" || !CONSUMER_ID_PATTERN.test(entry.consumerId)) throw new Error(`entry ${index} consumerId invalid`);
    if (!VERDICTS.has(entry.verdict)) throw new Error(`${entry.consumerId} verdict invalid`);
    if (!isRecord(entry.classification)) throw new Error(`${entry.consumerId}.classification invalid`);
    assertExactKeys(entry.classification, ["kind", "file", "symbol", "triggerOrPredicate", "access", "accessClass", "interfaceId", "unresolvedDynamicCallCount", "registrySourceMismatchLabels", "sourceSpanSha256", "classificationSha256"], `${entry.consumerId}.classification`);
    const classification = entry.classification;
    for (const key of ["kind", "file", "symbol", "triggerOrPredicate", "interfaceId"] as const) if (typeof classification[key] !== "string" || classification[key].length === 0) throw new Error(`${entry.consumerId}.classification.${key} invalid`);
    if (!new Set(["READ", "WRITE", "READ_WRITE"]).has(classification.access as string)) throw new Error(`${entry.consumerId}.classification.access invalid`);
    if (classification.accessClass !== (classification.access === "READ" ? "READ" : "MUTATION")) throw new Error(`${entry.consumerId}.classification.accessClass drift`);
    if (!Number.isSafeInteger(classification.unresolvedDynamicCallCount) || classification.unresolvedDynamicCallCount < 0) throw new Error(`${entry.consumerId}.classification.unresolvedDynamicCallCount invalid`);
    assertSortedUniqueStrings(classification.registrySourceMismatchLabels, `${entry.consumerId}.classification.registrySourceMismatchLabels`);
    const expectedMismatchLabels = mismatchResolution.bindings.filter(({ consumerId }) => consumerId === entry.consumerId).map(({ registrySourceMismatch }) => registrySourceMismatch).sort();
    if (JSON.stringify(classification.registrySourceMismatchLabels) !== JSON.stringify(expectedMismatchLabels)) throw new Error(`${entry.consumerId} registry source mismatch binding drift`);
    assertHash(classification.sourceSpanSha256, `${entry.consumerId}.classification.sourceSpanSha256`);
    const { classificationSha256, ...projection } = classification;
    assertHash(classificationSha256, `${entry.consumerId}.classification.classificationSha256`);
    if (sha256CanonicalJson(projection) !== classificationSha256) throw new Error(`${entry.consumerId} classification drift`);
    if (entry.verdict === "STATIC_ONLY" && classification.unresolvedDynamicCallCount > 0) throw new Error(`${entry.consumerId} dynamic consumer cannot be STATIC_ONLY`);
    if (entry.verdict === "BLOCKED_DYNAMIC" && classification.unresolvedDynamicCallCount === 0) throw new Error(`${entry.consumerId} static consumer cannot be BLOCKED_DYNAMIC`);
    validateEntryEvidence(entry, manifestIds, inputs?.evidenceFileTexts ?? {});
  }
  for (const entry of entries.filter(({ verdict }) => verdict === "EQUIVALENT_PASS")) {
    const rule = entry.equivalenceRule;
    if (!isRecord(rule)) throw new Error(`${entry.consumerId} EQUIVALENT_PASS requires mechanical equivalenceRule`);
    assertExactKeys(rule, ["ruleId", "ruleVersion", "mechanical", "equivalenceKey", "variantConsumerIds"], `${entry.consumerId}.equivalenceRule`);
    if (rule.ruleId !== "SAME_INTERFACE_ACCESS_V1" || rule.ruleVersion !== "1") throw new Error(`${entry.consumerId} unsupported mechanical equivalence rule`);
    if (typeof rule.equivalenceKey !== "string" || rule.equivalenceKey.length === 0) throw new Error(`${entry.consumerId}.equivalenceRule.equivalenceKey invalid`);
    if (rule.mechanical !== true) throw new Error(`${entry.consumerId} equivalence must be mechanical`);
    assertSortedUniqueStrings(rule.variantConsumerIds, `${entry.consumerId}.equivalenceRule.variantConsumerIds`, false);
    if (!rule.variantConsumerIds.includes(entry.consumerId)) throw new Error(`${entry.consumerId} equivalence variants omit self`);
    const expectedEquivalenceKey = deriveSameInterfaceAccessEquivalenceKey(entry.classification);
    if (rule.equivalenceKey !== expectedEquivalenceKey) throw new Error(`${entry.consumerId} mechanical equivalence key drift`);
    const expectedVariantIds = entries
      .filter(({ classification }) => classification.interfaceId === entry.classification.interfaceId && classification.accessClass === entry.classification.accessClass)
      .map(({ consumerId }) => consumerId)
      .sort();
    if (expectedVariantIds.length < 2 || JSON.stringify(rule.variantConsumerIds) !== JSON.stringify(expectedVariantIds)) throw new Error(`${entry.consumerId} mechanical equivalence rule does not enumerate all ID variants`);
    for (const variantId of rule.variantConsumerIds) {
      const variant = entries.find(({ consumerId }) => consumerId === variantId);
      if (variant?.verdict !== "EQUIVALENT_PASS" || variant.equivalenceRule?.ruleId !== rule.ruleId || JSON.stringify(variant.equivalenceRule.variantConsumerIds) !== JSON.stringify(rule.variantConsumerIds)) {
        throw new Error(`${entry.consumerId} equivalence rule lacks all proven ID variants: ${variantId}`);
      }
    }
  }
  assertHash(value.entrySetSha256, "entrySetSha256");
  if (sha256CanonicalJson(entries) !== value.entrySetSha256) throw new Error("entrySetSha256 drift");
  if (!isRecord(value.coverage)) throw new Error("coverage must be an object");
  const coverageKeys = ["manifestConsumers", "ledgerEntries", "missingConsumerIds", "duplicateConsumerIds", "unknownConsumerIds", "readConsumers", "mutationConsumers", "unresolvedDynamicConsumers", "unresolvedDynamicCallCount", "registrySourceMismatchCount", "registrySourceMismatchAttributedCount", "registrySourceMismatchUnattributedCount", "provenConsumers", "unprovenConsumers", "directPassConsumers", "equivalentPassConsumers", "verdicts"];
  assertExactKeys(value.coverage, coverageKeys, "coverage");
  const coverage = value.coverage as unknown as ExecutableParityCoverage;
  const verdicts = Object.fromEntries(OBJECT_DB_EXECUTABLE_PARITY_VERDICTS.map((verdict) => [verdict, entries.filter((entry) => entry.verdict === verdict).length])) as Record<ObjectDbExecutableParityVerdict, number>;
  const calculated: ExecutableParityCoverage = {
    manifestConsumers: inputs?.manifest.consumers.length ?? entries.length,
    ledgerEntries: entries.length,
    missingConsumerIds: inputs === undefined ? 0 : [...manifestIds].filter((id) => !ids.includes(id)).length,
    duplicateConsumerIds: ids.length - new Set(ids).size,
    unknownConsumerIds: inputs === undefined ? 0 : ids.filter((id) => !manifestIds.has(id)).length,
    readConsumers: entries.filter(({ classification }) => classification.accessClass === "READ").length,
    mutationConsumers: entries.filter(({ classification }) => classification.accessClass === "MUTATION").length,
    unresolvedDynamicConsumers: entries.filter(({ classification }) => classification.unresolvedDynamicCallCount > 0).length,
    unresolvedDynamicCallCount: entries.reduce((sum, { classification }) => sum + classification.unresolvedDynamicCallCount, 0),
    registrySourceMismatchCount: inputs?.manifest.audit.registrySourceMismatchCount ?? coverage.registrySourceMismatchCount,
    registrySourceMismatchAttributedCount: mismatchResolution.bindings.length,
    registrySourceMismatchUnattributedCount: mismatchResolution.unattributed.length,
    provenConsumers: verdicts.DIRECT_PASS + verdicts.EQUIVALENT_PASS,
    unprovenConsumers: entries.length - verdicts.DIRECT_PASS - verdicts.EQUIVALENT_PASS,
    directPassConsumers: verdicts.DIRECT_PASS,
    equivalentPassConsumers: verdicts.EQUIVALENT_PASS,
    verdicts,
  };
  if (JSON.stringify(coverage) !== JSON.stringify(calculated)) throw new Error("coverage drift");
  if (coverage.missingConsumerIds !== 0 || coverage.duplicateConsumerIds !== 0 || coverage.unknownConsumerIds !== 0) throw new Error("ledger must join consumer manifest exactly 1:1");
  if (inputs !== undefined) {
    if (value.classificationBaseCommit !== inputs.manifest.baseCommit || sources.consumerManifest.consumerSetSha256 !== inputs.manifest.consumerSetSha256) throw new Error("classification provenance drift");
    const resolveStableId = createConsumerIdResolver(parseConsumerIdRegistry(inputs.registry, inputs.manifest.baseCommit));
    const byId = new Map(entries.map((entry) => [entry.consumerId, entry]));
    for (const consumer of inputs.manifest.consumers) {
      if (resolveStableId(consumer) !== consumer.consumerId) throw new Error(`stable ID drift: ${consumer.consumerId}`);
      const entry = byId.get(consumer.consumerId);
      const sourceMismatchLabels = mismatchResolution.bindings.filter(({ consumerId }) => consumerId === consumer.consumerId).map(({ registrySourceMismatch }) => registrySourceMismatch);
      if (entry === undefined || JSON.stringify(entry.classification) !== JSON.stringify(classificationProjection(consumer, sourceMismatchLabels))) throw new Error(`consumer classification join drift: ${consumer.consumerId}`);
    }
    if (inputs.executionReceiptsText !== undefined) {
      if (inputs.executionReceiptsPath === undefined) throw new Error("executionReceiptsPath is required with executionReceiptsText");
      const bundle = parseObjectDbConsumerExecutionReceiptBundle(JSON.parse(canonicalizeObjectDbConsumerSourceText(inputs.executionReceiptsText)));
      if (bundle.classificationBaseCommit !== value.classificationBaseCommit || bundle.evidenceCommit !== value.evidenceCommit || bundle.catalogVersion !== value.catalogVersion) throw new Error("execution receipt bundle provenance drift");
      const ledgerReceiptIds = new Set(entries.flatMap(({ scenarios }) => scenarios.map(({ receiptId }) => receiptId)));
      const bundleReceiptIds = new Set<string>();
      for (const rawReceipt of bundle.receipts) {
        const receipt = validateExecutionReceipt(rawReceipt, new Map(inputs.manifest.consumers.map((consumer) => [consumer.consumerId, consumer])), inputs.evidenceFileTexts ?? {}, inputs.executionReceiptsPath, bundle.evidenceCommit);
        if (bundleReceiptIds.has(receipt.receiptId)) throw new Error(`duplicate execution receiptId: ${receipt.receiptId}`);
        bundleReceiptIds.add(receipt.receiptId);
        const entry = byId.get(receipt.consumerId);
        const scenario = entry?.scenarios.find(({ receiptId }) => receiptId === receipt.receiptId);
        const expectedScenario: ParityScenario = {
          receiptId: receipt.receiptId,
          scenarioId: receipt.scenario.scenarioId,
          scenarioKind: receipt.scenario.scenarioKind,
          harnessCaseId: receipt.harness.harnessCaseId,
          attributedConsumerIds: [receipt.consumerId],
          expectedActual: receipt.expectedActual,
        };
        if (entry === undefined || scenario === undefined || JSON.stringify(scenario) !== JSON.stringify(expectedScenario)) throw new Error(`${receipt.receiptId} receipt-to-ledger scenario binding drift`);
        if (entry.harness.harnessId !== receipt.harness.harnessId || entry.harness.path !== receipt.harness.path || entry.harness.sha256 !== receipt.harness.sourceSha256 || entry.fixture.fixtureId !== receipt.fixture.fixtureId || entry.fixture.path !== receipt.fixture.path || entry.fixture.sha256 !== receipt.fixture.sha256 || JSON.stringify(entry.invocation) !== JSON.stringify(receipt.invocation)) throw new Error(`${receipt.receiptId} receipt-to-ledger harness/fixture/invocation binding drift`);
        if (receipt.proofMode === "EQUIVALENT" && JSON.stringify(entry.equivalenceRule) !== JSON.stringify(receipt.equivalenceRule)) throw new Error(`${receipt.receiptId} receipt-to-ledger equivalence drift`);
      }
      if (JSON.stringify([...ledgerReceiptIds].sort()) !== JSON.stringify([...bundleReceiptIds].sort())) throw new Error("receipt bundle and ledger receipt set drift");
    }
  }
  return value as unknown as ExecutableParityLedger;
}
