import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GetBagService, isBagCommand } from "../src/inventory/get-bag-service.js";
import { formatLegacyBag } from "../src/inventory/legacy-bag-formatter.js";
import type { BagRepository, BagView } from "../src/inventory/bag.js";

const BAG: BagView = {
  playerId: "900000001",
  ownerLabel: "테스트알파",
  advertisement: "합성 광고",
  items: [
    { displayName: "합성 물약", quantity: "3", legacyBagOrder: null },
    { displayName: "잡템☠️", quantity: "20", legacyBagOrder: 20 },
    { displayName: "양념치킨🐔", quantity: "12", legacyBagOrder: 21 },
    { displayName: "ABC", quantity: "2", legacyBagOrder: null },
    { displayName: "펫 친밀도🐾 [Lv.2](3/1000)+4💕", quantity: "1", legacyBagOrder: null }
  ]
};

class FixtureBagRepository implements BagRepository {
  constructor(private readonly value: BagView | null) {}
  async findByExternalIdentity(): Promise<BagView | null> { return this.value; }
}

describe("legacy bag read slice", () => {
  it("accepts only the exact command and legacy alias", () => {
    assert.equal(isBagCommand("/가방"), true);
    assert.equal(isBagCommand("ㄴㄴㄴ"), true);
    assert.equal(isBagCommand("/가방 1"), false);
    assert.equal(isBagCommand("/가방 보여줘"), false);
  });

  it("reproduces intimacy, special, Korean and non-Korean ordering", () => {
    assert.equal(formatLegacyBag(BAG), [
      "[테스트알파]의 가방🧳",
      "(알림📢)후원은 봇 개발에 많은 도움이됩니다.",
      "   1. 펫 친밀도🐾 [Lv.2](3/1000)+4💕 x 1",
      "   2. 잡템☠️ x 20",
      "   3. 양념치킨🐔 x 12",
      "   4. 합성 물약 x 3",
      "   5. ABC x 2"
    ].join("\n"));
  });

  it("keeps an empty bag reply and resolves through the application service", async () => {
    assert.equal(formatLegacyBag({ ...BAG, items: [] }), "가방이 비어 있습니다.");
    assert.equal((await new GetBagService(new FixtureBagRepository(BAG)).execute("kakao", "fixture")).playerId, BAG.playerId);
    await assert.rejects(
      () => new GetBagService(new FixtureBagRepository(null)).execute("kakao", "missing"),
      (error: unknown) => error instanceof Error && error.message === "연결된 캐릭터를 찾을 수 없습니다."
    );
  });

  it("keeps the exact 10/11 item advertisement and 500-ZWSP boundary", () => {
    const item = (index: number) => ({ displayName: `항목${String(index).padStart(2, "0")}`, quantity: "1", legacyBagOrder: null });
    const ten = formatLegacyBag({ ...BAG, items: Array.from({ length: 10 }, (_, index) => item(index)) });
    const eleven = formatLegacyBag({ ...BAG, items: Array.from({ length: 11 }, (_, index) => item(index)) });
    assert.equal(ten.includes("(알림)합성 광고"), false);
    assert.equal(eleven.startsWith("[테스트알파]의 가방🧳\n(알림)합성 광고\n" + "\u200b".repeat(500)), true);
    assert.equal((eleven.match(/\u200b/g) ?? []).length, 500);
  });

  it("reproduces zero and negative legacy truthiness without treating a nonempty bag as empty", () => {
    const output = formatLegacyBag({ ...BAG, items: [
      { displayName: "잡템☠️", quantity: "0", legacyBagOrder: 20 },
      { displayName: "양념치킨🐔", quantity: "-2", legacyBagOrder: 21 },
      { displayName: "일반 0", quantity: "0", legacyBagOrder: null },
    ] });
    assert.equal(output, [
      "[테스트알파]의 가방🧳",
      "(알림📢)후원은 봇 개발에 많은 도움이됩니다.",
      "   1. 양념치킨🐔 x -2",
      "   2. 일반 0 x 0",
    ].join("\n"));
    assert.equal(formatLegacyBag({ ...BAG, items: [{ displayName: "잡템☠️", quantity: "0", legacyBagOrder: 20 }] }), [
      "[테스트알파]의 가방🧳",
      "(알림📢)후원은 봇 개발에 많은 도움이됩니다.",
    ].join("\n"));
  });

  it("puts only the first intimacy key first and sorts later intimacy keys as ordinary Korean items", () => {
    const first = { displayName: "펫 친밀도🐾 [Lv.9](9/1000)+9💕", quantity: "0", legacyBagOrder: null };
    const second = { displayName: "펫 친밀도🐾 [Lv.1](1/1000)+1💕", quantity: "-1", legacyBagOrder: null };
    const output = formatLegacyBag({ ...BAG, items: [first, { displayName: "가나다", quantity: "1", legacyBagOrder: null }, second] });
    assert.deepEqual(output.split("\n").slice(2), [
      `   1. ${first.displayName} x 0`,
      "   2. 가나다 x 1",
      `   3. ${second.displayName} x -1`,
    ]);
  });
});
