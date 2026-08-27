import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isHomeFurnitureFullCleanupCommand } from "./home-furniture-full-cleanup-service.js";

describe("home furniture full cleanup command", () => {
  it("accepts only the exact legacy command", () => {
    assert.equal(isHomeFurnitureFullCleanupCommand("/가구전체정리"), true);
    for (const value of [undefined, "가구전체정리", "/가구전체정리 ", "/가구전체정리 1", "/가구전체정리해줘"]) {
      assert.equal(isHomeFurnitureFullCleanupCommand(value), false);
    }
  });
});
