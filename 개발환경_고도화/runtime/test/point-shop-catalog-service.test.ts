import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPointShopCatalogCommandCandidate, parsePointShopCatalogCommand } from "../src/shop/point-shop-catalog-command.js";
import { PointShopCatalogService, formatPointShopCatalog, type PointShopCatalogRepository } from "../src/shop/point-shop-catalog-service.js";

describe("point shop catalog command boundary", () => {
  it("accepts exact read and full admin patterns only", () => {
    for (const message of ["/상점", "/상점추가 합성 상품 0", "/상점추가 여러 단어 상품 12345", "/상점삭제 1"]) {
      assert.equal(isPointShopCatalogCommandCandidate(message), true, message);
    }
    for (const message of ["/상점 안내", "/상점추가 상품 -1", "/상점추가 상품 1.5", "/상점삭제 0", "/상점삭제 1 안내"]) {
      assert.equal(isPointShopCatalogCommandCandidate(message), false, message);
    }
  });

  it("preserves a multi-word product name and integer price", () => {
    assert.deepEqual(parsePointShopCatalogCommand("/상점추가 합성 여러 단어 상품 12000"), {
      kind: "UPSERT", displayName: "합성 여러 단어 상품", price: 12000n,
    });
  });
});

describe("point shop catalog service", () => {
  it("formats stable display order with DB tax and lord projection", () => {
    const message = formatPointShopCatalog({ catalogVersion: 3n, taxRateBasisPoints: 1250, lordGuildName: "합성길드", entries: [
      { productId: "PS-1", productKey: "ITEM-1", displayName: "합성상품", displayOrder: 1, price: 12345n, rowVersion: 1n },
    ] });
    assert.match(message, /1\. 합성상품 : 12,345 Point/);
    assert.match(message, /세율 : 12\.5%/);
    assert.match(message, /성주 길드 : 합성길드/);
  });

  it("resolves a delete number to a stable product ID before mutation", async () => {
    let productId = "";
    const repository: PointShopCatalogRepository = {
      findReplay: async () => undefined,
      readSnapshot: async () => ({ catalogVersion: 7n, taxRateBasisPoints: 0, entries: [
        { productId: "PS-STABLE", productKey: "ITEM-STABLE", displayName: "안정상품", displayOrder: 1, price: 10n, rowVersion: 1n },
      ] }),
      mutate: async (request) => {
        productId = request.mutation.action === "REMOVE" ? request.mutation.productId : "";
        return { replayed: false, catalogVersion: 8n, productId, message: "ok" };
      },
    };
    const command = parsePointShopCatalogCommand("/상점삭제 1");
    assert.ok(command && command.kind !== "READ");
    await new PointShopCatalogService(repository).executeMutation({ command, requestKey: "event-1", actorOperatorId: "7" });
    assert.equal(productId, "PS-STABLE");
  });
});
