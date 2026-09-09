import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatAdminAuctionResetReply, isAdminAuctionResetCommand } from "../src/admin/admin-auction-reset-service.js";

describe("admin auction reset command boundary", () => {
  it("accepts only the exact legacy command", () => {
    assert.equal(isAdminAuctionResetCommand("/경매초기화"), true);
    for (const message of ["/경매초기화 ", "/경매초기화 안내", "/경매초기화1", "경매초기화", undefined]) {
      assert.equal(isAdminAuctionResetCommand(message), false);
    }
  });

  it("preserves the legacy completion reply", () => {
    assert.equal(formatAdminAuctionResetReply(), "호이상점이 초기화가 되었습니다");
  });
});
