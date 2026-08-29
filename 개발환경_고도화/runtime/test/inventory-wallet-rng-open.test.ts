import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isInventoryWalletRngOpenCommandCandidate, normalizeInventoryWalletRngOpenDispatchMessage, parseInventoryWalletRngOpenCommand } from "../src/inventory/inventory-wallet-rng-open-command.js";
import { createInventoryWalletRngSeed, formatInventoryWalletRngReply, inventoryWalletRngSample, resolveInventoryWalletRngRoll, type InventoryWalletRngPayoutTier } from "../src/inventory/inventory-wallet-rng-open-service.js";

const tiers: InventoryWalletRngPayoutTier[] = [
  { tier_ordinal: 1, weight_value: 82000000n, payout_amount: 10000000n, result_text: "1천만" },
  { tier_ordinal: 2, weight_value: 14000000n, payout_amount: 30000000n, result_text: "3천만" },
  { tier_ordinal: 3, weight_value: 3500000n, payout_amount: 50000000n, result_text: "5천만" },
  { tier_ordinal: 4, weight_value: 400000n, payout_amount: 100000000n, result_text: "1억" },
  { tier_ordinal: 5, weight_value: 90000n, payout_amount: 300000000n, result_text: "3억" },
  { tier_ordinal: 6, weight_value: 10000n, payout_amount: 1000000000n, result_text: "10억" }
];

describe("inventory wallet RNG open v2.400", () => {
  it("keeps exact and anchored numeric command boundaries", () => {
    for (const value of ["/지갑털기", "/지갑털기 0", "/지갑털기 001", "/지갑털기 10  "]) assert.equal(isInventoryWalletRngOpenCommandCandidate(value), true);
    for (const value of [undefined, "지갑털기", "/지갑털기 해봐", "/지갑털기 1 해봐", "/지갑털기안내"]) assert.equal(isInventoryWalletRngOpenCommandCandidate(value), false);
    assert.equal(normalizeInventoryWalletRngOpenDispatchMessage("/지갑털기 10"), "/지갑털기");
  });

  it("preserves default, zero-to-one, leading zero, and unbounded stock-capped count", () => {
    assert.equal(parseInventoryWalletRngOpenCommand("/지갑털기")?.requestedCount, 1n);
    assert.equal(parseInventoryWalletRngOpenCommand("/지갑털기 0")?.requestedCount, 1n);
    assert.equal(parseInventoryWalletRngOpenCommand("/지갑털기 00012")?.requestedCount, 12n);
    assert.equal(parseInventoryWalletRngOpenCommand("/지갑털기 999999999999999999")?.requestedCount, 999999999999999999n);
  });

  it("uses 70% empty and exact six payout boundaries", () => {
    assert.equal(resolveInventoryWalletRngRoll(0.69999999, 0, 70000000n, 100000000n, tiers).tier, null);
    const samples = [0, 0.81999999, 0.82, 0.95999999, 0.96, 0.99499999, 0.995, 0.99899999, 0.999, 0.99989999, 0.9999, 0.99999999];
    const ordinals = samples.map(sample => resolveInventoryWalletRngRoll(0.7, sample, 70000000n, 100000000n, tiers).tier!.tier_ordinal);
    assert.deepEqual(ordinals, [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
  });

  it("keeps deterministic samples and sorted allsee batch output", () => {
    const seed = createInventoryWalletRngSeed("v2400", "event-1", "42", 11n);
    assert.equal(inventoryWalletRngSample(seed, 1n, "empty"), inventoryWalletRngSample(seed, 1n, "empty"));
    const rolls = Array.from({ length: 11 }, (_, index) => resolveInventoryWalletRngRoll(0.7, index === 10 ? 0.9999 : 0, 70000000n, 100000000n, tiers, BigInt(index + 1)));
    const output = formatInventoryWalletRngReply("검증자", rolls, rolls.reduce((sum, roll) => sum + roll.payout, 0n));
    assert.match(output, /1\. 👛 10억/); assert.ok(output.includes("\u200b".repeat(500))); assert.match(output, /11회 호이🤪 지갑털이 결과/);
  });
});
