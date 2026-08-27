import assert from "node:assert/strict";
import { describe,it } from "node:test";
import { isHomeFurnitureCarrotTransferCandidate,normalizeHomeFurnitureCarrotTransferDispatchMessage,parseHomeFurnitureCarrotTransferCommand } from "../src/home/home-furniture-carrot-transfer-service.js";

describe("home furniture carrot transfer command",()=>{
  it("parses a spaced recipient name and positive uint64 source index",()=>assert.deepEqual(parseHomeFurnitureCarrotTransferCommand("/가구당근 공백 포함 받는 닉네임 18446744073709551615"),{targetName:"공백 포함 받는 닉네임",sourceIndex:18446744073709551615n}));
  it("rejects missing zero overflow and guide suffix forms",()=>{for(const value of ["/가구당근","/가구당근 받는사람","/가구당근 받는사람 0","/가구당근 받는사람 18446744073709551616","/가구당근 받는사람 1 안내"])assert.equal(parseHomeFurnitureCarrotTransferCommand(value),null);});
  it("does not accept an empty recipient hidden by whitespace",()=>assert.equal(parseHomeFurnitureCarrotTransferCommand("/가구당근     1"),null));
  it("normalizes only a complete valid command",()=>{assert.equal(isHomeFurnitureCarrotTransferCandidate("/가구당근 받는 황제 2"),true);assert.equal(normalizeHomeFurnitureCarrotTransferDispatchMessage("/가구당근 받는 황제 2"),"/가구당근 [받는닉네임] [가구번호]");assert.equal(normalizeHomeFurnitureCarrotTransferDispatchMessage("/가구당근 받는 황제 2 해봐"),"/가구당근 받는 황제 2 해봐");});
});
