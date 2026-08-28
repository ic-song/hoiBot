import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatGuildShopCatalog, isGuildShopCatalogCommandCandidate, parseGuildShopCatalogCommand } from "../src/guild/guild-shop-catalog-service.js";

describe("guild shop catalog", () => {
  it("accepts only the exact list and strict add/delete forms", () => {
    assert.equal(isGuildShopCatalogCommandCandidate("/길드상점"), true);
    assert.equal(isGuildShopCatalogCommandCandidate("/길드상점 안내"), false);
    assert.deepEqual(parseGuildShopCatalogCommand("/길드상점추가 길드메달, 1200"), { kind: "ADD", commandCode: "GUILD_SHOP_ADD", displayName: "길드메달", price: 1200n });
    assert.deepEqual(parseGuildShopCatalogCommand("/길드상점삭제 2"), { kind: "DELETE", commandCode: "GUILD_SHOP_DELETE", selector: "2" });
    assert.equal(parseGuildShopCatalogCommand("/길드상점추가 길드메달,0"), null);
    assert.equal(parseGuildShopCatalogCommand("/길드상점삭제 "), null);
  });

  it("keeps display order, tax and medal daily limit in the legacy projection", () => {
    const data = formatGuildShopCatalog({ catalogVersion: 3n, taxRateBasisPoints: 1250, lordGuildName: "합성길드", items: [
      { productId: "p1", itemId: null, displayName: "길드메달", price: 1200n, dailyLimit: 1, displayOrder: 1, version: 1n },
      { productId: "p2", itemId: null, displayName: "회복약", price: 50000n, dailyLimit: null, displayOrder: 2, version: 1n }
    ] });
    assert.match(data, /1\. 길드메달 : 1,200 Point \(일일 1개\)/);
    assert.match(data, /2\. 회복약 : 50,000 Point/);
    assert.match(data, /세율 : 12\.5%/);
    assert.match(data, /성주 길드 : 합성길드/);
  });
});
