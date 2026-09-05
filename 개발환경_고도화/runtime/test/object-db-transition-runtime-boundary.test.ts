import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { auditObjectDbRuntimeAdoption } from "../src/data-migration/object-db-runtime-adoption-audit.js";

type Transition = { from: string; to: string; condition: string };
type Evidence = { file: string; observed: string[]; missingRequired: string[]; blockingReason: string };
type Contract = {
  format: string;
  status: string;
  scope: string;
  environmentContext: {
    name: string;
    immutable: boolean;
    constructedOnceAtStartup: boolean;
    fields: {
      environmentCode: { type: string; allowed: string[] };
      databaseIdentity: { type: string; source: string };
      requestNamespace: { type: string; grammar: string; pattern: string; maxLength: number; derivedOnlyFrom: string[] };
    };
  };
  environmentBindings: Array<{ environmentCode: string; legacyDataRoot: string; databaseIdentitySource: string; requestNamespaceTemplate: string }>;
  partitionRules: Record<string, boolean | string>;
  startupDatabaseIdentityVerification: { query: string; expected: string; nullOrEmptyResult: string; mismatch: string; requiredBefore: string[]; failureMode: string };
  requestIdentity: {
    storageModel: string;
    requestNamespace: { pattern: string; maxLength: number };
    entrypointKinds: string[];
    entrypointKindMaxLength: number;
    externalRequestId: { pattern: string; maxLength: number };
    externalRequestIdRequired: boolean;
    payloadFingerprintRequired: boolean;
    payloadFingerprint: string;
    requestKey: { column: string; value: string; maxLength: number; semantics: string };
    requestIdentityFingerprint: { algorithm: string; encoding: string; length: number; canonicalInput: string; formula: string; persistenceRole: string };
    collisionRule: string;
  };
  singleWriterClaim: {
    owner: string;
    appliesTo: string[];
    initialState: string;
    terminalStates: string[];
    states: string[];
    allowedTransitions: Transition[];
    forbiddenTransitions: string[];
    concurrency: string;
    mutationBoundary: string;
    effectMode: { persisted: boolean; allowed: string[]; shadowAndReject: string; decisionOwner: string };
    lease: { token: string; generation: string; expiry: string; attemptCount: string; fence: string[] };
    recovery: { statuses: string[]; expiredClaimed: string; mutationStarted: string; legacyDrain: string };
  };
  routeDecision: {
    allowedRoutes: string[];
    persistBeforeExecution: boolean;
    persistedFields: string[];
    replay: string;
    shadow: { mode: string; domainWritesAllowed: boolean; legacyWritesAllowed: boolean; controlPlaneClaimWriteRequired: boolean; completion: string; forbidden: string[] };
    legacyFallback: { allowedOnlyWhen: string; fallbackSelectionAfterMutationStarted: string; persistedLegacyWriterAfterMutationStarted: string; modernFailure: string };
  };
  claimReplayStore: { table: string; schemaStatus: string; purpose: string; requiredColumns: string[]; requiredKeys: string[]; unmatchedReject: string; namespaceInvariant: string; ownership: string; migrationRule: string };
  typedReceiptLinkStore: { table: string; schemaStatus: string; primaryKey: string; claimForeignKey: string; receiptKinds: string[]; cardinality: string; uniqueness: string; fingerprint: string; transaction: string };
  writerRoles: {
    entrypoint: { role: string; responsibilities: string[] };
    sqlRepository: { role: string; may: string[]; mustNot: string[] };
  };
  runtimeAdoptionAudit: {
    helper: string;
    reviewedSourceHashes: {
      appSourceSha256: string;
      petExploreIngressSourceSha256: string;
      petExploreEventControlProviderSourceSha256: string;
      appWiringOperationProviderSourceSha256: string;
      petExploreEventControlMigrationSourceSha256: string;
      petExploreEventControlRollbackSourceSha256: string;
      petDataCompareIngressSourceSha256: string;
      petDataCompareShadowEvaluatorSourceSha256: string;
      petTitleIngressSourceSha256: string;
      petTitleMutationProviderSourceSha256: string;
    };
    productionSourceCallCount: number;
    entrypointKind: string;
    domains: string[];
    effectModes: string[];
    connectedIngressFamilies: string[];
  };
  sourceEvidence: Evidence[];
  gate2Decision: { status: string; promotionRequirement: string; currentRuntimeCompliant: boolean; migrationFilesChanged: boolean; runtimeFilesChanged: boolean; acceptedEvidence: { P0: string[]; P1: string[]; P2: string }; runtimeEntrypointCallCount: number };
};

