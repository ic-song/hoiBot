import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const runtimeRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(runtimeRoot, "../..");
const manifestPath = "개발환경_고도화/migration-control/contracts/object-db-consumer-manifest.v1.json";
const ledgerPath = "개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-ledger.v1.json";
const outputPath = "개발환경_고도화/migration-control/contracts/object-db-consumer-residual-work-plan.v1.json";

const read = (path: string): string => readFileSync(resolve(repoRoot, path), "utf8");
const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const normalizeLf = (value: string): string => value.replace(/\r\n?/g, "\n");
const countBy = <T>(values: readonly T[], key: (value: T) => string): Record<string, number> =>
  Object.fromEntries([...new Set(values.map(key))].sort().map((candidate) => [candidate, values.filter((value) => key(value) === candidate).length]));

const reusableEvidence = new Map<string, { readonly evidenceKind: "EVIDENCE_BUNDLE" | "SEALED_OBSERVATION" | "REUSABLE_HARNESS"; readonly evidenceRefs: readonly string[]; readonly evidenceCommit: string }>([
  ["legacy-94904fa11988ff04", { evidenceKind: "EVIDENCE_BUNDLE", evidenceCommit: "909fc1ab3ca3f39f1cdec14bb189b695404a9698", evidenceRefs: ["개발환경_고도화/migration-control/evidence/item-bag-canonical-shadow-lease2604/"] }],
]);

const rocketConsumerIds = new Set([
  "legacy-15076f1474d3bf90",
  "legacy-16dc4874712ffe07",
  "legacy-1e1016af0dea53d4",
  "legacy-7c3e90397c74fdc0",
  "legacy-7fa084c426801da5",
  "legacy-8befb54eb907db04",
  "legacy-b9a3e9684a6c3909",
  "legacy-cc1ca98a74fa80e5",
  "legacy-dec710bc74968473",
  "legacy-b455212232514478",
]);

const manifestText = read(manifestPath);
const ledgerText = read(ledgerPath);
const manifest = JSON.parse(manifestText) as { readonly baseCommit: string; readonly consumers: readonly Record<string, any>[]; readonly consumerSetSha256: string };
const ledger = JSON.parse(ledgerText) as { readonly catalogVersion: string; readonly classificationBaseCommit: string; readonly entrySetSha256: string; readonly coverage: Record<string, unknown>; readonly entries: readonly Record<string, any>[] };
const manifestById = new Map(manifest.consumers.map((consumer) => [consumer.consumerId as string, consumer]));
const residualLedgerEntries = ledger.entries.filter((entry) => entry.verdict !== "DIRECT_PASS" && entry.verdict !== "EQUIVALENT_PASS");
const residualLedgerById = new Map(residualLedgerEntries.map((entry) => [entry.consumerId as string, entry]));
const manifestIds = manifest.consumers.map((consumer) => consumer.consumerId as string);
const ledgerIds = ledger.entries.map((entry) => entry.consumerId as string);
if (manifestById.size !== manifestIds.length || new Set(ledgerIds).size !== ledgerIds.length) throw new Error("Residual plan duplicate consumer ID");
if (JSON.stringify([...manifestIds].sort()) !== JSON.stringify([...ledgerIds].sort())) throw new Error("Residual plan manifest/ledger consumer set mismatch");
if (sha256(JSON.stringify(manifest.consumers)) !== manifest.consumerSetSha256) throw new Error("Residual plan manifest consumerSetSha256 drift");
if (sha256(JSON.stringify(ledger.entries)) !== ledger.entrySetSha256) throw new Error("Residual plan ledger entrySetSha256 drift");
if (manifest.baseCommit !== ledger.classificationBaseCommit) throw new Error("Residual plan classification base commit drift");
const allowedVerdicts = new Set(["DIRECT_PASS", "EQUIVALENT_PASS", "STATIC_ONLY", "BLOCKED_DYNAMIC"]);
for (const entry of ledger.entries) if (!allowedVerdicts.has(entry.verdict as string)) throw new Error(`Residual plan unknown verdict: ${entry.verdict}`);

for (const consumerId of [...reusableEvidence.keys(), ...rocketConsumerIds]) {
  if (!manifestById.has(consumerId)) throw new Error(`Residual plan consumer missing from manifest: ${consumerId}`);
}
for (const [consumerId, evidence] of reusableEvidence) {
  if (!/^[a-f0-9]{40}$/.test(evidence.evidenceCommit)) throw new Error(`Residual evidence commit is not full SHA-1: ${consumerId}`);
  for (const evidenceRef of evidence.evidenceRefs) {
    if (!existsSync(resolve(repoRoot, evidenceRef))) throw new Error(`Residual evidence path missing: ${consumerId} ${evidenceRef}`);
  }
}
if (new Set([...reusableEvidence.keys(), ...rocketConsumerIds]).size !== reusableEvidence.size + rocketConsumerIds.size) {
  throw new Error("Residual plan categories overlap");
}

