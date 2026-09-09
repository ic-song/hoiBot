import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isHomeBadgeGachaCommandCandidate, normalizeHomeBadgeGachaDispatchMessage, parseHomeBadgeGachaCommand } from "../src/home/home-badge-gacha-command.js";
import { createHomeBadgeGachaSeed, planHomeBadgeGachaDraws, selectHomeBadgeGachaGrade, type HomeBadgeGachaDefinition } from "../src/home/home-badge-gacha-service.js";

describe("home badge gacha open v2.400", () => {
  it("keeps exact command boundaries and usage fallbacks", () => {
    for (const value of ["/홈뱃지오픈", "/홈뱃지오픈 01", "/홈뱃지오픈2", "/홈뱃지오픈2 3", "/홈뱃지오픈3", "/홈뱃지오픈3\t4", "/홈뱃지오픈 2 해봐"]) assert.equal(isHomeBadgeGachaCommandCandidate(value), true);
    for (const value of [undefined, "홈뱃지오픈", "/홈뱃지오픈22", "/홈뱃지오픈3안내"]) assert.equal(isHomeBadgeGachaCommandCandidate(value), false);
    assert.equal(normalizeHomeBadgeGachaDispatchMessage("/홈뱃지오픈2 10"), "/홈뱃지오픈2");
  });

  it("preserves open1/open3 defaults and open2 required count", () => {
    assert.deepEqual(parseHomeBadgeGachaCommand("/홈뱃지오픈")?.count, 1n);
    assert.deepEqual(parseHomeBadgeGachaCommand("/홈뱃지오픈3")?.count, 1n);
    assert.equal(parseHomeBadgeGachaCommand("/홈뱃지오픈2")?.valid, false);
    assert.equal(parseHomeBadgeGachaCommand("/홈뱃지오픈 0")?.valid, false);
    assert.equal(parseHomeBadgeGachaCommand("/홈뱃지오픈3 101")?.valid, false);
    assert.deepEqual(parseHomeBadgeGachaCommand("/홈뱃지오픈2 001")?.count, 1n);
    assert.equal(parseHomeBadgeGachaCommand("/홈뱃지오픈2 1 해봐")?.valid, false);
  });

  it("keeps C/B/A/S 55/30/12/3 boundaries", () => {
    const weights = [{ grade_code: "C", grade_ordinal: 1, weight_value: 55n }, { grade_code: "B", grade_ordinal: 2, weight_value: 30n }, { grade_code: "A", grade_ordinal: 3, weight_value: 12n }, { grade_code: "S", grade_ordinal: 4, weight_value: 3n }];
    assert.equal(selectHomeBadgeGachaGrade(weights, 0), "C");
    assert.equal(selectHomeBadgeGachaGrade(weights, 0.55), "B");
    assert.equal(selectHomeBadgeGachaGrade(weights, 0.85), "A");
    assert.equal(selectHomeBadgeGachaGrade(weights, 0.97), "S");
  });

  it("replays the same two-stage deterministic draw plan", () => {
    const definitions: HomeBadgeGachaDefinition[] = [
      { badge_code: "HB001", source_code: "gacha", grade_code: "C", emoji_value: "🌱", display_name: "C", detail_text: "c", ordinal: 1 },
      { badge_code: "HB002", source_code: "gacha", grade_code: "S", emoji_value: "👑", display_name: "S", detail_text: "s", ordinal: 2 }
    ];
    const weights = [{ grade_code: "C", grade_ordinal: 1, weight_value: 55n }, { grade_code: "S", grade_ordinal: 2, weight_value: 45n }];
    const seed = createHomeBadgeGachaSeed("v2400", "event-1", "42", "open1", 20n);
    const first = planHomeBadgeGachaDraws(seed, definitions, weights, 20, true);
    assert.deepEqual(planHomeBadgeGachaDraws(seed, definitions, weights, 20, true), first);
    assert.equal(first.length, 20);
    assert.ok(first.every(draw => draw.gradeSample !== null && draw.poolSample >= 0 && draw.poolSample < 1));
  });
});
