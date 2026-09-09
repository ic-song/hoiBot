import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const contractPath = "개발환경_고도화/migration-control/contracts/mini-pet-title-collection-gate1-classification.v1.json";

type InputEvidence = { path: string; sha256: string };
type ManifestConsumer = {
  consumerId: string;
  primarySlice: string;
  access: string;
  sourceSpan: { start: number; end: number; sha256: string };
};
type LedgerEntry = { consumerId: string; verdict: string };
type ClassifiedConsumer = {
  consumerId: string;
  access: string;
  runtimePort: string;
  transactionOwner: string;
  receiptOwner: string | null;
};
type Contract = {
  format: string;
  wbs: string;
  lease: string;
  status: string;
  baselineCommit: string;
  slice: string;
  inputs: {
    manifest: InputEvidence;
    ledger: InputEvidence;
    legacySource: InputEvidence;
    repositorySource: InputEvidence;
    operationMigration: InputEvidence;
    participantMigration: InputEvidence;
    catalogReplayPatternMigration: InputEvidence;
  };
  selectionRule: { manifestConsumerCount: number; selectedConsumerCount: number; excludedDirectPassConsumerIds: string[] };
  consumers: ClassifiedConsumer[];
  authorizationContracts: Array<{ consumerId: string; sourceGuard: string; decision: string; participantRoles: string[] }>;
  repositoryReceiptReplay: {
    applicableConsumerIds: string[];
    participantRoles: string[];
    uniqueLocator: string[];
    terminalStatus: string;
    exactReplay: string;
    payloadDrift: string;
    currentGap: string;
  };
  catalogMutationReplay: {
    applicableConsumerIds: string[];
    playerScopedOperationTableForbidden: string;
    implementationStatus: string;
    requiredAdditiveReceiptTable: string;
    patternTable: string;
    uniqueLocator: string[];
    migrationRule: string;
  };
  legacyNormalizationPolicy: {
    affectedConsumerIds: string[];
    canonicalIngressRule: string;
    maintenanceOwner: string;
    receiptScope: string;
    implementationStatus: string;
    publicRankCompatibility: string;
  };
  compositeTransactionOwners: Array<{
    owner: string;
    entryConsumerId: string;
    externalPreparationConsumerId?: string;
    participants: string[];
    rollback: string;
    replay: string;
  }>;
  legacyRuntimeFailClose: { status: string; requiredPorts: string[]; forbiddenFallbacks: string[] };
  gate2BlockingRisks: Array<{ severity: string; id: string }>;
  forbiddenAtGate1: string[];
};

