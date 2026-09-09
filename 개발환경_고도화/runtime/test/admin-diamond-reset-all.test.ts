import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAdminDiamondResetAllCommand, normalizeAdminDiamondResetAllDispatchMessage } from "../src/admin/admin-diamond-reset-all-service.js";

describe("admin diamond reset all command boundary", () => {
  it("accepts only the exact request and uppercase eight-character confirmation", () => {
    for (const message of ["/다이아전체초기화", "/다이아전체초기화 확인 A1B2C3D4"]) {
      assert.equal(isAdminDiamondResetAllCommand(message), true);
      assert.equal(normalizeAdminDiamondResetAllDispatchMessage(message), "/다이아전체초기화");
    }
    for (const message of ["/다이아전체초기화 ", "/다이아전체초기화 확인", "/다이아전체초기화 확인 a1b2c3d4", "/다이아전체초기화 확인 A1B2C3D4 안내"]) {
      assert.equal(isAdminDiamondResetAllCommand(message), false);
    }
  });
});
