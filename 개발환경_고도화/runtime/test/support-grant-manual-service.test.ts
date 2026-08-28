import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSupportGrantManualCommandCandidate, parseSupportGrantManualCommand } from "../src/admin/support-grant-manual-service.js";

describe("support grant manual command", () => {
  it("accepts only the complete command form", () => {
    assert.equal(isSupportGrantManualCommandCandidate("/후원지급 회원1,회원2/ITEM-RWD-001/3"), true);
    assert.equal(isSupportGrantManualCommandCandidate("/후원지급 회원1/아이템/3 안내"), false);
    assert.equal(isSupportGrantManualCommandCandidate("/후원지급 회원1/아이템"), false);
  });

  it("deduplicates trimmed target names and preserves slashes in item names", () => {
    const command = parseSupportGrantManualCommand("/후원지급 회원1, 회원2,회원1/펫스킬북📙(/펫스킬오픈)/20");
    assert.deepEqual(command, { targetNames: ["회원1", "회원2"], itemReference: "펫스킬북📙(/펫스킬오픈)", quantity: 20n });
  });

  it("returns null for malformed input", () => {
    assert.equal(parseSupportGrantManualCommand("/후원지급 회원1/아이템/수량"), null);
  });
});
