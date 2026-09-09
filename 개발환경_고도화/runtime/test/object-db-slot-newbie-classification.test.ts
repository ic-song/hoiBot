import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe,it } from "node:test";

const root=resolve(import.meta.dirname,"../.."),manifest=JSON.parse(readFileSync(resolve(root,"migration-control/contracts/object-db-consumer-manifest.v1.json"),"utf8")),source=readFileSync(resolve(root,"../main.js"),"utf8").replace(/\r\n?/g,"\n");
const ids=["legacy-36588f6a2db3277d","legacy-02d447882f335ea1","legacy-ac46db2ac0deedf4","legacy-f51202b9335997d8"];

describe("WBS794 slot newbie classification correction",()=>{
  it("classifies exactly four frozen consumers as item mutations",()=>{const cohort=manifest.consumers.filter((consumer:any)=>ids.includes(consumer.consumerId));assert.equal(cohort.length,4);for(const consumer of cohort){assert.equal(consumer.access,"READ_WRITE");assert.equal(consumer.interfaceMethod,"EXECUTE");assert.equal(consumer.interfaceId,"item.admin-grant.execute");assert.equal(consumer.transactionOwnerInterfaceId,"item.admin-grant.execute");assert.deepEqual(consumer.transactionParticipantInterfaceIds,["item.inventory.mutate"]);assert.deepEqual(consumer.operationReceiptTables,["canonical_item_inventory_ledger_entries","canonical_item_inventory_operations"]);assert.equal(createHash("sha256").update(source.slice(consumer.sourceSpan.start,consumer.sourceSpan.end)).digest("hex"),consumer.sourceSpan.sha256);}});
});
