import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { parseObjectDbConsumerExecutionReceiptBundle } from "../src/data-migration/object-db-consumer-executable-parity-ledger.js";

const root=resolve(import.meta.dirname,"../../..");
const read=(path:string):any=>JSON.parse(readFileSync(resolve(root,path),"utf8"));
const sha=(value:string)=>createHash("sha256").update(value.replace(/\r\n?/g,"\n")).digest("hex");
const receiptPath="개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave31-v1.json";
const fixturePath="개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-wave31-member-title-legacy-list-v1.json";
const self="legacy-542e265c2135fb46",admin="legacy-d04b5224bde6be54";
const selfScenarios=["READ_POSITIVE","NEGATIVE_GUARD","EXACT_OUTPUT","SOURCE_DOMAIN_DML_ZERO","RESTART_CONSISTENCY"];
const adminScenarios=selfScenarios;

describe("Wave31 committed Info.js versus modern member-title list DIRECT parity",()=>{
  it("keeps the full Wave30 set and historical prefixes immutable",()=>{
    const current=read(receiptPath),prior=read("개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave30-v1.json");
    const prefix=JSON.stringify(current.receipts.slice(0,372));
    assert.equal(current.receipts.length,382);assert.deepEqual(current.receipts.slice(0,372),prior.receipts);
    assert.equal(Buffer.byteLength(prefix),1485238);assert.equal(sha(prefix),"f9b490aaea9ea67ece2188fcc1424b1c46c36871606d525ce1c0620a2d818546");
    for(const [count,bytes,hash] of [[362,1382594,"5cf3063b351bc18a343b075997dead5769cde57d7a8854218c7b89e3abed7373"],[352,1361204,"70fca768ac020cc1b8dcbceb221c0beeba927e2b16e7bfc32ad09677b95cec5b"],[324,1260829,"72522ab348255c339dc2e4918fac6ab1702643e6ba8725b99e74ab3457b35adb"],[243,970854,"e21eeacea4c7c9b3fb733a349b928e0d1248579ddbb2cf770e20b1b0fd0b5f97"]] as const){
      const value=JSON.stringify(current.receipts.slice(0,count));assert.equal(Buffer.byteLength(value),bytes);assert.equal(sha(value),hash);
    }
  });

  it("covers first, middle, last, empty, inactive target, authorization and negative boundaries",()=>{
    const bundle=read(receiptPath),fixture=read(fixturePath);
    assert.equal(fixture.bindings.length,10);
    assert.deepEqual(bundle.receipts.filter((r:any)=>r.consumerId===self).map((r:any)=>r.scenario.scenarioKind).sort(),selfScenarios.slice().sort());
    assert.deepEqual(bundle.receipts.filter((r:any)=>r.consumerId===admin).map((r:any)=>r.scenario.scenarioKind).sort(),adminScenarios.slice().sort());
    const byId=Object.fromEntries(fixture.bindings.map((binding:any)=>[binding.scenarioId,binding]));
    assert.equal(byId["wave31-self-first-selected"].modern.titles[0].equipped,true);
    assert.equal(byId["wave31-self-middle-selected-guild-rank"].modern.titles[1].equipped,true);
    assert.equal(byId["wave31-self-last-selected-restart"].modern.titles[2].equipped,true);
    assert.equal(byId["wave31-self-empty-list"].expectedReply,"보유 타이틀이 없습니다.");
    assert.equal(byId["wave31-admin-missing-inactive-target"].expectedReply,"없는회원는(은) 존재하지 않는 사용자입니다.");
    assert.equal(byId["wave31-admin-auth-denied"].scenarioKind,"NEGATIVE_GUARD");
    assert.equal(byId["wave31-admin-auth-denied"].authorized,false);
    assert.equal(byId["wave31-admin-auth-denied"].expectedReply,"NO_REPLY");
    assert.match(byId["wave31-admin-middle-selected-exact"].expectedReply,/☞ 2\. 두 번째\/획득일:2026-08-27 23:01\/가격: 🅟15,000/u);
    assert.match(byId["wave31-self-middle-selected"].expectedReply,/^\[⭐조회회원\]/u);
    assert.equal(fixture.receiptContract.transaction,"COMMIT");assert.equal(fixture.receiptContract.sourceDomainDmlCount,0);
    for(const receipt of bundle.receipts.slice(372)){assert.equal(receipt.expectedActual.transaction.actual,"COMMIT");assert.ok(receipt.expectedActual.dml.actualRowCount>0);assert.ok(receipt.expectedActual.dml.actualNormalizedStatements.length>0);}
  });

  it("rejects immutable prefix tamper and promotes exactly two legacy consumers",()=>{
    const bundle=read(receiptPath);bundle.receipts[0].receiptSha256="0".repeat(64);
    assert.throws(()=>parseObjectDbConsumerExecutionReceiptBundle(bundle),/historical receipt fingerprint drift/);
    const ledger=read("개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-ledger.v1.json");
    assert.equal(ledger.coverage.directPassConsumers,54);assert.equal(ledger.coverage.provenConsumers,66);
    assert.equal(ledger.coverage.unprovenConsumers,1067);
    for(const id of [self,admin])assert.equal(ledger.entries.find((entry:any)=>entry.consumerId===id).verdict,"DIRECT_PASS");
  });
});
