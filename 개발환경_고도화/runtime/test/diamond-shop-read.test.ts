import assert from "node:assert/strict";
import test from "node:test";
import { isPointShopCatalogCommandCandidate, normalizePointShopCatalogDispatchMessage } from "../src/shop/point-shop-catalog-command.js";
import { isDiamondShopReadCommandCandidate } from "../src/shop/diamond-shop-read-service.js";

test("다이아 상점 조회는 정확 일치 입력만 허용한다", () => {
  assert.equal(isDiamondShopReadCommandCandidate("/다이아상점"), true);
  assert.equal(isDiamondShopReadCommandCandidate("/다이아상점 1"), false);
  assert.equal(isDiamondShopReadCommandCandidate("/다이아상점 안내"), false);
});

test("공용 상점 dispatcher가 조회 별칭을 보존한다", () => {
  assert.equal(isPointShopCatalogCommandCandidate("/다이아상점"), true);
  assert.equal(normalizePointShopCatalogDispatchMessage("/다이아상점"), "/다이아상점");
});
