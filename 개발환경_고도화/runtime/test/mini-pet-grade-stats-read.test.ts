import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MiniPetCatalogProjectionRepository, MiniPetPublishedSnapshotInput, MiniPetReadInput, MiniPetReadResult } from "../src/mini-pet/catalog-projection-repository.js";
import { MiniPetCatalogProjectionService } from "../src/mini-pet/catalog-projection-service.js";
import { formatMiniPetGradeStats, isMiniPetGradeStatsReadCommand } from "../src/mini-pet/grade-stats-read-command.js";

function result(rows = [
  { grade: "이벤트", count: 1, percentage: "16.7" },
  { grade: "창조", count: 1, percentage: "16.7" },
  { grade: "엘리트", count: 2, percentage: "33.3" },
  { grade: "신화", count: 1, percentage: "16.7" },
  { grade: "기타", count: 1, percentage: "16.7" }
]): MiniPetReadResult {
  return {
    projectionCode: "grade_stats", environmentCode: "dev", poolVersion: "collection-v1",
    definitionVersion: "definition-v1", ownedSnapshotVersion: "owned-v1", snapshotAt: "2026-08-25T03:00:00.000Z",
    zeroTotal: rows.length === 0, totalRawProbability: "8", totalNormalizedRate: "100", capacity: 100,
    catalog: [], owned: [], gradeAggregate: rows, gradeTotalCount: rows.reduce((sum, row) => sum + row.count, 0),
    allowedGrades: [], gradeTable: {}, stageRewards: {}, collection: [], collectionGrades: [],
    collectionRepairRequired: false, auditId: "1"
  };
}

class FakeRepository implements MiniPetCatalogProjectionRepository {
  lastRead: MiniPetReadInput | undefined;
  async resolveLatestSnapshotPin() { return { poolVersion: "other-v1", snapshotAt: "2026-08-25T02:00:00.000Z" }; }
  async resolveLatestCollectionSnapshotPin() { return { poolVersion: "collection-v1", snapshotAt: "2026-08-25T03:00:00.000Z" }; }
  async resolveLatestDrawRateSnapshotPin() { return { poolVersion: "draw-v1", snapshotAt: "2026-08-25T03:00:00.000Z" }; }
  async resolveTargetPlayer(_environmentCode: "prod" | "dev", _poolVersion: string, _snapshotAt: string, targetName: string) { return { playerId: "1", displayName: targetName }; }
  async read(input: MiniPetReadInput) { this.lastRead = input; return result(); }
  async publishSnapshot(_input: MiniPetPublishedSnapshotInput) { return { poolVersion: "collection-v1", definitionVersion: "definition-v1", snapshotAt: "2026-08-25T03:00:00.000Z" }; }
}

describe("mini-pet grade stats read", () => {
  it("accepts only the exact no-argument command", () => {
    assert.equal(isMiniPetGradeStatsReadCommand("/미니펫통계"), true);
    assert.equal(isMiniPetGradeStatsReadCommand("/미니펫통계 "), false);
    assert.equal(isMiniPetGradeStatsReadCommand("/미니펫통계 설명"), false);
  });

  it("pins the collection snapshot and requests public grade stats", async () => {
    const repository = new FakeRepository();
    const service = new MiniPetCatalogProjectionService(repository, "dev");
    await service.readLatestGradeStats({ environmentCode: "dev", providerEventId: "event-1" });
    assert.equal(repository.lastRead?.projectionCode, "grade_stats");
    assert.equal(repository.lastRead?.poolVersion, "collection-v1");
    assert.equal(repository.lastRead?.viewerExternalUserId, undefined);
    assert.match(repository.lastRead?.requestHash ?? "", /^[a-f0-9]{64}$/);
  });

  it("formats alias-normalized rows and total in provider order", () => {
    assert.equal(formatMiniPetGradeStats(result()),
      "📊 미니펫 등급별 통계\n이벤트: 1마리 (16.7%)\n창조: 1마리 (16.7%)\n엘리트: 2마리 (33.3%)\n신화: 1마리 (16.7%)\n기타: 1마리 (16.7%)\n총합: 6마리");
  });

  it("returns an explicit empty aggregate", () => {
    assert.equal(formatMiniPetGradeStats(result([])), "📊 미니펫 등급별 통계\n보유 중인 가방 미니펫이 없습니다.");
  });
});
