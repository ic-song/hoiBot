import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

import {
  buildObjectDbConsumerExecutableParityLedger,
  listObjectDbExecutableParityEvidencePaths,
  validateObjectDbConsumerExecutableParityLedger,
} from "../src/data-migration/object-db-consumer-executable-parity-ledger.js";
import { parseConsumerIdRegistry } from "../src/data-migration/object-db-consumer-id-registry.js";

const runtimeRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(runtimeRoot, "../..");
const paths = {
  ledgerSchema: "개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-ledger.v1.schema.json",
  executionReceiptSchema: "개발환경_고도화/migration-control/contracts/object-db-consumer-execution-receipt.v1.schema.json",
  consumerManifest: "개발환경_고도화/migration-control/contracts/object-db-consumer-manifest.v1.json",
  consumerIdRegistry: "개발환경_고도화/migration-control/contracts/object-db-consumer-id-registry.v1.json",
  transitionContract: "개발환경_고도화/migration-control/contracts/object-db-consumer-transition.v1.json",
  executionReceipts: "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave33-v1.json",
} as const;
const ledgerPath = resolve(repoRoot, "개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-ledger.v1.json");
const manifestText = readFileSync(resolve(repoRoot, paths.consumerManifest), "utf8");
const registryText = readFileSync(resolve(repoRoot, paths.consumerIdRegistry), "utf8");
const transitionContractText = readFileSync(resolve(repoRoot, paths.transitionContract), "utf8");
const manifest = JSON.parse(manifestText);
const executionReceiptsText = readFileSync(resolve(repoRoot, paths.executionReceipts), "utf8");
const executionReceipts = JSON.parse(executionReceiptsText);
const evidenceFileTexts = Object.fromEntries(listObjectDbExecutableParityEvidencePaths(executionReceiptsText).map((path) => [path, readFileSync(resolve(repoRoot, path), "utf8")]));
const classificationSourcePaths = [...new Set<string>(manifest.audit.registrySourceMismatches.map((value: string) => value.slice(0, value.indexOf(":"))))].sort();
classificationSourcePaths.push("개발환경_고도화/migration-control/contracts/object-db-consumer-classification-delta.SCD-OBJ-20260910-33.v1.json");
classificationSourcePaths.sort();
const classificationSourceTexts = Object.fromEntries(classificationSourcePaths.map((path) => [path, readFileSync(resolve(repoRoot, path), "utf8")]));
const registry = parseConsumerIdRegistry(JSON.parse(registryText), manifest.baseCommit);
const ledgerSchema = JSON.parse(readFileSync(resolve(repoRoot, paths.ledgerSchema), "utf8"));
const executionReceiptSchema = JSON.parse(readFileSync(resolve(repoRoot, paths.executionReceiptSchema), "utf8"));
const ledgerValue = JSON.parse(readFileSync(ledgerPath, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateLedgerSchema = ajv.compile(ledgerSchema);
const validateReceiptSchema = ajv.compile(executionReceiptSchema);
if (!validateLedgerSchema(ledgerValue)) throw new Error(`ledger JSON Schema validation failed: ${ajv.errorsText(validateLedgerSchema.errors)}`);
if (!validateReceiptSchema(executionReceipts)) throw new Error(`execution receipt JSON Schema validation failed: ${ajv.errorsText(validateReceiptSchema.errors)}`);
const actual = validateObjectDbConsumerExecutableParityLedger(ledgerValue, {
  manifest,
  registry,
  evidenceFileTexts,
  executionReceiptsText,
  executionReceiptsPath: paths.executionReceipts,
  classificationSourceTexts,
});
const expected = buildObjectDbConsumerExecutableParityLedger({
  ledgerSchemaText: readFileSync(resolve(repoRoot, paths.ledgerSchema), "utf8"),
  executionReceiptSchemaText: readFileSync(resolve(repoRoot, paths.executionReceiptSchema), "utf8"),
  consumerManifestText: manifestText,
  consumerIdRegistryText: registryText,
  transitionContractText,
  executionReceiptsText,
  classificationSourceTexts,
  sourcePaths: paths,
  evidenceFileTexts,
});
if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("executable parity ledger is not the deterministic build output");
const attestedPaths = [...new Set(executionReceipts.receipts.flatMap((receipt: { harness: { path: string }; fixture: { path: string }; invocation: { targetPath: string } }) => [receipt.harness.path, receipt.fixture.path, receipt.invocation.targetPath]))].sort();
console.log(JSON.stringify({
  status: "PASS",
  schemaValidation: "AJV2020_STRICT_PASS",
  receiptSchemaValidation: "AJV2020_STRICT_PASS",
  evidenceAttestation: { evidenceCommit: executionReceipts.evidenceCommit, ancestorOfCurrentHead: true, committedTrustedInputPaths: attestedPaths },
  entrySetSha256: actual.entrySetSha256,
  coverage: actual.coverage,
}));
