import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HomeBadgeReferenceService,
  canReadHomeBadgeReference,
  formatHomeBadgeCubeRates,
  formatHomeBadgeGachaRates,
  formatSpecialHomeBadgeDetail,
  formatSpecialHomeBadges,
  parseHomeBadgeReferenceCommand,
  type HomeBadgeReferenceSnapshot
} from "../src/home/home-badge-reference.js";

const snapshot: HomeBadgeReferenceSnapshot = {
  versionId: "1", versionKey: "v1", contentHash: "a".repeat(64), rankLabel: "🧪테스트알파",
  cubeOptions: [
    { sequence: 1, code: "castle", displayName: "캐슬", maxPercent: "50.0" },
    { sequence: 2, code: "raid", displayName: "레이드", maxPercent: "50.0" },
    { sequence: 3, code: "petUpgrade", displayName: "펫강화", maxPercent: "30.0" },
    { sequence: 4, code: "explore", displayName: "펫탐험", maxPercent: "15.0" }
  ],
  cubeRateBands: [
    { sequence: 1, minPercent: "1.0", maxPercent: "1.9", ratePercent: "45.967600" },
    { sequence: 2, minPercent: "10.0", maxPercent: "10.0", ratePercent: "0.001000" },
    { sequence: 3, minPercent: "10.1", maxPercent: "10.9", ratePercent: "0.010000" }
  ],
  gachaGradeRates: [
    { sequence: 1, grade: "C", ratePercent: "55.0000", badgeCount: 23 },
    { sequence: 2, grade: "B", ratePercent: "30.0000", badgeCount: 17 },
    { sequence: 3, grade: "A", ratePercent: "12.0000", badgeCount: 11 },
    { sequence: 4, grade: "S", ratePercent: "3.0000", badgeCount: 6 }
  ],
  specialBadges: [
    { sequence: 1, code: "S01", emoji: "🎂", displayName: "펫홈 1주년", acquisitionText: "운영자 지급 특별 뱃지" },
    { sequence: 2, code: "S13", emoji: "🐺", displayName: "호패 프리미엄", acquisitionText: "운영자 지급 특별 뱃지" }
  ]
};

describe("home badge reference commands", () => {
  it("accepts only exact commands and one complete special-badge token", () => {
    assert.deepEqual(parseHomeBadgeReferenceCommand("/큐브확률"), { kind: "cube-rate" });
    assert.deepEqual(parseHomeBadgeReferenceCommand("/홈뽑기확률"), { kind: "gacha-rate" });
    assert.deepEqual(parseHomeBadgeReferenceCommand("/특별뱃지목록"), { kind: "special-list" });
    assert.deepEqual(parseHomeBadgeReferenceCommand("/특별뱃지목록 [s13]"), { kind: "special-detail", badgeCode: "S13" });
    assert.equal(parseHomeBadgeReferenceCommand("/큐브확률 설명"), null);
    assert.equal(parseHomeBadgeReferenceCommand("/특별뱃지목록 S01 추가"), null);
    assert.equal(parseHomeBadgeReferenceCommand("/특별뱃지목록 "), null);
  });

  it("keeps only cube rates pass-free in a private context", () => {
    assert.equal(canReadHomeBadgeReference({ kind: "cube-rate" }, { isGroupChat: false, hasActivePass: false }), true);
    assert.equal(canReadHomeBadgeReference({ kind: "gacha-rate" }, { isGroupChat: false, hasActivePass: false }), false);
    assert.equal(canReadHomeBadgeReference({ kind: "special-list" }, { isGroupChat: false, hasActivePass: true }), true);
    assert.equal(canReadHomeBadgeReference({ kind: "gacha-rate" }, { isGroupChat: true, hasActivePass: false }), true);
  });

  it("preserves cube ordering, precision, blank separator and maximum guide", () => {
    const output = formatHomeBadgeCubeRates(snapshot);
    assert.match(output, /^\[🧪테스트알파\] 님\n💟 홈뱃지 큐브 확률/);
    assert.match(output, /1\.0%~1\.9% : 45\.967600%/);
    assert.match(output, /10\.0% : 0\.001000%\n\n10\.1%~10\.9% : 0\.010000%/);
    assert.match(output, /캐슬 50% \/ 레이드 50% \/ 펫강화 30% \/ 펫탐험 15%/);
  });

  it("calculates each gacha badge probability from pinned grade counts", () => {
    const output = formatHomeBadgeGachaRates(snapshot);
    assert.match(output, /\[C\] 55% \| 23종 \| 각 2\.39%/);
    assert.match(output, /\[B\] 30% \| 17종 \| 각 1\.76%/);
    assert.match(output, /\[A\] 12% \| 11종 \| 각 1\.09%/);
    assert.match(output, /\[S\] 3% \| 6종 \| 각 0\.50%/);
  });

  it("formats the special list and normalized detail without allsee", () => {
    const list = formatSpecialHomeBadges(snapshot);
    assert.match(list, /\[S01\] 🎂 펫홈 1주년\n\[S13\] 🐺 호패 프리미엄/);
    assert.doesNotMatch(list, /​/);
    assert.match(formatSpecialHomeBadgeDetail(snapshot, "S13"), /획득 조건: 운영자 지급 특별 뱃지$/);
    assert.match(formatSpecialHomeBadgeDetail(snapshot, "S99"), /^❌ 존재하지 않는 특별 뱃지 코드/);
  });

  it("reads one snapshot for an active identity and stays silent otherwise", async () => {
    const reads: Array<[string, string]> = [];
    const service = new HomeBadgeReferenceService({
      readActiveForIdentity: async (provider, externalId) => { reads.push([provider, externalId]); return snapshot; }
    });
    const result = await service.execute({ command: { kind: "gacha-rate" }, providerCode: "kakao", externalUserId: "u1", isGroupChat: true, hasActivePass: false });
    assert.match(result!, /홈뱃지 뽑기 확률/);
    assert.deepEqual(reads, [["kakao", "u1"]]);
    const missing = new HomeBadgeReferenceService({ readActiveForIdentity: async () => null });
    assert.equal(await missing.execute({ command: { kind: "cube-rate" }, providerCode: "kakao", externalUserId: "missing", isGroupChat: true, hasActivePass: false }), null);
  });

  it("rejects malformed special codes before repository access", async () => {
    let reads = 0;
    const service = new HomeBadgeReferenceService({ readActiveForIdentity: async () => { reads++; return snapshot; } });
    const result = await service.execute({ command: { kind: "special-detail", badgeCode: null }, providerCode: "kakao", externalUserId: "u1", isGroupChat: true, hasActivePass: false });
    assert.match(result!, /^❌ 존재하지 않는 특별 뱃지 코드/);
    assert.equal(reads, 0);
  });
});
