import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatCastleBattleSelfRecord,
  isCastleBattleSelfRecordCommand,
  normalizeCastleBattleSelfRecordDispatchMessage,
  type CastleBattleSelfRecordSnapshot
} from "../src/castle/castle-battle-self-record-read-service.js";

function snapshot(overrides: Partial<CastleBattleSelfRecordSnapshot> = {}): CastleBattleSelfRecordSnapshot {
  return {playerId:"1",displayName:"합성 회원",petName:"합성 펫",petImage:"🐶",petExperience:1200,effectiveUpgradeLevel:12,
    castleCharm:1500,wins:3n,losses:1n,score:1234n,rankName:"👑크라운♥️",rankPosition:2,dailyAttempts:4,...overrides};
}

describe("castle battle self record read", () => {
  it("accepts only the exact legacy command", () => {
    assert.equal(isCastleBattleSelfRecordCommand("/캐슬전적"),true);
    assert.equal(isCastleBattleSelfRecordCommand("/캐슬전적 1"),false);
    assert.equal(isCastleBattleSelfRecordCommand(" /캐슬전적"),false);
  });

  it("normalizes only an executable candidate", () => {
    assert.equal(normalizeCastleBattleSelfRecordDispatchMessage("/캐슬전적"),"/캐슬전적");
    assert.equal(normalizeCastleBattleSelfRecordDispatchMessage("/캐슬전적 확인"),"/캐슬전적 확인");
  });

  it("formats charm, enhancement, win rate, tier, CP and rank", () => {
    const data = formatCastleBattleSelfRecord(snapshot());
    assert.match(data,/캐슬매력: 1,500/);
    assert.match(data,/3승 1패 \(승률 75\.00%\)/);
    assert.match(data,/CP: 1,234/);
    assert.match(data,/순위: 2위/);
  });

  it("keeps empty battle history explicit and mutation-free", () => {
    const data = formatCastleBattleSelfRecord(snapshot({wins:0n,losses:0n,score:0n,rankPosition:null}));
    assert.match(data,/승률 0\.00%/);
    assert.match(data,/순위: 미집계/);
  });
});