const rocketEquivalenceProjection = (consumerId: string): Record<string, unknown> => {
  const consumer = manifestById.get(consumerId);
  const ledgerEntry = residualLedgerById.get(consumerId);
  if (consumer === undefined || ledgerEntry === undefined) throw new Error(`Rocket equivalence consumer missing: ${consumerId}`);
  return {
    interfaceId: consumer.interfaceId,
    accessClass: ledgerEntry.classification.accessClass,
    sourceSpan: consumer.sourceSpan,
    targetTables: consumer.usedTargetTables,
    targetColumns: consumer.usedTargetColumns,
    transactionOwnerInterfaceId: consumer.transactionOwnerInterfaceId,
    transactionParticipantInterfaceIds: consumer.transactionParticipantInterfaceIds,
    operationReceiptTables: consumer.operationReceiptTables,
    scenarioRequirements: ledgerEntry.scenarioRequirements.map((requirement: Record<string, any>) => ({
      scenarioKind: requirement.scenarioKind,
      disposition: requirement.disposition,
      notApplicable: requirement.notApplicable === null ? null : {
        ruleId: requirement.notApplicable.ruleId,
        reasonCode: requirement.notApplicable.reasonCode,
        reason: requirement.notApplicable.reason,
      },
    })),
  };
};
const rocketEquivalenceProjections = [...rocketConsumerIds].map(rocketEquivalenceProjection);
const rocketRepresentative = rocketEquivalenceProjections[0];
if (rocketRepresentative === undefined || rocketEquivalenceProjections.some((projection) => JSON.stringify(projection) !== JSON.stringify(rocketRepresentative))) {
  throw new Error("Rocket equivalence cohort is not strictly equivalent");
}
const rocketEquivalenceKeySha256 = sha256(JSON.stringify({
  ruleId: "SAME_INTERFACE_ACCESS_V1",
  interfaceId: rocketRepresentative.interfaceId,
  accessClass: rocketRepresentative.accessClass,
}));
const rocketStrictProjectionSha256 = sha256(JSON.stringify({ ruleId: "RESIDUAL_STRICT_PROJECTION_V1", ...rocketRepresentative }));
const completeInterfaceAccessCohort = ledger.entries
  .filter((entry) => entry.classification.interfaceId === rocketRepresentative.interfaceId && entry.classification.accessClass === rocketRepresentative.accessClass)
  .map((entry) => entry.consumerId as string)
  .sort();
if (JSON.stringify(completeInterfaceAccessCohort) !== JSON.stringify([...rocketConsumerIds].sort())) {
  throw new Error("Rocket equivalence cohort is not the complete interface/access set");
}

const entries = residualLedgerEntries.map((ledgerEntry) => {
  const consumer = manifestById.get(ledgerEntry.consumerId as string);
  if (consumer === undefined) throw new Error(`Residual ledger consumer missing from manifest: ${ledgerEntry.consumerId}`);
  const reusable = reusableEvidence.get(consumer.consumerId);
  const category = reusable !== undefined
    ? "A_REUSABLE_PROOF_ASSET"
    : rocketConsumerIds.has(consumer.consumerId)
      ? "B_STRICT_EQUIVALENCE"
      : ledgerEntry.verdict === "BLOCKED_DYNAMIC"
        ? "D_PREREQUISITE"
        : "C_DIRECT_EXECUTION";
  return {
    consumerId: consumer.consumerId,
    category,
    domain: consumer.primarySlice,
    kind: consumer.kind,
    accessClass: ledgerEntry.classification.accessClass,
    interfaceId: consumer.interfaceId,
    sourceSpanSha256: consumer.sourceSpan.sha256,
    targetTables: consumer.usedTargetTables,
    targetColumns: consumer.usedTargetColumns,
    transactionOwnerInterfaceId: consumer.transactionOwnerInterfaceId,
    transactionParticipantInterfaceIds: consumer.transactionParticipantInterfaceIds,
    operationReceiptTables: consumer.operationReceiptTables,
    scenarioRequirements: ledgerEntry.scenarioRequirements,
    nextAction: category === "A_REUSABLE_PROOF_ASSET"
      ? "REEXECUTE_OR_RESEAL_AS_OFFICIAL_RECEIPTS"
      : category === "B_STRICT_EQUIVALENCE"
        ? "RUN_ONE_REPRESENTATIVE_AND_PROVE_EQUIVALENCE"
        : category === "D_PREREQUISITE"
          ? "ADD_EXPLICIT_PORT_OR_DISPATCH_BOUNDARY"
          : "RUN_DIRECT_CONSUMER_PROOF",
    evidenceCandidate: reusable ?? null,
    equivalenceCohortId: category === "B_STRICT_EQUIVALENCE" ? "ITEM-ROCKET-ADMIN-GRANT-01" : null,
    blockers: category === "D_PREREQUISITE" ? consumer.p1Bridges : [],
  };
}).sort((left, right) => left.consumerId.localeCompare(right.consumerId));
for (const entry of entries) {
  if (entry.category === "D_PREREQUISITE" && entry.blockers.length === 0) throw new Error(`Residual prerequisite has no blocker: ${entry.consumerId}`);
}

