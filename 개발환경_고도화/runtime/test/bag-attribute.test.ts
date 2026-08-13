import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BagAttributeService, isBagAttributeCommandCandidate, parseBagAttributeCommand } from "../src/inventory/bag-attribute-service.js";
import { sortLegacyBagAttributeItems } from "../src/inventory/maria-bag-attribute-repository.js";
import type {
  BagAttributeItem,
  BagAttributeRepository,
  BagAttributeResult
} from "../src/inventory/bag-attribute.js";

class FixtureRepository implements BagAttributeRepository {
  adjustmentCount = 0;
  constructor(private readonly operatorId: string | null, private readonly result: BagAttributeResult) {}
  async findAuthorizedOperator(): Promise<string | null> { return this.operatorId; }
  async adjust(): Promise<BagAttributeResult> { this.adjustmentCount++; return this.result; }
}

const item = (displayName: string, quantity: bigint, legacyBagOrder: number | null): BagAttributeItem => ({
  itemId: BigInt(displayName.length + 1),
  itemCode: displayName,
  displayName,
  quantity,
  version: 1n,
  legacyBagOrder
});

describe("legacy bag attribute slice", () => {
  it("keeps the startsWith candidate guard but accepts only the full numeric form", () => {
    assert.equal(isBagAttributeCommandCandidate("/가방속성"), true);
    assert.equal(isBagAttributeCommandCandidate("/가방속성안내"), true);
    assert.equal(isBagAttributeCommandCandidate("/가방"), false);
    assert.deepEqual(parseBagAttributeCommand("/가방속성 테스트 알파 2 0"), {
      targetName: "테스트 알파", itemNumber: 2, itemCount: 0n
    });
    assert.equal(parseBagAttributeCommand("/가방속성 테스트 알파 2 3 안내"), null);
    assert.equal(parseBagAttributeCommand("/가방속성 테스트알파 0 -1"), null);
  });

  it("reproduces intimacy, truthy special, Korean and non-Korean numbering", () => {
    const sorted = sortLegacyBagAttributeItems([
      item("ABC", 0n, null),
      item("양념치킨🐔", 0n, 21),
      item("합성 물약", 0n, null),
      item("잡템☠️", 20n, 20),
      item("펫 친밀도🐾 [Lv.2](3/1000)+4💕", 0n, null)
    ]);
    assert.deepEqual(sorted.map((entry) => entry.displayName), [
      "펫 친밀도🐾 [Lv.2](3/1000)+4💕", "잡템☠️", "합성 물약", "ABC"
    ]);
  });

  it("silently ignores non-Master actors and preserves the legacy usage reply", async () => {
    const forbidden = new FixtureRepository(null, { status: "changed" });
    assert.deepEqual(await new BagAttributeService(forbidden).handle({
      externalUserId: "non-master", channelId: "room", message: "/가방속성 테스트알파 1 3", eventId: "1"
    }), { status: "ignored_forbidden" });
    assert.equal(forbidden.adjustmentCount, 0);

    const authorized = new FixtureRepository("1", { status: "changed" });
    const invalid = await new BagAttributeService(authorized).handle({
      externalUserId: "master", channelId: "room", message: "/가방속성 테스트알파 1 3 안내", eventId: "2"
    });
    assert.equal(invalid.data, "올바른 명령어 형식을 사용해주세요. 예: /가방속성 [유저명] [아이템번호] [갯수]");
    assert.equal(authorized.adjustmentCount, 0);
  });
});
