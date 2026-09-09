import assert from "node:assert/strict";
import { describe,it } from "node:test";
import { isPendantRestoreCommandCandidate,normalizePendantRestoreDispatchMessage,parsePendantRestoreCommand } from "../src/pet/pendant-restore-service.js";
describe("pendant restore command",()=>{
 it("preserves broad legacy usage candidates",()=>{for(const value of ["/펜던트복원","/펜던트복원 0","/펜던트복원 안내"])assert.equal(isPendantRestoreCommandCandidate(value),true);assert.equal(isPendantRestoreCommandCandidate("/펜던트복원추가 1"),false);});
 it("parses equipped zero and bag indexes",()=>{assert.deepEqual(parsePendantRestoreCommand("/펜던트복원 0"),{index:0n});assert.deepEqual(parsePendantRestoreCommand("/펜던트복원 12"),{index:12n});assert.equal(parsePendantRestoreCommand("/펜던트복원 1 안내"),undefined);});
 it("normalizes candidates only",()=>{assert.equal(normalizePendantRestoreDispatchMessage("/펜던트복원 1"),"/펜던트복원");assert.equal(normalizePendantRestoreDispatchMessage("다른말"),"다른말");});
});
