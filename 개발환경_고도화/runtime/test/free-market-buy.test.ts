import assert from "node:assert/strict";
import test from "node:test";
import { calculateFreeMarketFee, isFreeMarketBuyCandidate, normalizeFreeMarketBuyDispatchMessage, parseFreeMarketBuyCommand } from "../src/market/free-market-buy-service.js";

test("free market buy parses a uint64 display number", () => {
  assert.deepEqual(parseFreeMarketBuyCommand("/자유시장구매 1"), { kind: "start", displayNo: 1n });
  assert.deepEqual(parseFreeMarketBuyCommand("/자유시장구매 18446744073709551615"), { kind: "start", displayNo: 18_446_744_073_709_551_615n });
});

test("free market buy preserves the legacy zero guard but rejects overflow", () => {
  assert.deepEqual(parseFreeMarketBuyCommand("/자유시장구매 0"), { kind: "start", displayNo: 0n });
  assert.deepEqual(parseFreeMarketBuyCommand("/자유시장구매 18446744073709551616"), { kind: "invalid" });
});

test("free market buy rejects suffix, decimal and negative forms", () => {
  for (const message of ["/자유시장구매", "/자유시장구매 -1", "/자유시장구매 1.0", "/자유시장구매 1 해봐"]) assert.equal(parseFreeMarketBuyCommand(message), undefined);
});

test("free market buy routes durable confirmation and cancellation aliases", () => {
  assert.equal(isFreeMarketBuyCandidate("자유시장거래"), true);
  assert.equal(isFreeMarketBuyCandidate("자유시장거래취소"), true);
  assert.equal(normalizeFreeMarketBuyDispatchMessage("/자유시장구매 7"), "/자유시장구매 [번호]");
});

test("free market buy fee uses seller policy and floors fractional point", () => {
  assert.equal(calculateFreeMarketFee(101n, 1_000n), 10n);
  assert.equal(calculateFreeMarketFee(101n, 500n), 5n);
});
