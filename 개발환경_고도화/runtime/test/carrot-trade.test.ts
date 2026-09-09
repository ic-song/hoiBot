import assert from "node:assert/strict";
import test from "node:test";
import { isCarrotTradeCandidate, normalizeCarrotTradeDispatchMessage, parseCarrotTradeCommand } from "../src/market/carrot-trade-service.js";

test("carrot trade parses spaced target and positive uint64 values",()=>{
  assert.deepEqual(parseCarrotTradeCommand("/당근 받는 사람 12 30"),{targetName:"받는 사람",sourceIndex:12n,quantity:30n});
  assert.equal(isCarrotTradeCandidate("/당근 받는 사람 1 2"),true);
});

test("carrot trade rejects adjacent commands, zero, suffix and overflow",()=>{
  for(const value of ["/당근게시판","/당근1 이름 1 1","/당근 이름 0 1","/당근 이름 1 0","/당근 이름 1 1 해봐","/당근 이름 18446744073709551616 1"]){assert.equal(parseCarrotTradeCommand(value),undefined);}
});

test("carrot trade normalizes only its exact namespace",()=>{
  assert.equal(normalizeCarrotTradeDispatchMessage("/당근 받는 사람 1 2"),"/당근");
  assert.equal(normalizeCarrotTradeDispatchMessage("/당근게시판"),"/당근게시판");
});
