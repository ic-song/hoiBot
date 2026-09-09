import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatSpiritInfoReplies, isSpiritInfoCommand, isSpiritInfoOperator } from "../src/pet/spirit-info-service.js";

describe("spirit info command", () => {
  it("accepts only the exact legacy command", () => {
    assert.equal(isSpiritInfoCommand("/정령정보"), true);
    for (const value of ["/정령정보 1", "/정령정보안내", "정령정보"]) assert.equal(isSpiritInfoCommand(value), false);
  });

  it("keeps the legacy exact display-name guard", () => {
    assert.equal(isSpiritInfoOperator("호이 남"), true);
    assert.equal(isSpiritInfoOperator("호이남"), false);
    assert.equal(isSpiritInfoOperator("다른 사용자"), false);
  });

  it("renders raw elemental JSON and calculated projection in legacy order", () => {
    const replies = formatSpiritInfoReplies({ upgrade: 7n, name: "피닉스🐦‍🔥", grade: "정령왕",
      battleExp: 8000n, battleUpgradeExp: 15n, raidExp: 10000n, raidUpgradeExp: 25n,
      castleExp: 8000n, castleUpgradeExp: 15n });
    assert.deepEqual(replies, [
      '{"upgrade":7,"name":"피닉스🐦‍🔥","grade":"정령왕"}',
      '{"battleExp":8105,"raidExp":10175,"castleExp":8105,"message":""}'
    ]);
  });
});
