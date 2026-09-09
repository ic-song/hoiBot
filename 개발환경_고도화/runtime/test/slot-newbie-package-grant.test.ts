import assert from "node:assert/strict";
import { describe,it } from "node:test";
import { isSlotNewbiePackageGrantCommandCandidate,parseSlotNewbiePackageGrantCommand } from "../src/admin/slot-newbie-package-grant-service.js";

describe("slot newbie package admin grant source boundary",()=>{
  it("seals every trigger to its exact variant",()=>{for(let variantNo=1;variantNo<=4;variantNo+=1){const suffix=variantNo===1?"":String(variantNo);assert.deepEqual(parseSlotNewbiePackageGrantCommand(`/슬롯초보${suffix}, 대상${variantNo}`),{amount:1n,targetLegacyKey:`대상${variantNo}`,variantNo});}});
  it("preserves the legacy second comma field and rejects other prefixes",()=>{assert.deepEqual(parseSlotNewbiePackageGrantCommand("/슬롯초보, 대상, 무시"),{amount:1n,targetLegacyKey:"대상",variantNo:1});assert.equal(parseSlotNewbiePackageGrantCommand("/슬롯초보5, 대상"),null);assert.equal(isSlotNewbiePackageGrantCommandCandidate("/슬롯초보오픈"),false);});
});
