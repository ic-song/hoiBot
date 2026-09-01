import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateGuildShopTax, isGuildShopPurchaseCommandCandidate, parseGuildShopPurchaseCommand } from "../src/guild/guild-shop-purchase-service.js";

describe("guild shop purchase", () => {
  it("accepts only a positive product number and optional positive quantity", () => {
    assert.equal(isGuildShopPurchaseCommandCandidate("/길드상점구매"), true);
    assert.deepEqual(parseGuildShopPurchaseCommand("/길드상점구매 2"), { productNumber: 2, quantity: 1n });
    assert.deepEqual(parseGuildShopPurchaseCommand("/길드상점구매 2 3"), { productNumber: 2, quantity: 3n });
    for (const message of ["/길드상점구매 0", "/길드상점구매 1 0", "/길드상점구매 1 안내"]) assert.equal(parseGuildShopPurchaseCommand(message), null);
  });

  it("uses the legacy positive integer rounding rule", () => {
    assert.equal(calculateGuildShopTax(1_000n, 1_500), 150n);
    assert.equal(calculateGuildShopTax(999n, 725), 72n);
  });
});