const categoryCounts = countBy(entries, (entry) => entry.category);
const expectedCounts = {
  A_REUSABLE_PROOF_ASSET: 1,
  B_STRICT_EQUIVALENCE: 10,
  C_DIRECT_EXECUTION: 995,
  D_PREREQUISITE: 82,
};
if (entries.length !== 1_088 || JSON.stringify(categoryCounts) !== JSON.stringify(expectedCounts)) {
  throw new Error(`Residual plan cardinality drift: ${JSON.stringify({ total: entries.length, categoryCounts })}`);
}

const output = {
  format: "OBJECT_DB_CONSUMER_RESIDUAL_WORK_PLAN_V1",
  catalogVersion: ledger.catalogVersion,
  frozenAt: "2026-09-09 14:40:00 KST",
  integrationBaseline: "4dc632fb55aa0add134d0d0b0b4dcec9d4e2a894",
  dependencyResolutions: [
    { wbs: "WBS791", commit: "854502debd9a7df249a022352468384bf1a42f4d", resolution: "APP_WIRING_ROOT_RETRY_COMPLETED" },
    { wbs: "WBS791", commit: "a91c2e3405ebc70b7c1301a563b0b216a1ddf4b3", resolution: "CHANGE_STACK_QUANTITY_OFFICIAL_RECEIPTS" },
  ],
  sources: {
    textNormalization: "LF_UTF8",
    manifestPath,
    manifestSha256: sha256(normalizeLf(manifestText)),
    manifestConsumerSetSha256: manifest.consumerSetSha256,
    ledgerPath,
    ledgerSha256: sha256(normalizeLf(ledgerText)),
    ledgerEntrySetSha256: ledger.entrySetSha256,
  },
  policy: {
    A_REUSABLE_PROOF_ASSET: "A prior bundle, observation or harness is reusable input only; it is not completed proof and requires re-execution or exact resealing as official receipts.",
    B_STRICT_EQUIVALENCE: "One representative may cover the cohort only when interface, access, source span, targets, owner, participants, receipts and scenario dispositions match.",
    C_DIRECT_EXECUTION: "Consumer-specific executable evidence is required.",
    D_PREREQUISITE: "Explicit runtime port or dispatch boundary is required before executable evidence.",
    fullRegression: "Run once for the fixed final integration candidate; expand earlier only for broad or unknown impact.",
  },
  equivalenceCohorts: [{
    cohortId: "ITEM-ROCKET-ADMIN-GRANT-01",
    ruleId: "SAME_INTERFACE_ACCESS_V1",
    equivalenceKeySha256: rocketEquivalenceKeySha256,
    strictProjectionRuleId: "RESIDUAL_STRICT_PROJECTION_V1",
    strictProjectionSha256: rocketStrictProjectionSha256,
    strictProjection: rocketRepresentative,
    sourceSpanSha256: (rocketRepresentative.sourceSpan as Record<string, unknown>).sha256,
    consumerIds: [...rocketConsumerIds].sort(),
  }],
  summary: {
    manifestConsumers: manifest.consumers.length,
    alreadyDirectOrEquivalent: ledger.entries.length - entries.length,
    residualConsumers: entries.length,
    categoryCounts,
    byDomain: countBy(entries, (entry) => entry.domain),
    byKind: countBy(entries, (entry) => entry.kind),
    byAccessClass: countBy(entries, (entry) => entry.accessClass),
  },
  entries,
};

const serializedOutput = `${JSON.stringify(output, null, 2)}\n`;
if (process.argv.includes("--check")) {
  if (normalizeLf(read(outputPath)) !== serializedOutput) throw new Error(`Residual plan is stale: ${outputPath}`);
} else {
  writeFileSync(resolve(repoRoot, outputPath), serializedOutput, "utf8");
}
console.log(JSON.stringify({ outputPath, checked: process.argv.includes("--check"), summary: output.summary }));
