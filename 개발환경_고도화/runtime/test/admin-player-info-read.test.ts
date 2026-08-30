import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BagView } from "../src/inventory/bag.js";
import {
  formatAdminPlayerInfo,
  isAdminPlayerInfoReadCandidate,
  normalizeAdminPlayerInfoReadDispatchMessage,
  parseAdminPlayerInfoTarget
} from "../src/player/admin-player-info-read-service.js";
import type { ProfileView } from "../src/player/profile.js";

const profile: ProfileView = {
  playerId: "7", displayName: "대상회원", profileVersion: "1", server: null,
  joinedAt: null, level: "3", accumulatedLevel: "5", experience: { current: "12", next: "102" },
  rebirthCount: "2", termsAgreed: true, firstSponsor: false, passes: [],
  currencies: { diamond: "10", point: "20" }, currencyAccounts: [{ code: "diamond", balance: "10", version: "1" }, { code: "point", balance: "20", version: "2" }], counters: {}, activeTitle: "용사", titleCount: "1", petTitleCount: "0",
  guild: null, pet: null, equippedMiniPet: null, home: null, ranks: {}, badges: []
};
const bag: BagView = { playerId: "7", ownerLabel: "대상회원", advertisement: "", items: [{ displayName: "테스트상자", quantity: "3", legacyBagOrder: null }] };

describe("admin player info read", () => {
  it("accepts only the command and a whitespace-separated target", () => {
    assert.equal(isAdminPlayerInfoReadCandidate("/정보"), true);
    assert.equal(isAdminPlayerInfoReadCandidate("/정보 대상회원"), true);
    assert.equal(isAdminPlayerInfoReadCandidate("/정보abc"), false);
    assert.equal(isAdminPlayerInfoReadCandidate("정보 대상회원"), false);
    assert.equal(normalizeAdminPlayerInfoReadDispatchMessage("/정보 대상회원"), "/정보");
    assert.equal(parseAdminPlayerInfoTarget("/정보 대상 회원"), "대상 회원");
  });

  it("combines profile, bag, title, attendance and verification details", () => {
    const data = formatAdminPlayerInfo({ profile, bag, titles: [{ displayName: "용사", equipped: true }], recentAttendanceAt: new Date("2026-08-27T10:00:00.000Z"), verificationCount: "2" });
    assert.match(data, /대상회원/);
    assert.match(data, /테스트상자 x 3/);
    assert.match(data, /용사 ✔/);
    assert.match(data, /최근출석: 2026-08-27T10:00:00.000Z/);
    assert.match(data, /보룸인증: 2회/);
  });

  it("shows explicit empty states", () => {
    const data = formatAdminPlayerInfo({ profile, bag: { ...bag, items: [] }, titles: [], recentAttendanceAt: null, verificationCount: "0" });
    assert.match(data, /가방이 비어 있습니다/);
    assert.match(data, /보유 타이틀 없음/);
    assert.match(data, /보룸인증: 미완료/);
  });
});
