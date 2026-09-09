import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { buildObjectDbConsumerExecutableParityLedger, parseObjectDbConsumerExecutionReceiptBundle, sha256CanonicalText, type ConsumerManifestInput, type ObjectDbConsumerExecutionReceiptBundle } from "../src/data-migration/object-db-consumer-executable-parity-ledger.js";

const runtimeRoot=resolve(import.meta.dirname,".."),repoRoot=resolve(runtimeRoot,"../.."),read=(path:string):string=>readFileSync(resolve(repoRoot,path),"utf8");
const paths={ledgerSchema:"개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-ledger.v1.schema.json",executionReceiptSchema:"개발환경_고도화/migration-control/contracts/object-db-consumer-execution-receipt.v1.schema.json",consumerManifest:"개발환경_고도화/migration-control/contracts/object-db-consumer-manifest.v1.json",consumerIdRegistry:"개발환경_고도화/migration-control/contracts/object-db-consumer-id-registry.v1.json",transitionContract:"개발환경_고도화/migration-control/contracts/object-db-consumer-transition.v1.json",executionReceipts:"개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave25-v1.json"} as const;
const manifestText=read(paths.consumerManifest),manifest=JSON.parse(manifestText) as ConsumerManifestInput,registryText=read(paths.consumerIdRegistry);
const classificationSourceTexts=Object.fromEntries([...new Set(manifest.audit.registrySourceMismatches.map((label)=>label.slice(0,label.indexOf(":"))))].sort().map((path)=>[path,read(path)]));
function build(bundle:ObjectDbConsumerExecutionReceiptBundle){const evidencePaths=[...new Set(bundle.receipts.flatMap(receipt=>[receipt.harness.path,receipt.fixture.path,receipt.invocation.targetPath]))],evidenceFileTexts=Object.fromEntries(evidencePaths.map(path=>[path,read(path)]));return buildObjectDbConsumerExecutableParityLedger({ledgerSchemaText:read(paths.ledgerSchema),executionReceiptSchemaText:read(paths.executionReceiptSchema),consumerManifestText:manifestText,consumerIdRegistryText:registryText,transitionContractText:read(paths.transitionContract),executionReceiptsText:JSON.stringify(bundle,null,2),classificationSourceTexts,sourcePaths:paths,evidenceFileTexts});}

test("Wave25 promotes the item-bag legacy consumer and preserves Wave24 byte-exact",()=>{
  const bundle=JSON.parse(read(paths.executionReceipts)) as ObjectDbConsumerExecutionReceiptBundle,wave24=JSON.parse(read("개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave24-v1.json")) as ObjectDbConsumerExecutionReceiptBundle;
  const prefix=JSON.stringify(bundle.receipts.slice(0,249));
  assert.equal(bundle.receipts.length,254);assert.deepEqual(bundle.receipts.slice(0,249),wave24.receipts);assert.equal(Buffer.byteLength(prefix,"utf8"),988846);assert.equal(sha256CanonicalText(prefix),"2287ae220032e0190d5fec91eadbe6c10d50acb0590f5f9ccba683a26f57820b");
  const ledger=build(bundle),entry=ledger.entries.find(candidate=>candidate.consumerId==="legacy-94904fa11988ff04");
  assert.equal(entry?.verdict,"DIRECT_PASS");assert.deepEqual(entry?.scenarios.map(scenario=>scenario.scenarioKind).sort(),["EXACT_OUTPUT","NEGATIVE_GUARD","READ_POSITIVE","RESTART_CONSISTENCY","SOURCE_DOMAIN_DML_ZERO"]);
  assert.equal(ledger.coverage.directPassConsumers,46);assert.equal(ledger.coverage.verdicts.STATIC_ONLY,1005);assert.equal(ledger.coverage.verdicts.BLOCKED_DYNAMIC,82);
  assert.deepEqual({missing:ledger.coverage.missingConsumerIds,duplicate:ledger.coverage.duplicateConsumerIds,unknown:ledger.coverage.unknownConsumerIds},{missing:0,duplicate:0,unknown:0});
});

test("Wave25 rejects prefix and committed fixture tampering",()=>{
  const original=JSON.parse(read(paths.executionReceipts)) as ObjectDbConsumerExecutionReceiptBundle;
  const prefix=structuredClone(original);prefix.receipts[0]!.receiptId+="-tamper";assert.throws(()=>parseObjectDbConsumerExecutionReceiptBundle(prefix),/historical receipt fingerprint drift/);
  const fixture=structuredClone(original),receipt=fixture.receipts.find(candidate=>candidate.receiptId==="receipt:wave25:legacy-94904fa11988ff04:exact_output")!;receipt.fixture.sha256="0".repeat(64);
  assert.throws(()=>build(fixture),/receipt fingerprint drift|evidenceCommit blob hash drift/);
});
