import assert from "node:assert/strict";
import test from "node:test";
import { isFreeMarketCancelCandidate, normalizeFreeMarketCancelDispatchMessage, parseFreeMarketCancelCommand } from "../src/market/free-market-cancel-service.js";

test("free market cancel accepts one positive uint64 display number", () => {
  assert.equal(parseFreeMarketCancelCommand("/자유시장취소 1"), 1n);
  assert.equal(parseFreeMarketCancelCommand("/자유시장취소 18446744073709551615"), 18_446_744_073_709_551_615n);
  assert.equal(isFreeMarketCancelCandidate("/자유시장취소 29"), true);
});

test("free market cancel rejects zero, overflow and suffix forms", () => {
  for (const value of ["/자유시장취소", "/자유시장취소 0", "/자유시장취소 -1", "/자유시장취소 1.0", "/자유시장취소 1 해봐", "/자유시장취소 18446744073709551616"]) assert.equal(parseFreeMarketCancelCommand(value), undefined);
});

test("free market cancel normalizes only executable messages", () => {
  assert.equal(normalizeFreeMarketCancelDispatchMessage("/자유시장취소 3"), "/자유시장취소 [번호]");
  assert.equal(normalizeFreeMarketCancelDispatchMessage("/자유시장취소 3 안내"), "/자유시장취소 3 안내");
});
