import assert from "node:assert/strict";
import { describe,it } from "node:test";
import { isRocketPackageGrantCommandCandidate,parseRocketPackageGrantCommand } from "../src/admin/rocket-package-grant-service.js";

describe("rocket package admin grant source boundary",()=>{
  it("seals every trigger to its exact rocket number",()=>{for(let rocketNo=1;rocketNo<=10;rocketNo+=1)assert.deepEqual(parseRocketPackageGrantCommand(`/로켓${rocketNo}, 회원${rocketNo}`),{amount:1n,targetLegacyKey:`회원${rocketNo}`,rocketNo});});
  it("preserves the legacy comma-space and split cardinality",()=>{for(const message of ["/로켓1,회원","/로켓11, 회원","/로켓1","/로켓1, 회원, 추가"])assert.equal(parseRocketPackageGrantCommand(message),null);assert.equal(isRocketPackageGrantCommandCandidate("/로켓1,회원"),false);assert.equal(isRocketPackageGrantCommandCandidate("/로켓10, 회원"),true);});
});
