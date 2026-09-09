import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { buildObjectDbConsumerExecutableParityLedger, parseObjectDbConsumerExecutionReceiptBundle, sha256CanonicalText, type ConsumerManifestInput, type ObjectDbConsumerExecutionReceiptBundle } from "../src/data-migration/object-db-consumer-executable-parity-ledger.js";
import { parseConsumerIdRegistry } from "../src/data-migration/object-db-consumer-id-registry.js";

const runtimeRoot=resolve(import.meta.dirname,".."),repoRoot=resolve(runtimeRoot,"../.."),read=(path:string):string=>readFileSync(resolve(repoRoot,path),"utf8");
const paths={ledgerSchema:"개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-ledger.v1.schema.json",executionReceiptSchema:"개발환경_고도화/migration-control/contracts/object-db-consumer-execution-receipt.v1.schema.json",consumerManifest:"개발환경_고도화/migration-control/contracts/object-db-consumer-manifest.v1.json",consumerIdRegistry:"개발환경_고도화/migration-control/contracts/object-db-consumer-id-registry.v1.json",transitionContract:"개발환경_고도화/migration-control/contracts/object-db-consumer-transition.v1.json",executionReceipts:"개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave23-v1.json"} as const;
const manifestText=read(paths.consumerManifest),manifest=JSON.parse(manifestText) as ConsumerManifestInput,registryText=read(paths.consumerIdRegistry),registry=parseConsumerIdRegistry(JSON.parse(registryText),manifest.baseCommit);
const classificationSourceTexts=Object.fromEntries([...new Set(manifest.audit.registrySourceMismatches.map((label)=>label.slice(0,label.indexOf(":"))))].sort().map((path)=>[path,read(path)]));
function build(bundle:ObjectDbConsumerExecutionReceiptBundle){const evidencePaths=[...new Set(bundle.receipts.flatMap(receipt=>[receipt.harness.path,receipt.fixture.path,receipt.invocation.targetPath]))],evidenceFileTexts=Object.fromEntries(evidencePaths.map(path=>[path,read(path)]));return buildObjectDbConsumerExecutableParityLedger({ledgerSchemaText:read(paths.ledgerSchema),executionReceiptSchemaText:read(paths.executionReceiptSchema),consumerManifestText:manifestText,consumerIdRegistryText:registryText,transitionContractText:read(paths.transitionContract),executionReceiptsText:JSON.stringify(bundle,null,2),classificationSourceTexts,sourcePaths:paths,evidenceFileTexts});}

test("Wave23 promotes exactly WBS787-789 and preserves Wave22 byte-exact",()=>{
  const bundle=JSON.parse(read(paths.executionReceipts)) as ObjectDbConsumerExecutionReceiptBundle,wave22=JSON.parse(read("개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave22-v1.json")) as ObjectDbConsumerExecutionReceiptBundle;
  const prefix=JSON.stringify(bundle.receipts.slice(0,225));
  assert.equal(bundle.receipts.length,243);assert.deepEqual(bundle.receipts.slice(0,225),wave22.receipts);assert.equal(Buffer.byteLength(prefix,"utf8"),919668);assert.equal(sha256CanonicalText(prefix),"1a7bec9fefe0c009012fbaa3286f987a1ae8b8d279cbd23ab0870e4919d83809");
  const ledger=build(bundle);for(const id of ["sql-repository-818137c4fb22037a","sql-repository-f6c531148a436a21","sql-repository-31c4099080d9c9c1"])assert.equal(ledger.entries.find(entry=>entry.consumerId===id)?.verdict,"DIRECT_PASS");
  assert.equal(ledger.entries.find(entry=>entry.consumerId==="sql-repository-87ed81931dd7417b")?.verdict,"STATIC_ONLY");
  assert.equal(ledger.coverage.directPassConsumers,44);assert.equal(ledger.coverage.verdicts.STATIC_ONLY,1007);assert.equal(ledger.coverage.verdicts.BLOCKED_DYNAMIC,82);
  assert.deepEqual({missing:ledger.coverage.missingConsumerIds,duplicate:ledger.coverage.duplicateConsumerIds,unknown:ledger.coverage.unknownConsumerIds},{missing:0,duplicate:0,unknown:0});
});

test("Wave23 rejects historical prefix tampering before execution",()=>{
  const original=JSON.parse(read(paths.executionReceipts)) as ObjectDbConsumerExecutionReceiptBundle;
  const prefix=structuredClone(original);prefix.receipts[0]!.receiptId += "-tamper";assert.throws(()=>parseObjectDbConsumerExecutionReceiptBundle(prefix),/historical receipt fingerprint drift/);
});
