import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isHomeFurnitureEquipSyncCommand, normalizeHomeFurnitureEquipSyncDispatchMessage } from "../src/home/home-furniture-equip-sync-command.js";
import { buildHomeFurnitureEquipSyncReply, planLegacyFurnitureSource } from "../src/home/home-furniture-equip-sync-service.js";

describe("home furniture equip sync",()=>{
  it("accepts only the exact legacy command",()=>{assert.equal(isHomeFurnitureEquipSyncCommand("/장착가구동기화"),true);assert.equal(isHomeFurnitureEquipSyncCommand("/장착가구동기화 1"),false);assert.equal(isHomeFurnitureEquipSyncCommand("/장착가구동기화해"),false);});
  it("normalizes only the exact DB alias",()=>{assert.equal(normalizeHomeFurnitureEquipSyncDispatchMessage("/장착가구동기화"),"/장착가구동기화");assert.equal(normalizeHomeFurnitureEquipSyncDispatchMessage("/장착가구동기화 1"),"/장착가구동기화 1");});
  it("preserves the first split reply",()=>{assert.equal(buildHomeFurnitureEquipSyncReply({userCount:"2",furnitureCount:"3",mergedCount:"4",summaryChangedCount:"1",bagDuplicateRemovedCount:"0",orphanUserCount:"1",placementPromotedCount:"0",backupStatus:"생성 완료"}),"✅ 장착 가구 최초 분리 완료\n━━━━━━━━━━━━━━━\n동기화 유저: 2명\n장착 가구: 3개\n기존 목록 병합: 4개\n요약값 수정: 1명\n가방 중복 제거: 0개\n상세만 남은 유저: 1명\n최초 백업: 생성 완료\n백업 파일: DB home_furniture_sync_backup_rows");});
  it("preserves the ongoing sync reply",()=>{assert.equal(buildHomeFurnitureEquipSyncReply({userCount:"1",furnitureCount:"2",mergedCount:"0",summaryChangedCount:"0",bagDuplicateRemovedCount:"0",orphanUserCount:"0",placementPromotedCount:"0",backupStatus:"기존 백업 유지"}),"✅ 장착 가구 상시 동기화 완료\n━━━━━━━━━━━━━━━\n동기화 유저: 1명\n장착 가구: 2개\n기존 목록 병합: 0개\n요약값 수정: 0명\n가방 중복 제거: 0개\n상세만 남은 유저: 0명");});
  it("rejects destructive source regressions and over-placement",()=>{assert.deepEqual(planLegacyFurnitureSource(3n,1n,2n),{createCount:2n,placementLinkCount:2n});assert.throws(()=>planLegacyFurnitureSource(1n,2n,1n),/감소/);assert.throws(()=>planLegacyFurnitureSource(1n,0n,2n),/초과/);});
});