function readText(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

function readJson<T>(path: string): T {
  return JSON.parse(readText(path)) as T;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function canonicalSource(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function tableDdl(text: string, table: string): string {
  const start = text.indexOf(`CREATE TABLE${text.includes(`CREATE TABLE IF NOT EXISTS ${table}`) ? " IF NOT EXISTS" : ""} ${table}`);
  assert.notEqual(start, -1, table);
  const end = text.indexOf("ENGINE=InnoDB", start);
  assert.notEqual(end, -1, table);
  return text.slice(start, end);
}

const contract = readJson<Contract>(contractPath);
const manifest = readJson<{ consumers: ManifestConsumer[] }>(contract.inputs.manifest.path);
const ledger = readJson<{ entries: LedgerEntry[] }>(contract.inputs.ledger.path);

describe("Lease2621 mini-pet-title collection Gate1 classification", () => {
  it("pins every input and the exact task baseline", () => {
    assert.equal(contract.format, "hoibot-mini-pet-title-collection-gate1-classification-v1");
    assert.equal(contract.wbs, "WBS793");
    assert.equal(contract.lease, "Lease2621");
    assert.equal(contract.status, "GATE1_CLASSIFIED");
    assert.equal(contract.baselineCommit, "d99832c56972c7ff81fbe7a075fc65869a7192bf");
    for (const input of Object.values(contract.inputs)) {
      assert.equal(sha256(readText(input.path)), input.sha256, input.path);
    }
  });

  it("selects exactly the 14 non-DIRECT consumers and preserves frozen spans", () => {
    const sliceConsumers = manifest.consumers.filter((consumer) => consumer.primarySlice === contract.slice);
    const ledgerById = new Map(ledger.entries.map((entry) => [entry.consumerId, entry]));
    const selected = sliceConsumers
      .filter((consumer) => ledgerById.get(consumer.consumerId)?.verdict !== "DIRECT_PASS")
      .sort((left, right) => left.consumerId.localeCompare(right.consumerId));

    assert.equal(sliceConsumers.length, contract.selectionRule.manifestConsumerCount);
    assert.equal(selected.length, contract.selectionRule.selectedConsumerCount);
    assert.deepEqual(contract.consumers.map((consumer) => consumer.consumerId), selected.map((consumer) => consumer.consumerId));
    assert.deepEqual(contract.selectionRule.excludedDirectPassConsumerIds, ["sql-repository-6a1bdfaafba10749"]);
    assert.equal(ledgerById.get("sql-repository-6a1bdfaafba10749")?.verdict, "DIRECT_PASS");
    assert.ok(selected.every((consumer) => ledgerById.get(consumer.consumerId)?.verdict === "STATIC_ONLY"));

    for (const consumer of selected) {
      const input = consumer.consumerId.startsWith("legacy-") ? contract.inputs.legacySource : contract.inputs.repositorySource;
      const source = canonicalSource(readText(input.path));
      assert.equal(sha256(source.slice(consumer.sourceSpan.start, consumer.sourceSpan.end)), consumer.sourceSpan.sha256, consumer.consumerId);
      assert.equal(contract.consumers.find((entry) => entry.consumerId === consumer.consumerId)?.access, consumer.access);
    }
  });

  it("classifies add and remove as master-only silent-deny commands", () => {
    assert.deepEqual(contract.authorizationContracts.map((entry) => entry.consumerId), [
      "legacy-cb9358f157d74d5e",
      "legacy-ed6659b495a1d419"
    ]);
    const source = canonicalSource(readText(contract.inputs.legacySource.path));
    for (const auth of contract.authorizationContracts) {
      const entry = manifest.consumers.find((consumer) => consumer.consumerId === auth.consumerId);
      assert.ok(entry);
      const span = source.slice(entry.sourceSpan.start, entry.sourceSpan.end);
      assert.match(span, /if \(!isMaster\(sender\)\) \{\s*return;\s*\}/);
      assert.equal(auth.sourceGuard, "if (!isMaster(sender)) return");
      assert.equal(auth.decision, "MASTER_ONLY_SILENT_DENY");
      assert.deepEqual(auth.participantRoles, ["OWNER", "RECIPIENT"]);
    }
  });

  it("assigns the canonical receipt and exposes the repository replay gap", () => {
    const operationDdl = readText(contract.inputs.operationMigration.path);
    const participantDdl = readText(contract.inputs.participantMigration.path);
    const catalogPatternDdl = readText(contract.inputs.catalogReplayPatternMigration.path);
    const repository = readText(contract.inputs.repositorySource.path);
    const ownershipReceiptDdl = tableDdl(operationDdl, "canonical_mini_pet_title_operations");
    const catalogReceiptPatternDdl = tableDdl(catalogPatternDdl, "canonical_package_definition_replays");
    assert.match(operationDdl, /CREATE TABLE IF NOT EXISTS canonical_mini_pet_title_operations/);
    assert.match(operationDdl, /UNIQUE KEY uq_odbt_463_05_01 \(replay_namespace, player_id, request_key\)/);
    assert.match(participantDdl, /CREATE TABLE IF NOT EXISTS canonical_mini_pet_title_operation_participants/);
    assert.match(participantDdl, /participant_role IN \('OWNER','RECIPIENT'\)/);
    assert.match(ownershipReceiptDdl, /player_id CHAR\(8\).*NOT NULL/);
    assert.deepEqual(contract.repositoryReceiptReplay.uniqueLocator, ["replay_namespace", "player_id", "request_key"]);
    assert.deepEqual(contract.repositoryReceiptReplay.participantRoles, ["OWNER", "RECIPIENT"]);
    assert.equal(contract.repositoryReceiptReplay.terminalStatus, "COMPLETED");
    assert.equal(contract.repositoryReceiptReplay.exactReplay, "RETURN_COMMITTED_RESULT_WITH_ZERO_DOMAIN_DML");
    assert.equal(contract.repositoryReceiptReplay.payloadDrift, "FAIL_CLOSED");
    assert.deepEqual(contract.repositoryReceiptReplay.applicableConsumerIds, [
      "sql-repository-099449f24cdb2763",
      "sql-repository-c5361160b1d4362b",
      "sql-repository-fd6a78de68e8f580"
    ]);
    assert.doesNotMatch(repository, /canonical_mini_pet_title_operations|canonical_mini_pet_title_operation_participants/);
    assert.match(contract.repositoryReceiptReplay.currentGap, /do not write/);
    assert.match(catalogPatternDdl, /CREATE TABLE canonical_package_definition_replays/);
    assert.doesNotMatch(catalogReceiptPatternDdl, /player_id/);
    assert.match(catalogReceiptPatternDdl, /source_system VARCHAR\(50\).*NOT NULL/);
    assert.match(catalogReceiptPatternDdl, /UNIQUE KEY uq_canonical_package_definition_request \(source_system, source_namespace, request_key\)/);
    assert.deepEqual(contract.catalogMutationReplay.applicableConsumerIds, [
      "sql-repository-649707c7a4a4b178",
      "sql-repository-81ba01f732909dc7"
    ]);
    assert.equal(contract.catalogMutationReplay.implementationStatus, "PLANNED_NOT_IMPLEMENTED");
    assert.equal(contract.catalogMutationReplay.requiredAdditiveReceiptTable, "canonical_mini_pet_title_definition_replays");
    assert.equal(contract.catalogMutationReplay.patternTable, "canonical_package_definition_replays");
    assert.deepEqual(contract.catalogMutationReplay.uniqueLocator, ["source_system", "source_namespace", "request_key"]);
    assert.match(contract.catalogMutationReplay.playerScopedOperationTableForbidden, /player_id is NOT NULL/);
    assert.match(contract.catalogMutationReplay.migrationRule, /Gate1 does not claim/);
    for (const consumerId of contract.catalogMutationReplay.applicableConsumerIds) {
      const consumer = contract.consumers.find((entry) => entry.consumerId === consumerId);
      assert.equal(consumer?.receiptOwner, null);
      assert.equal(consumer?.transactionOwner, "CATALOG_ADMIN_REPLAY_ROOT_PENDING_ADDITIVE_SCHEMA");
    }
  });

  it("keeps sale and collection confirmation under one root each", () => {
    const byOwner = new Map(contract.compositeTransactionOwners.map((owner) => [owner.owner, owner]));
    const sale = byOwner.get("MINI_PET_TITLE_SALE_ROOT");
    const collection = byOwner.get("MINI_PET_COLLECTION_CONFIRM_ROOT");
    assert.ok(sale);
    assert.ok(collection);
    assert.equal(sale.entryConsumerId, "legacy-65bdcd5c86aaa184");
    assert.deepEqual(sale.participants, [
      "mini-pet-title.ownership.release",
      "currency.point.credit",
      "canonical_mini_pet_title_operations.complete"
    ]);
    assert.match(sale.rollback, /both roll back/);
    assert.match(sale.replay, /zero domain DML/);
    assert.equal(collection.entryConsumerId, "legacy-52a2111d587077dc");
    assert.equal(collection.externalPreparationConsumerId, "legacy-a63d581be22c019d");
    assert.ok(collection.participants.includes("mini-pet.ownership.consume"));
    assert.ok(collection.participants.includes("mini-pet.enhancement.auto-upgrade"));
    assert.ok(collection.participants.includes("mini-pet-title.ownership.grant"));
    assert.match(collection.rollback, /all roll back/);
    assert.equal(
      contract.consumers.find((entry) => entry.consumerId === "sql-repository-099449f24cdb2763")?.transactionOwner,
      "REPOSITORY_OPERATION_ROOT_OR_COMPOSITE_PARTICIPANT"
    );
  });

  it("keeps public ranking pure-read and moves normalization to non-player maintenance", () => {
    const rank = contract.consumers.find((entry) => entry.consumerId === "legacy-6a42c658dfc99e35");
    assert.ok(rank);
    assert.equal(rank.receiptOwner, null);
    assert.equal(rank.transactionOwner, "READ_ONLY_CANONICAL_PLUS_SEPARATE_MAINTENANCE_REPAIR");
    assert.deepEqual(contract.legacyNormalizationPolicy.affectedConsumerIds, [
      "legacy-6a42c658dfc99e35",
      "legacy-ae36b9a9e188508d"
    ]);
    assert.match(contract.legacyNormalizationPolicy.canonicalIngressRule, /pure READ/);
    assert.equal(contract.legacyNormalizationPolicy.maintenanceOwner, "MINI_PET_COLLECTION_NORMALIZATION_MAINTENANCE_ROOT");
    assert.equal(contract.legacyNormalizationPolicy.receiptScope, "NON_PLAYER_MAINTENANCE_RECEIPT_PENDING_ADDITIVE_SCHEMA");
    assert.equal(contract.legacyNormalizationPolicy.implementationStatus, "PLANNED_NOT_IMPLEMENTED");
    assert.match(contract.legacyNormalizationPolicy.publicRankCompatibility, /player_id is NOT NULL/);
  });

  it("fails closed until all nine legacy runtime ports are bound", () => {
    const legacyConsumers = contract.consumers.filter((consumer) => consumer.consumerId.startsWith("legacy-"));
    assert.equal(legacyConsumers.length, 9);
    assert.equal(contract.legacyRuntimeFailClose.status, "BLOCKED_UNTIL_ALL_PORTS_BOUND");
    for (const consumer of legacyConsumers) {
      assert.ok(contract.legacyRuntimeFailClose.requiredPorts.includes(consumer.runtimePort), consumer.consumerId);
    }
    assert.ok(contract.legacyRuntimeFailClose.requiredPorts.includes("canonical-player-identity.resolve"));
    assert.ok(contract.legacyRuntimeFailClose.forbiddenFallbacks.includes("legacy display-name identity"));
    assert.ok(contract.legacyRuntimeFailClose.forbiddenFallbacks.includes("nested repository root transaction inside a composite owner"));
    assert.deepEqual(contract.gate2BlockingRisks.map((risk) => risk.severity), ["P1", "P1", "P1", "P1", "P1", "P1"]);
    assert.deepEqual(contract.forbiddenAtGate1, ["shared ledger mutation", "receipt promotion", "production database", "port 3306", "operational data", "live room", "external network", "feature/prod"]);
  });
});
