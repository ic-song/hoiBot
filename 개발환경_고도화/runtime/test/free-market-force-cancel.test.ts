import assert from "node:assert/strict";
import test from "node:test";
import { isFreeMarketForceCancelCandidate, normalizeFreeMarketForceCancelDispatchMessage, parseFreeMarketForceCancelCommand } from "../src/market/free-market-force-cancel-service.js";

test("free market force cancel accepts one positive uint64 display number", () => {
  assert.equal(parseFreeMarketForceCancelCommand("/거래소강제취소 1"), 1n);
  assert.equal(parseFreeMarketForceCancelCommand("/거래소강제취소 18446744073709551615"), 18_446_744_073_709_551_615n);
  assert.equal(isFreeMarketForceCancelCandidate("/거래소강제취소 29"), true);
});

test("free market force cancel rejects missing, zero, overflow and suffix forms", () => {
  for (const value of ["/거래소강제취소", "/거래소강제취소 0", "/거래소강제취소 -1", "/거래소강제취소 1.0", "/거래소강제취소 1 해봐", "/거래소강제취소 18446744073709551616"]) {
    assert.equal(parseFreeMarketForceCancelCommand(value), undefined);
  }
});

test("free market force cancel normalizes only executable messages", () => {
  assert.equal(normalizeFreeMarketForceCancelDispatchMessage("/거래소강제취소 3"), "/거래소강제취소");
  assert.equal(normalizeFreeMarketForceCancelDispatchMessage("/거래소강제취소 3 안내"), "/거래소강제취소 3 안내");
});
