import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatFreeMarketList, isFreeMarketReadCommand } from "../src/market/free-market-read-service.js";

describe("free market read command", () => {
  it("accepts only the exact command and legacy alias", () => {
    assert.equal(isFreeMarketReadCommand("/자유시장"), true);
    assert.equal(isFreeMarketReadCommand("ㅈㅈ"), true);
    assert.equal(isFreeMarketReadCommand("/자유시장 "), false);
    assert.equal(isFreeMarketReadCommand("ㅈㅈ 안내"), false);
  });

  it("renders an explicit empty projection", () => {
    assert.equal(formatFreeMarketList([]), "🏪 자유시장\n━━━━━━━━━━━━\n현재 등록된 상품이 없습니다.");
  });

  it("keeps query order and renders rank, grade, quantity and price", () => {
    const data = formatFreeMarketList([
      { listing_id: 2n, seller_name: "판매자", rank_emoji: "👑", asset_type_code: "instance", quantity: 1n, price_currency_code: "point", price_amount: "1234567.000", item_name: "기본 펜던트", instance_name: "빛나는 펜던트", instance_icon: "💎", instance_grade: "창세", created_at_text: "2026-08-28 05:00" },
      { listing_id: 1n, seller_name: null, rank_emoji: null, asset_type_code: "stack", quantity: 3n, price_currency_code: "diamond", price_amount: "25.000", item_name: "합성 상자", instance_name: null, instance_icon: null, instance_grade: null, created_at_text: "2026-08-28 04:00" }
    ]);
    assert.match(data, /등록 매물: 2건/);
    assert.ok(data.indexOf("👑판매자") < data.indexOf("탈퇴회원"));
    assert.match(data, /빛나는 펜던트💎\[창세\] ×1/);
    assert.match(data, /가격: 🅟1,234,567/);
    assert.match(data, /합성 상자 ×3/);
  });

  it("does not expose a rank for a missing seller", () => {
    const data = formatFreeMarketList([{ listing_id: 1n, seller_name: null, rank_emoji: "👑", asset_type_code: "stack", quantity: 1n, price_currency_code: "point", price_amount: "1.000", item_name: "상자", instance_name: null, instance_icon: null, instance_grade: null, created_at_text: "2026-08-28 04:00" }]);
    assert.match(data, /\[1\] 탈퇴회원/);
    assert.doesNotMatch(data, /👑탈퇴회원/);
  });
});
