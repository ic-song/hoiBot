import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { isDiamondShopBuyCommandCandidate, normalizeDiamondShopBuyDispatchMessage, parseDiamondShopBuyCommand } from "../src/shop/diamond-shop-buy-service.js";

describe("diamond shop buy", () => {
  it("accepts only bare usage or a complete positive integer purchase", () => {
    assert.deepEqual(parseDiamondShopBuyCommand("/다이아상점구매"), { kind: "USAGE" });
    assert.deepEqual(parseDiamondShopBuyCommand("/다이아상점구매 12 3"), { kind: "BUY", listNumber: 12, count: 3n });
    for (const message of ["/다이아상점구매 0 1", "/다이아상점구매 1 0", "/다이아상점구매 -1 1", "/다이아상점구매 1 1.5", "/다이아상점구매 1 1 해봐", "/다이아상점구매잘못"]) {
      assert.equal(isDiamondShopBuyCommandCandidate(message), false, message);
    }
    assert.equal(normalizeDiamondShopBuyDispatchMessage("/다이아상점구매 2 4"), "/다이아상점구매");
  });

  it("keeps currency, inventory, history, execution, audit and outbox in one service boundary", () => {
    const source = readFileSync(new URL("../src/shop/diamond-shop-buy-service.ts", import.meta.url), "utf8");
    for (const fragment of ["withLockedProduct", "UPDATE currency_accounts", "INSERT INTO currency_ledger", "INSERT INTO inventory_stacks",
      "INSERT INTO inventory_ledger", "INSERT INTO diamond_shop_purchase_events", "INSERT INTO command_executions",
      "INSERT INTO command_audit", "INSERT INTO outbox_messages", "reward_item_id IS NULL"]) {
      assert.ok(source.includes(fragment), fragment);
    }
  });
});
