import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isDiamondShopCatalogAdminCommandCandidate, parseDiamondShopCatalogAdminCommand } from "../src/shop/diamond-shop-catalog-admin-service.js";

describe("diamond shop catalog admin", () => {
  it("preserves greedy names and legacy zero quantity and price", () => {
    assert.equal(isDiamondShopCatalogAdminCommandCandidate("/다이아상점추가 특별 아이템 0 0"), true);
    assert.deepEqual(parseDiamondShopCatalogAdminCommand("/다이아상점추가 특별 아이템 0 0"), { kind: "ADD", commandCode: "DIAMOND_SHOP_CATALOG_ADD", displayName: "특별 아이템", quantity: 0n, price: 0n });
    assert.deepEqual(parseDiamondShopCatalogAdminCommand("/다이아상점삭제 2"), { kind: "DELETE", commandCode: "DIAMOND_SHOP_CATALOG_DELETE", ordinal: 2 });
  });
  it("rejects suffix, negative, unsafe ordinal and over-DECIMAL values", () => {
    assert.equal(parseDiamondShopCatalogAdminCommand("/다이아상점삭제 1 안내"), null);
    assert.equal(parseDiamondShopCatalogAdminCommand("/다이아상점추가 아이템 -1 10"), null);
    assert.equal(parseDiamondShopCatalogAdminCommand("/다이아상점추가 아이템 1000000000000000000000000000000 1"), null);
    assert.equal(parseDiamondShopCatalogAdminCommand("/다이아상점삭제 999999999999999999999"), null);
  });
});
