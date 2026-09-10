import { readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import { buildObjectDbConsumerExecutableParityLedger, listObjectDbExecutableParityEvidencePaths } from "../src/data-migration/object-db-consumer-executable-parity-ledger.js";

const runtimeRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(runtimeRoot, "../..");
const paths = {
  ledgerSchema: "개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-ledger.v1.schema.json",
  executionReceiptSchema: "개발환경_고도화/migration-control/contracts/object-db-consumer-execution-receipt.v1.schema.json",
  consumerManifest: "개발환경_고도화/migration-control/contracts/object-db-consumer-manifest.v1.json",
  consumerIdRegistry: "개발환경_고도화/migration-control/contracts/object-db-consumer-id-registry.v1.json",
  transitionContract: "개발환경_고도화/migration-control/contracts/object-db-consumer-transition.v1.json",
  executionReceipts: "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave34-v1.json",
} as const;
const output = resolve(repoRoot, "개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-ledger.v1.json");
const consumerManifestText = readFileSync(resolve(repoRoot, paths.consumerManifest), "utf8");
const manifest = JSON.parse(consumerManifestText);
const executionReceiptsText = readFileSync(resolve(repoRoot, paths.executionReceipts), "utf8");
const evidenceFileTexts = Object.fromEntries(listObjectDbExecutableParityEvidencePaths(executionReceiptsText).map((path) => [path, readFileSync(resolve(repoRoot, path), "utf8")]));
const classificationSourcePaths = [...new Set<string>(manifest.audit.registrySourceMismatches.map((value: string) => value.slice(0, value.indexOf(":"))))].sort();
classificationSourcePaths.push("개발환경_고도화/migration-control/contracts/object-db-consumer-classification-delta.SCD-OBJ-20260910-33.v1.json");
classificationSourcePaths.push("개발환경_고도화/migration-control/contracts/object-db-consumer-classification-delta.SCD-OBJ-20260910-34.v1.json");
classificationSourcePaths.sort();
const classificationSourceTexts = Object.fromEntries(classificationSourcePaths.map((path) => [path, readFileSync(resolve(repoRoot, path), "utf8")]));

const ledger = buildObjectDbConsumerExecutableParityLedger({
  ledgerSchemaText: readFileSync(resolve(repoRoot, paths.ledgerSchema), "utf8"),
  executionReceiptSchemaText: readFileSync(resolve(repoRoot, paths.executionReceiptSchema), "utf8"),
  consumerManifestText,
  consumerIdRegistryText: readFileSync(resolve(repoRoot, paths.consumerIdRegistry), "utf8"),
  transitionContractText: readFileSync(resolve(repoRoot, paths.transitionContract), "utf8"),
  executionReceiptsText,
  classificationSourceTexts,
  sourcePaths: paths,
  evidenceFileTexts,
});

writeFileSync(output, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  output: relative(repoRoot, output).replaceAll("\\", "/"),
  entrySetSha256: ledger.entrySetSha256,
  coverage: ledger.coverage,
}));
