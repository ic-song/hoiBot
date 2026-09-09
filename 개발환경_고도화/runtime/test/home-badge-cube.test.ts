import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isHomeBadgeCubeCommandCandidate, normalizeHomeBadgeCubeDispatchMessage, parseHomeBadgeCubeCommand } from "../src/home/home-badge-cube-command.js";
import { applyHomeBadgeCubeRoll, createHomeBadgeCubeSeed, planHomeBadgeCubeRoll, type HomeBadgeCubeRateBand } from "../src/home/home-badge-cube-service.js";

describe("home badge cube v2.400", () => {
  it("keeps exact command boundaries and usage fallback", () => {
    for (const value of ["/홈뱃지큐브", "/홈뱃지큐브 01 1", "/홈뱃지큐브 1 4 001", "/홈뱃지큐브 1 2 해봐"]) assert.equal(isHomeBadgeCubeCommandCandidate(value), true);
    for (const value of [undefined, "홈뱃지큐브", "/홈뱃지큐브안내"]) assert.equal(isHomeBadgeCubeCommandCandidate(value), false);
    assert.equal(normalizeHomeBadgeCubeDispatchMessage("/홈뱃지큐브 1 2 10"), "/홈뱃지큐브");
  });

  it("preserves option syntax, default count, leading zero, and 1-1000 limit", () => {
    assert.deepEqual(parseHomeBadgeCubeCommand("/홈뱃지큐브 01 2"), { badgeNumber: 1, optionNumber: 2, tryCount: 1n, valid: true });
    assert.deepEqual(parseHomeBadgeCubeCommand("/홈뱃지큐브 1 4 010")?.tryCount, 10n);
    assert.equal(parseHomeBadgeCubeCommand("/홈뱃지큐브 1 01")?.valid, false);
    assert.equal(parseHomeBadgeCubeCommand("/홈뱃지큐브 1 2 0")?.valid, false);
    assert.equal(parseHomeBadgeCubeCommand("/홈뱃지큐브 1 2 1001")?.valid, false);
  });

  it("uses two deterministic samples and strict weighted boundaries", () => {
    const bands: HomeBadgeCubeRateBand[] = [
      { band_ordinal: 1, minimum_tenths: 10, maximum_tenths: 19, weight_value: 55000000n },
      { band_ordinal: 2, minimum_tenths: 20, maximum_tenths: 29, weight_value: 45000000n }
    ];
    const seed = createHomeBadgeCubeSeed("v2400", "event-1", "42", "HB001", "castle", 10n);
    const first = planHomeBadgeCubeRoll(seed, 1, bands);
    assert.deepEqual(planHomeBadgeCubeRoll(seed, 1, bands), first);
    assert.ok(first.rolledTenths >= first.band.minimum_tenths && first.rolledTenths <= first.band.maximum_tenths);
  });

  it("preserves integer floor, same-command decimal, and one-band ceiling", () => {
    assert.equal(applyHomeBadgeCubeRoll(268, 500, 100, false).appliedTenths, 260);
    assert.equal(applyHomeBadgeCubeRoll(268, 500, 100, true).appliedTenths, 268);
    assert.equal(applyHomeBadgeCubeRoll(268, 500, 500, false).appliedTenths, 279);
    assert.equal(applyHomeBadgeCubeRoll(99, 500, 109, false).milestonePercent, 10);
    assert.equal(applyHomeBadgeCubeRoll(498, 500, 500, false).appliedTenths, 500);
  });
});
