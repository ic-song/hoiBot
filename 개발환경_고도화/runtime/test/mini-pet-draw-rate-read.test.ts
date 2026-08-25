import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  MiniPetCatalogProjectionRepository, MiniPetPublishedSnapshotInput, MiniPetReadInput, MiniPetReadResult
} from "../src/mini-pet/catalog-projection-repository.js";
import { MiniPetCatalogProjectionService } from "../src/mini-pet/catalog-projection-service.js";
import { formatMiniPetDrawRates, isMiniPetDrawRateReadCommand } from "../src/mini-pet/draw-rate-read-command.js";

const grades = ["일반", "고급", "희귀", "영웅", "전설", "전설+", "신화", "신화+", "초월", "초월+", "태초", "태초+", "창세", "창조"];
const probabilities = [50, 20, 10, 8, 5, 2, 1.5, 1, 1, 0.5, 0.4, 0.3, 0.2, 0.1];

function result(total = 100): MiniPetReadResult {
  return {
    projectionCode: "draw_rates", environmentCode: "dev", poolVersion: "draw-v1",
    definitionVersion: "draw-definition-v1", ownedSnapshotVersion: "draw-owned-v1", snapshotAt: "2026-08-25T04:00:00.000Z",
    zeroTotal: total === 0, totalRawProbability: String(total), totalNormalizedRate: total === 0 ? "0" : "100", capacity: 100,
    catalog: grades.map((grade, index) => ({ definitionId: String(index + 1), definitionCode: `draw_${index + 1}`,
      name: grade, gradeCode: `grade_${index + 1}`, grade, emoji: "🐹", sourceOrder: index + 1,
      filterKey: grade, rawProbability: total === 0 ? "0" : String(probabilities[index]), normalizedRate: total === 0 ? "0" : String(probabilities[index]), allowed: true })),
    owned: [], gradeAggregate: [], gradeTotalCount: 0, allowedGrades: grades, gradeTable: {}, stageRewards: {},
    collection: [], collectionGrades: [], collectionRepairRequired: false, auditId: "1"
  };
}

class FakeRepository implements MiniPetCatalogProjectionRepository {
  lastRead: MiniPetReadInput | undefined;
  async resolveLatestSnapshotPin() { return { poolVersion: "other-v1", snapshotAt: "2026-08-25T02:00:00.000Z" }; }
  async resolveLatestCollectionSnapshotPin() { return { poolVersion: "collection-v1", snapshotAt: "2026-08-25T03:00:00.000Z" }; }
  async resolveLatestDrawRateSnapshotPin() { return { poolVersion: "draw-v1", snapshotAt: "2026-08-25T04:00:00.000Z" }; }
  async resolveTargetPlayer(_environmentCode: "prod" | "dev", _poolVersion: string, _snapshotAt: string, targetName: string) { return { playerId: "1", displayName: targetName }; }
  async read(input: MiniPetReadInput) { this.lastRead = input; return result(); }
  async publishSnapshot(_input: MiniPetPublishedSnapshotInput) { return { poolVersion: "draw-v1", definitionVersion: "draw-definition-v1", snapshotAt: "2026-08-25T04:00:00.000Z" }; }
}

describe("mini-pet draw rate read", () => {
  it("accepts only the exact public command", () => {
    assert.equal(isMiniPetDrawRateReadCommand("/미니펫확률"), true);
    assert.equal(isMiniPetDrawRateReadCommand("/미니펫확률 1"), false);
    assert.equal(isMiniPetDrawRateReadCommand("/미니펫확률 안내"), false);
  });

  it("pins the dedicated draw-rate snapshot without viewer identity", async () => {
    const repository = new FakeRepository();
    const service = new MiniPetCatalogProjectionService(repository, "dev");
    await service.readLatestDrawRates({ environmentCode: "dev", providerEventId: "event-1" });
    assert.equal(repository.lastRead?.projectionCode, "draw_rates");
    assert.equal(repository.lastRead?.poolVersion, "draw-v1");
    assert.equal(repository.lastRead?.viewerExternalUserId, undefined);
    assert.match(repository.lastRead?.requestHash ?? "", /^[a-f0-9]{64}$/);
  });

  it("formats allowed entries in source order with four decimals", () => {
    const formatted = formatMiniPetDrawRates(result());
    assert.match(formatted, /^📊 미니펫 등급별 뽑기 확률\n일반: 50\.0000%\n고급: 20\.0000%/);
    assert.match(formatted, /창조: 0\.1000%\n총 확률: 1\.0000$/);
  });

  it("returns an explicit zero-total error", () => {
    assert.equal(formatMiniPetDrawRates(result(0)), "미니펫 뽑기 확률의 총합이 0입니다.");
  });

  it("rejects a reordered provider projection", async () => {
    const repository = new FakeRepository();
    repository.read = async (input) => { repository.lastRead = input; const value = result(); value.catalog.reverse(); return value; };
    const service = new MiniPetCatalogProjectionService(repository, "dev");
    await assert.rejects(service.readLatestDrawRates({ environmentCode: "dev", providerEventId: "event-2" }),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "MINIPET_DRAW_RATE_ENTRIES_INVALID");
  });
});
