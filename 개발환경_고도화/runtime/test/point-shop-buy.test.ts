import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { isPointShopBuyCommandCandidate, normalizePointShopBuyDispatchMessage, parsePointShopBuyCommand } from "../src/shop/point-shop-buy-service.js";

describe("point shop buy", () => {
  it("accepts only the exact legacy usage and positive integer purchase forms", () => {
    assert.deepEqual(parsePointShopBuyCommand("/구매"), { kind: "USAGE" });
    assert.deepEqual(parsePointShopBuyCommand("/구매 2"), { kind: "BUY", listNumber: 2, quantity: 1n });
    assert.deepEqual(parsePointShopBuyCommand("/구매 9 3"), { kind: "BUY", listNumber: 9, quantity: 3n });
    for (const value of ["/구매 0", "/구매 -1", "/구매 1 0", "/구매 1 1.5", "/구매 1 1 해봐", "/구매잘못"]) assert.equal(isPointShopBuyCommandCandidate(value), false, value);
    assert.equal(normalizePointShopBuyDispatchMessage("/구매 2 4"), "/구매");
  });

  it("keeps all nine product effects and canonical ledgers inside one atomic provider", () => {
    const migration = readFileSync(new URL("../migrations/440_point_shop_buy_effects.sql", import.meta.url), "utf8");
    const source = readFileSync(new URL("../src/shop/point-shop-buy-service.ts", import.meta.url), "utf8");
    for (const name of ["티어 승급티켓🎟","캐슬코인🥇","돌멩이🪨","펫 성격 변경하기😣","펫 외형 변경하기🌟","우표💌","🥕당근이세요?","펫 속성리롤🔄","펫스킬소멸권🧙‍♂️(/펫스킬소멸 번호)"]) assert.ok(migration.includes(name), name);
    for (const fragment of ["withTransaction", "UPDATE currency_accounts", "INSERT INTO currency_ledger", "INSERT INTO inventory_stacks", "INSERT INTO inventory_ledger", "UPDATE player_pets", "INSERT INTO guild_resource_ledger", "INSERT INTO command_audit", "INSERT INTO outbox_messages", "point_shop_purchase_events"]) assert.ok(source.includes(fragment), fragment);
  });

  it("preserves discount, tax, tier bonus, daily limit and limited-pet confirmation policies", () => {
    const source = readFileSync(new URL("../src/shop/point-shop-buy-service.ts", import.meta.url), "utf8");
    for (const fragment of ["쇼핑광", "탈세자", "티어 상승론", "point_shop_carrot_buy", "point_shop_purchase_confirmations", "LEGACY_PET_PERSONALITIES", "generateStarterPet"]) assert.ok(source.includes(fragment), fragment);
  });
});

