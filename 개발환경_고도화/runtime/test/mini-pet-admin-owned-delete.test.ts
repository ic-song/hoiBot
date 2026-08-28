import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isMiniPetAdminOwnedDeleteCommand, normalizeMiniPetAdminOwnedDeleteDispatchMessage, parseMiniPetAdminOwnedDeleteCommand } from "../src/mini-pet/mini-pet-admin-owned-delete-service.js";
describe("mini pet admin owned delete command",()=>{
  it("accepts only the representative command boundary",()=>{assert.equal(isMiniPetAdminOwnedDeleteCommand("/미니펫삭제"),true);assert.equal(isMiniPetAdminOwnedDeleteCommand("/미니펫삭제 대상 남 1"),true);assert.equal(isMiniPetAdminOwnedDeleteCommand("/미니펫삭제아님 대상 남 1"),false);});
  it("preserves a spaced target and positive bag sequence",()=>assert.deepEqual(parseMiniPetAdminOwnedDeleteCommand("/미니펫삭제 대상 남 12"),{targetName:"대상 남",bagSequence:12n}));
  it("rejects zero, missing, and guide-text suffixes",()=>{assert.equal(parseMiniPetAdminOwnedDeleteCommand("/미니펫삭제 대상 남 0"),undefined);assert.equal(parseMiniPetAdminOwnedDeleteCommand("/미니펫삭제 대상 남"),undefined);assert.equal(parseMiniPetAdminOwnedDeleteCommand("/미니펫삭제 대상 남 1 해봐"),undefined);});
  it("normalizes candidates to the registered alias",()=>{assert.equal(normalizeMiniPetAdminOwnedDeleteDispatchMessage("/미니펫삭제 대상 남 1"),"/미니펫삭제");assert.equal(normalizeMiniPetAdminOwnedDeleteDispatchMessage("/미니펫삭제아님"),"/미니펫삭제아님");});
});