const repoUrl = new URL("../../../", import.meta.url);
const contract = JSON.parse(readFileSync(
  new URL("../../migration-control/contracts/object-db-transition-runtime-boundary.v1.json", import.meta.url),
  "utf8"
)) as Contract;

function readRepoFile(path: string): string {
  return readFileSync(new URL(path.replaceAll("\\", "/"), repoUrl), "utf8");
}

function transitions(contractTransitions: Transition[]): string[] {
  return contractTransitions.map(({ from, to }) => `${from}->${to}`);
}

describe("WBS743 Gate2 object DB transition runtime boundary", () => {
  it("defines one immutable dev/prod EnvironmentContext and rejects database identity drift at startup", () => {
    assert.equal(contract.format, "hoibot-object-db-transition-runtime-boundary-v1");
    assert.equal(contract.environmentContext.name, "EnvironmentContext");
    assert.equal(contract.environmentContext.immutable, true);
    assert.equal(contract.environmentContext.constructedOnceAtStartup, true);
    assert.deepEqual(contract.environmentContext.fields.environmentCode.allowed, ["dev", "prod"]);
    assert.equal(contract.environmentContext.fields.databaseIdentity.source, "DATABASE_NAME");
    assert.deepEqual(contract.environmentContext.fields.requestNamespace.derivedOnlyFrom, ["environmentCode", "databaseIdentity"]);
    assert.equal(contract.environmentContext.fields.requestNamespace.pattern, "^hoibot:(dev|prod):[A-Za-z0-9_$-]{1,64}$");
    assert.equal(contract.environmentContext.fields.requestNamespace.maxLength, 76);
    assert.equal(contract.startupDatabaseIdentityVerification.query, "SELECT DATABASE() AS database_identity");
    assert.equal(contract.startupDatabaseIdentityVerification.nullOrEmptyResult, "REJECT_STARTUP");
    assert.equal(contract.startupDatabaseIdentityVerification.mismatch, "REJECT_STARTUP");
    assert.match(contract.startupDatabaseIdentityVerification.expected, /equals EnvironmentContext\.databaseIdentity byte-for-byte/);
    assert.ok(contract.startupDatabaseIdentityVerification.requiredBefore.includes("any repository read or write other than this verification"));
    assert.match(contract.startupDatabaseIdentityVerification.failureMode, /fail closed/);
  });

  it("binds distinct legacy DEV/PROD roots, database identities, and request namespaces", () => {
    assert.deepEqual(contract.environmentBindings, [
      {
        environmentCode: "dev",
        legacyDataRoot: "/sdcard/호이랜드_dev/",
        databaseIdentitySource: "DATABASE_NAME",
        requestNamespaceTemplate: "hoibot:dev:<databaseIdentity>"
      },
      {
        environmentCode: "prod",
        legacyDataRoot: "/sdcard/호이랜드/",
        databaseIdentitySource: "DATABASE_NAME",
        requestNamespaceTemplate: "hoibot:prod:<databaseIdentity>"
      }
    ]);
    assert.equal(contract.partitionRules.databaseIdentitiesMustDiffer, true);
    assert.equal(contract.partitionRules.legacyRootsMustDiffer, true);
    assert.equal(contract.partitionRules.requestNamespacesMustDiffer, true);
    assert.equal(contract.partitionRules.crossEnvironmentReuse, "REJECT");
    assert.match(String(contract.partitionRules.requestNamespaceFormula), /environmentCode.*databaseIdentity/);
    assert.match(String(contract.partitionRules.requestNamespaceMismatch), /REJECT_BEFORE_CLAIM/);
    assert.equal(new Set(contract.environmentBindings.map(({ legacyDataRoot }) => legacyDataRoot)).size, 2);
    assert.equal(new Set(contract.environmentBindings.map(({ requestNamespaceTemplate }) => requestNamespaceTemplate)).size, 2);
    assert.match(contract.requestIdentity.storageModel, /separate columns/);
    assert.equal(contract.requestIdentity.requestNamespace.maxLength, 76);
    assert.equal(contract.requestIdentity.entrypointKindMaxLength, 9);
    assert.equal(contract.requestIdentity.externalRequestId.maxLength, 172);
    assert.equal(contract.requestIdentity.externalRequestIdRequired, true);
    assert.equal(contract.requestIdentity.payloadFingerprintRequired, true);
    assert.match(contract.requestIdentity.payloadFingerprint, /64-character SHA-256/);
    assert.equal(contract.requestIdentity.requestKey.column, "request_key");
    assert.equal(contract.requestIdentity.requestKey.value, "<entrypointKind>:<externalRequestId>");
    assert.equal(contract.requestIdentity.requestKey.maxLength, 182);
    assert.match(contract.requestIdentity.requestKey.semantics, /scoped by request_namespace.*not the cross-environment unique key/);
    assert.deepEqual(contract.requestIdentity.requestIdentityFingerprint, {
      algorithm: "SHA-256",
      encoding: "lowercase hexadecimal",
      length: 64,
      canonicalInput: "UTF-8 JSON array with no whitespace and this exact order: [requestNamespace,entrypointKind,externalRequestId]",
      formula: "sha256Hex(JSON.stringify([requestNamespace,entrypointKind,externalRequestId]))",
      persistenceRole: "the UNIQUE lookup key for claim acquisition and replay"
    });
    const tuple = ["hoibot:dev:hoibot_dev", "IRIS", "event:123"];
    const fingerprint = createHash("sha256").update(JSON.stringify(tuple), "utf8").digest("hex");
    assert.match(fingerprint, /^[0-9a-f]{64}$/);
    assert.equal(fingerprint, createHash("sha256").update(JSON.stringify(tuple), "utf8").digest("hex"));
    assert.notEqual(fingerprint, createHash("sha256").update(JSON.stringify([tuple[0], tuple[1], "event:124"]), "utf8").digest("hex"));
    assert.match(contract.requestIdentity.collisionRule, /same requestIdentityFingerprint and different payloadFingerprint rejects/);
  });

  it("makes every ingress an entrypoint-only single writer with a closed claim state machine", () => {
    assert.equal(contract.singleWriterClaim.owner, "ENTRYPOINT_ONLY");
    assert.deepEqual(contract.singleWriterClaim.appliesTo, ["IRIS", "AUTOMATIC", "ADMIN", "WEB"]);
    assert.deepEqual(contract.requestIdentity.entrypointKinds, contract.singleWriterClaim.appliesTo);
    assert.deepEqual(contract.singleWriterClaim.states, ["CLAIMED", "MUTATION_STARTED", "COMPLETED", "FAILED"]);
    assert.equal(contract.singleWriterClaim.initialState, "CLAIMED");
    assert.deepEqual(contract.singleWriterClaim.terminalStates, ["COMPLETED", "FAILED"]);
    assert.deepEqual(transitions(contract.singleWriterClaim.allowedTransitions), [
      "CLAIMED->MUTATION_STARTED",
      "CLAIMED->COMPLETED",
      "CLAIMED->FAILED",
      "MUTATION_STARTED->COMPLETED",
      "MUTATION_STARTED->FAILED"
    ]);
    const mutationStart = contract.singleWriterClaim.allowedTransitions.find(({ from, to }) => from === "CLAIMED" && to === "MUTATION_STARTED");
    assert.match(mutationStart?.condition ?? "", /MODERN or LEGACY_FALLBACK/);
    assert.match(mutationStart?.condition ?? "", /immediately about to perform the first write/);
    const zeroWriteCompletion = contract.singleWriterClaim.allowedTransitions.find(({ from, to }) => from === "CLAIMED" && to === "COMPLETED");
    assert.match(zeroWriteCompletion?.condition ?? "", /zero writes/);
    assert.match(zeroWriteCompletion?.condition ?? "", /read-only LEGACY_FALLBACK/);
    assert.doesNotMatch(zeroWriteCompletion?.condition ?? "", /authorized legacy handoff(?!.*read-only)/);
    assert.ok(contract.singleWriterClaim.forbiddenTransitions.includes("MUTATION_STARTED->LEGACY_FALLBACK"));
    assert.match(contract.singleWriterClaim.concurrency, /exactly one entrypoint claim/);
    assert.match(contract.singleWriterClaim.mutationBoundary, /immediately before the first mutation/);
    assert.match(contract.singleWriterClaim.mutationBoundary, /T1.*controlled database transaction/);
    assert.deepEqual(contract.singleWriterClaim.effectMode.allowed, ["READ_ONLY", "MUTATION"]);
    assert.equal(contract.singleWriterClaim.effectMode.shadowAndReject, "READ_ONLY_ONLY");
    assert.deepEqual(contract.singleWriterClaim.lease.fence, ["app_wiring_operation_id", "claim_state", "lease_token", "lease_generation"]);
    assert.match(contract.singleWriterClaim.lease.generation, /increments on an expired CLAIMED takeover/);
    assert.deepEqual(contract.singleWriterClaim.recovery.statuses, ["NONE", "PENDING", "RECOVERED", "FAILED"]);
    assert.match(contract.singleWriterClaim.recovery.mutationStarted, /APP_WIRING_MUTATION_RECOVERY_REQUIRED/);
    assert.match(contract.singleWriterClaim.recovery.legacyDrain, /fail closed/);
  });

  it("persists and replays route decisions and permanently closes legacy fallback after mutation starts", () => {
    assert.deepEqual(contract.routeDecision.allowedRoutes, ["MODERN", "SHADOW", "LEGACY_FALLBACK", "REJECT"]);
    assert.equal(contract.routeDecision.persistBeforeExecution, true);
    for (const field of ["requestNamespace", "entrypointKind", "externalRequestId", "request_key", "requestIdentityFingerprint", "payloadFingerprint", "route", "environmentCode", "databaseIdentity"]) {
      assert.ok(contract.routeDecision.persistedFields.includes(field), field);
    }
    assert.ok(contract.routeDecision.persistedFields.includes("effectMode"));
    assert.equal(new Set(contract.routeDecision.persistedFields).size, contract.routeDecision.persistedFields.length);
    assert.match(contract.routeDecision.replay, /stored route decision without consulting rollout, canary, aliases, or current configuration again/);
    assert.equal(contract.routeDecision.shadow.mode, "READ_ONLY_COMPARISON");
    assert.equal(contract.routeDecision.shadow.domainWritesAllowed, false);
    assert.equal(contract.routeDecision.shadow.legacyWritesAllowed, false);
    assert.equal(contract.routeDecision.shadow.controlPlaneClaimWriteRequired, true);
    assert.match(contract.routeDecision.shadow.completion, /only canonical_app_wiring_operations control-plane/);
    assert.ok(contract.routeDecision.shadow.forbidden.includes("domain mutation"));
    assert.ok(contract.routeDecision.shadow.forbidden.includes("legacy mutation"));
    assert.ok(contract.routeDecision.shadow.forbidden.includes("MUTATION_STARTED transition"));
    assert.match(contract.routeDecision.legacyFallback.allowedOnlyWhen, /read-only handoff may finish CLAIMED->COMPLETED/);
    assert.match(contract.routeDecision.legacyFallback.allowedOnlyWhen, /mutation-capable handoff must first transition CLAIMED->MUTATION_STARTED immediately before its first write/);
    assert.equal(contract.routeDecision.legacyFallback.fallbackSelectionAfterMutationStarted, "FORBIDDEN");
    assert.equal(contract.routeDecision.legacyFallback.persistedLegacyWriterAfterMutationStarted, "CONTINUE_AS_SOLE_WRITER");
    assert.match(contract.routeDecision.legacyFallback.modernFailure, /never invoke legacy/);
  });

  it("requires one additive canonical_app_wiring_operations claim and replay store", () => {
    assert.equal(contract.claimReplayStore.table, "canonical_app_wiring_operations");
    assert.equal(contract.claimReplayStore.schemaStatus, "MIGRATION_462_PLUS_466_IMPLEMENTED_NOT_ADOPTED");
    for (const column of [
      "request_identity_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin",
      "request_namespace VARCHAR(76)",
      "entrypoint_kind VARCHAR(9)",
      "external_request_id VARCHAR(172)",
      "request_key VARCHAR(182)",
      "payload_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin",
      "environment_code VARCHAR(4)",
      "database_identity VARCHAR(64)",
      "route VARCHAR(32)",
      "claim_state VARCHAR(32)",
      "effect_mode VARCHAR(16)",
      "lease_token CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL",
      "lease_generation BIGINT UNSIGNED",
      "lease_expires_time CHAR(19) NULL",
      "attempt_count BIGINT UNSIGNED",
      "recovery_status VARCHAR(32)",
      "recovery_code VARCHAR(100) NULL"
    ]) assert.ok(contract.claimReplayStore.requiredColumns.includes(column), column);
    assert.ok(contract.claimReplayStore.requiredKeys.includes("UNIQUE KEY (request_identity_fingerprint)"));
    assert.match(contract.claimReplayStore.unmatchedReject, /REJECT.*command_code.*handler_key NULL/);
    assert.match(contract.claimReplayStore.namespaceInvariant, /request_namespace.*environment_code.*database_identity/);
    assert.ok(contract.claimReplayStore.requiredKeys.includes("UNIQUE KEY (request_namespace, request_key)"));
    assert.match(contract.claimReplayStore.ownership, /entrypoint boundary only/);
    assert.match(contract.claimReplayStore.migrationRule, /migration 462.*migration 466/);
    assert.equal(contract.typedReceiptLinkStore.table, "canonical_app_wiring_receipt_links");
    assert.equal(contract.typedReceiptLinkStore.schemaStatus, "MIGRATIONS_466_470_EVENT_CONTROL_ADOPTED_P2_VERIFIED");
    assert.deepEqual(contract.typedReceiptLinkStore.receiptKinds, ["DAILY_PRAYER", "HOME_AGGREGATE", "MARKET", "MEMBER_TITLE", "MINI_PET_TITLE", "PACKAGE_USE", "PET_EXPLORE", "PET_EXPLORE_EVENT_CONTROL", "PET_TITLE", "PLAYER_IDENTITY"]);
    assert.match(contract.typedReceiptLinkStore.cardinality, /exactly one typed operation FK/);
    assert.match(contract.typedReceiptLinkStore.transaction, /T1.*FOR UPDATE.*COMPLETED/);
  });

  it("classifies SQL repositories only as transaction participants, never writer selectors", () => {
    assert.equal(contract.writerRoles.entrypoint.role, "WRITER_SELECTOR");
    assert.equal(contract.writerRoles.sqlRepository.role, "TRANSACTION_PARTICIPANT");
    for (const prohibited of [
      "select MODERN versus LEGACY_FALLBACK",
      "create an independent writer claim",
      "change EnvironmentContext",
      "invoke legacy fallback",
      "recompute a stored route decision"
    ]) assert.ok(contract.writerRoles.sqlRepository.mustNot.includes(prohibited), prohibited);
    assert.ok(contract.writerRoles.sqlRepository.may.every((rule) => !/select.*writer|fallback/i.test(rule)), "repository capability leaked writer selection");
  });

  it("uses the reviewed call-graph audit to record EVENT_CONTROL mutation plus read-only callsites and keep Gate2 partial", () => {
    const database = readRepoFile("개발환경_고도화/runtime/src/database.ts");
    const config = readRepoFile("개발환경_고도화/runtime/src/config.ts");
    const server = readRepoFile("개발환경_고도화/runtime/src/server.ts");
    const app = readRepoFile("개발환경_고도화/runtime/src/app.ts");
    const dispatcher = readRepoFile("개발환경_고도화/runtime/src/dispatch/command-dispatcher.ts");
    const provider = readRepoFile("개발환경_고도화/runtime/src/dispatch/app-wiring-operation-provider.ts");
    const runner = readRepoFile("개발환경_고도화/runtime/src/dispatch/app-wiring-entrypoint-runner.ts");
    const shadow = readRepoFile("개발환경_고도화/runtime/src/catalog/canonical-object-shadow-read-provider.ts");
    const petExploreIngress = readRepoFile("개발환경_고도화/runtime/src/pet/pet-explore-app-wiring-ingress.ts");
    const eventControlProvider = readRepoFile("개발환경_고도화/runtime/src/pet/pet-explore-event-control-app-wiring-provider.ts");
    const petExploreSnapshot = readRepoFile("개발환경_고도화/runtime/src/pet/pet-explore-settlement-input-snapshot-provider.ts");
    const migration = readRepoFile("개발환경_고도화/runtime/migrations/466_object_db_transition_recovery_receipt_links.sql");
    const migration470 = readRepoFile("개발환경_고도화/runtime/migrations/470_pet_explore_event_control_app_wiring.sql");
    const rollback470 = readRepoFile("개발환경_고도화/runtime/migrations/rollback/470_pet_explore_event_control_app_wiring.rollback.sql");
    const legacy = readRepoFile("main.js");

    assert.match(database, /withControlledTransaction/);
    assert.match(database, /withReadOnlySnapshot/);
    assert.match(config, /HOIBOT_ENVIRONMENT_CODE/);
    assert.match(server, /verifyStartupDatabaseIdentity/);
    assert.match(server, /buildRuntimeApp\(config, \{ database, environmentContext \}\)/);
    assert.match(app, /registerAdminObjectCatalogWebRoutes\(app,/);
    assert.match(app, /new MariaAppWiringOperationProvider\(database, dependencies\.environmentContext\)/);
    assert.match(app, /new PetExploreAppWiringIngress/);
    assert.match(app, /setInterval\(\(\) =>/);
    assert.match(dispatcher, /async resolveReadOnly\(/);
    assert.match(dispatcher, /ON DUPLICATE KEY UPDATE routing_decision_id = LAST_INSERT_ID\(routing_decision_id\)/);
    assert.match(provider, /APP_WIRING_MUTATION_RECOVERY_REQUIRED/);
    assert.match(provider, /canonical_app_wiring_receipt_links/);
    assert.match(provider, /withControlledTransaction/);
    assert.match(runner, /export async function executeAppWiringEntrypoint/);
    assert.match(shadow, /withReadOnlySnapshot/);
    assert.match(petExploreIngress, /executeAppWiringEntrypoint/);
    assert.match(petExploreIngress, /receiptKind: "PET_EXPLORE_EVENT_CONTROL"/);
    assert.match(eventControlProvider, /AppWiringMutationParticipant/);
    assert.match(eventControlProvider, /canonical_pet_explore_event_control_operations/);
    assert.match(petExploreSnapshot, /previewPetExploreSettlementInput/);
    assert.match(migration, /effect_mode/);
    assert.match(migration, /canonical_app_wiring_receipt_links/);
    assert.match(migration470, /PET_EXPLORE_EVENT_CONTROL/);
    assert.match(rollback470, /DROP TABLE IF EXISTS canonical_pet_explore_event_control_operations/);
    assert.match(legacy, /const DATA_ROOT_PATH = "\/sdcard\/호이랜드\/"/);
    assert.match(legacy, /const DEV_DATA_ROOT_PATH = "\/sdcard\/호이랜드_dev\/"/);

    assert.deepEqual(contract.sourceEvidence.map(({ file }) => file), [
      "개발환경_고도화/runtime/src/database.ts",
      "개발환경_고도화/runtime/src/config.ts",
      "개발환경_고도화/runtime/src/server.ts",
      "개발환경_고도화/runtime/src/dispatch/command-dispatcher.ts",
      "개발환경_고도화/runtime/src/dispatch/app-wiring-operation-provider.ts",
      "개발환경_고도화/runtime/src/dispatch/app-wiring-entrypoint-runner.ts",
      "개발환경_고도화/runtime/src/catalog/canonical-object-shadow-read-provider.ts",
      "개발환경_고도화/runtime/migrations/466_object_db_transition_recovery_receipt_links.sql",
      "개발환경_고도화/runtime/migrations/470_pet_explore_event_control_app_wiring.sql",
      "개발환경_고도화/runtime/src/app.ts",
      "개발환경_고도화/runtime/src/pet/pet-explore-app-wiring-ingress.ts",
      "개발환경_고도화/runtime/src/pet/pet-explore-event-control-app-wiring-provider.ts",
      "개발환경_고도화/runtime/src/pet/pet-explore-settlement-input-snapshot-provider.ts",
      "개발환경_고도화/runtime/src/data-migration/object-db-runtime-adoption-audit.ts",
      "main.js"
    ]);
    assert.ok(contract.sourceEvidence.every(({ observed, missingRequired, blockingReason }) => observed.length > 0 && missingRequired.length > 0 && blockingReason.length > 0));
    assert.equal(contract.status, "PARTIALLY_IMPLEMENTED_BLOCKING_INGRESS_ADOPTION");
    assert.equal(contract.gate2Decision.status, contract.status);
    assert.equal(contract.gate2Decision.currentRuntimeCompliant, false);
    assert.equal(contract.gate2Decision.migrationFilesChanged, true);
    assert.equal(contract.gate2Decision.runtimeFilesChanged, true);
    const runtimeRoot = fileURLToPath(new URL("../", import.meta.url));
    const adoption = auditObjectDbRuntimeAdoption(runtimeRoot, contract.runtimeAdoptionAudit.reviewedSourceHashes);
    assert.deepEqual(adoption.failures, []);
    assert.equal(contract.runtimeAdoptionAudit.productionSourceCallCount, adoption.productionSourceCallCount);
    assert.equal(contract.gate2Decision.runtimeEntrypointCallCount, adoption.productionSourceCallCount);
    assert.equal(adoption.productionSourceCallCount, 3);
    assert.deepEqual(contract.runtimeAdoptionAudit.connectedIngressFamilies, adoption.connectedIngressFamilies);
    assert.deepEqual(contract.runtimeAdoptionAudit.effectModes, ["MODERN_MUTATION", "SHADOW", "REJECT"]);
    assert.equal(contract.runtimeAdoptionAudit.entrypointKind, "IRIS");
    assert.deepEqual(contract.runtimeAdoptionAudit.domains, ["PET_EXPLORE", "ADMIN_PET_DATA_COMPARE", "PET_TITLE"]);
    assert.equal(contract.gate2Decision.acceptedEvidence.P2, "VERIFIED_ISOLATED_MARIADB_FORWARD_REPLAY_ROLLBACK_RESTART");
    assert.doesNotMatch(contract.gate2Decision.promotionRequirement, /complete P2 isolated MariaDB validation/);
    assert.match(contract.scope, /PET_EXPLORE EVENT_CONTROL and PET_TITLE SELL have MODERN\/MUTATION adoption/);
    assert.match(contract.scope, /isolated MariaDB P2 validation are implemented/);
  });
});
