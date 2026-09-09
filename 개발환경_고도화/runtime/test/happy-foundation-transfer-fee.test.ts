import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateFoundationTransferFee, isHappyFoundationTransferFeeCommand, normalizeHappyFoundationTransferFeeDispatchMessage, parseFeeRateBasisPoints } from "../src/foundation/happy-foundation-transfer-fee-service.js";

describe("happy foundation transfer and fee boundary", () => {
  it("accepts only exact read, usage and complete argument forms", () => {
    for (const message of ["/호이행복재단", "/이체", "/이체 합성회원 남 1000", "/이체수수료변경 20", "/이체수수료변경 7.25"]) assert.equal(isHappyFoundationTransferFeeCommand(message), true);
    for (const message of [undefined, "/호이행복재단 안내", "/이체 합성회원", "/이체 합성회원 1 안내", "/이체수수료변경", "/이체수수료변경 7.251"]) assert.equal(isHappyFoundationTransferFeeCommand(message), false);
  });

  it("normalizes argument commands to canonical aliases", () => {
    assert.equal(normalizeHappyFoundationTransferFeeDispatchMessage("/이체 합성회원 남 1000"), "/이체");
    assert.equal(normalizeHappyFoundationTransferFeeDispatchMessage("/이체수수료변경 12.50"), "/이체수수료변경");
    assert.equal(normalizeHappyFoundationTransferFeeDispatchMessage("/호이행복재단"), "/호이행복재단");
  });

  it("parses fee rates without floating point drift", () => {
    assert.equal(parseFeeRateBasisPoints("0"), 0n);
    assert.equal(parseFeeRateBasisPoints("7.5"), 750n);
    assert.equal(parseFeeRateBasisPoints("20.00"), 2000n);
    assert.equal(parseFeeRateBasisPoints("7.251"), null);
  });

  it("calculates normal and membership fees using integer arithmetic", () => {
    assert.equal(calculateFoundationTransferFee(10_000n, 2_000n), 2_000n);
    assert.equal(calculateFoundationTransferFee(10_000n, 2_000n, 5_000n), 1_000n);
    assert.equal(calculateFoundationTransferFee(999n, 725n), 72n);
  });
});
