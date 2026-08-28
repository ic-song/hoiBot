import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeHomeBadgeInventoryDispatchMessage, parseHomeBadgeInventoryCommand
} from "../src/home/home-badge-inventory-command.js";
import {
  projectCatchUpCodes, resolveHomeBadgeSelection, type HomeBadgeDefinition
} from "../src/home/home-badge-inventory-service.js";

const definitions: HomeBadgeDefinition[] = [
  { definition_version_id: 1n, ordinal: 1, badge_code: "F01", source_code: "achievement", grade_code: null, emoji_value: "🌱", display_name: "첫인연", detail_text: "조건", criteria_json: { followers: 1 }, required_badge_codes_json: null },
  { definition_version_id: 1n, ordinal: 2, badge_code: "A09", source_code: "achievement", grade_code: null, emoji_value: "🏆", display_name: "명예의 전당", detail_text: "조건", criteria_json: null, required_badge_codes_json: ["F01"] },
  { definition_version_id: 1n, ordinal: 3, badge_code: "HB001", source_code: "gacha", grade_code: "C", emoji_value: "🛡️", display_name: "첫 뽑기", detail_text: "설명", criteria_json: null, required_badge_codes_json: null }
];

describe("home badge inventory queries", () => {
  it("accepts exact list commands and a complete detail selection only", () => {
    assert.deepEqual(parseHomeBadgeInventoryCommand("/홈뱃지"), { kind: "owned" });
    assert.deepEqual(parseHomeBadgeInventoryCommand("/홈뱃지전체"), { kind: "all" });
    assert.deepEqual(parseHomeBadgeInventoryCommand("/홈뱃지정보   [hb001]"), { kind: "detail", selection: "[hb001]" });
    assert.equal(parseHomeBadgeInventoryCommand("/홈뱃지 "), null);
    assert.equal(parseHomeBadgeInventoryCommand("/홈뱃지정보"), null);
    assert.equal(parseHomeBadgeInventoryCommand("/홈뱃지정보 1 "), null);
    assert.equal(normalizeHomeBadgeInventoryDispatchMessage("/홈뱃지정보 첫 뽑기"), "/홈뱃지정보");
  });

  it("projects chained achievement catch-up without restoring deleted badges", () => {
    const stats = { followers: 1n, mutual: 0n, receivedComments: 0n, receivedHomeLikes: 0n, receivedReactions: 0n, totalVisits: 0n, feedActiveDays: 0n };
    assert.deepEqual(projectCatchUpCodes(definitions, stats, new Set(), new Set()), ["F01", "A09"]);
    assert.deepEqual(projectCatchUpCodes(definitions, stats, new Set(), new Set(["F01"])), []);
  });

  it("resolves post-catch-up numbers, case-insensitive IDs and exact names", () => {
    const owned = new Set(["F01", "HB001"]);
    assert.equal(resolveHomeBadgeSelection("01", definitions, owned)?.badge_code, "F01");
    assert.equal(resolveHomeBadgeSelection("[hb001]", definitions, owned)?.badge_code, "HB001");
    assert.equal(resolveHomeBadgeSelection("첫 뽑기", definitions, owned)?.badge_code, "HB001");
    assert.equal(resolveHomeBadgeSelection("첫뽑기", definitions, owned), null);
  });
});
