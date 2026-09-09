import assert from "node:assert/strict";
import { describe,it } from "node:test";
import { isSpiritAttributeCommandCandidate,parseSpiritAttributeCommand } from "../src/admin/spirit-attribute-service.js";

describe("spirit attribute command",()=>{
  it("keeps the legacy startsWith candidate boundary",()=>{
    for(const value of ["/정령속성","/정령속성 대상 10","/정령속성잘못"])assert.equal(isSpiritAttributeCommandCandidate(value),true);
    assert.equal(isSpiritAttributeCommandCandidate("정령속성 대상 10"),false);
  });
  it("parses a digit-free target and unsigned level only",()=>{
    assert.deepEqual(parseSpiritAttributeCommand("/정령속성 홍 길동 42"),{targetName:"홍 길동",level:42n});
    for(const value of ["/정령속성 홍1 2","/정령속성 홍길동 -1","/정령속성 홍길동 1 해봐"])assert.equal(parseSpiritAttributeCommand(value),null);
  });
  it("rejects values above unsigned bigint instead of overflowing MariaDB",()=>{
    assert.equal(parseSpiritAttributeCommand("/정령속성 홍길동 18446744073709551616"),null);
  });
});
