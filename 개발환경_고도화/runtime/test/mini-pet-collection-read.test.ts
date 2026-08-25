import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApplicationError } from "../src/shared/application-error.js";
import type { MiniPetCatalogProjectionRepository, MiniPetPublishedSnapshotInput, MiniPetReadInput, MiniPetReadResult } from "../src/mini-pet/catalog-projection-repository.js";
import { MiniPetCatalogProjectionService } from "../src/mini-pet/catalog-projection-service.js";
import { formatMiniPetCollection, isMiniPetCollectionReadCommand } from "../src/mini-pet/collection-read-command.js";

const grades = ["창조", "창세", "태초+", "태초", "초월+", "초월", "신화+", "신화"];

function result(registered = true): MiniPetReadResult {
  return {
    projectionCode: "collection", environmentCode: "dev", poolVersion: "collection-v1",
    definitionVersion: "definition-v1", ownedSnapshotVersion: "owned-v1", snapshotAt: "2026-08-25T03:00:00.000Z",
    zeroTotal: false, totalRawProbability: "8", totalNormalizedRate: "100", capacity: 100,
    catalog: [], owned: [], gradeAggregate: [], gradeTotalCount: 0, allowedGrades: grades,
    gradeTable: {}, stageRewards: { "1": "시작 보상", "2": "성장 보상" },
    collection: grades.map((grade, index) => ({ definitionId: String(index + 1), definitionCode: `grade-${index}`,
      name: grade, grade, registered: registered && index === 0, stage: registered ? 2 : 1,
      completedStage: registered ? 1 : 0, repairRequired: false })),
    collectionGrades: grades.map((grade, index) => ({ grade, registered: registered && index === 0 })),
    collectionRepairRequired: false, auditId: "1"
  };
}

class FakeRepository implements MiniPetCatalogProjectionRepository {
  lastRead: MiniPetReadInput | undefined;
  async resolveLatestSnapshotPin() { return { poolVersion: "other-v1", snapshotAt: "2026-08-25T02:00:00.000Z" }; }
  async resolveLatestCollectionSnapshotPin() { return { poolVersion: "collection-v1", snapshotAt: "2026-08-25T03:00:00.000Z" }; }
  async resolveTargetPlayer(_environmentCode: "prod" | "dev", _poolVersion: string, _snapshotAt: string, targetName: string) { return { playerId: "1", displayName: targetName }; }
  async read(input: MiniPetReadInput) { this.lastRead = input; return result(); }
  async publishSnapshot(_input: MiniPetPublishedSnapshotInput) { return { poolVersion: "collection-v1", definitionVersion: "definition-v1", snapshotAt: "2026-08-25T03:00:00.000Z" }; }
}

describe("mini-pet collection read", () => {
  it("accepts only the exact no-argument command", () => {
    assert.equal(isMiniPetCollectionReadCommand("/미니펫컬렉션"), true);
    assert.equal(isMiniPetCollectionReadCommand("/미니펫컬렉션 "), false);
    assert.equal(isMiniPetCollectionReadCommand("/미니펫컬렉션 설명"), false);
  });

  it("pins the dedicated collection snapshot and reads the viewer without a caller target", async () => {
    const repository = new FakeRepository();
    const service = new MiniPetCatalogProjectionService(repository, "dev");
    await service.readLatestCollection({ environmentCode: "dev", providerEventId: "event-1", viewerExternalUserId: "viewer" });
    assert.equal(repository.lastRead?.projectionCode, "collection");
    assert.equal(repository.lastRead?.poolVersion, "collection-v1");
    assert.equal(repository.lastRead?.targetPlayerId, undefined);
    assert.match(repository.lastRead?.requestHash ?? "", /^[a-f0-9]{64}$/);
  });

  it("rejects a collection result whose eight grades are reordered", async () => {
    class ReorderedRepository extends FakeRepository {
      override async read(input: MiniPetReadInput) {
        const data = await super.read(input);
        data.collectionGrades = [...data.collectionGrades].reverse();
        return data;
      }
    }
    const service = new MiniPetCatalogProjectionService(new ReorderedRepository(), "dev");
    await assert.rejects(service.readLatestCollection({ environmentCode: "dev", providerEventId: "event-2", viewerExternalUserId: "viewer" }),
      (error: unknown) => error instanceof ApplicationError && error.code === "MINIPET_COLLECTION_GRADES_INVALID");
  });

  it("formats stage reward and all eight grades in fixed order", () => {
    const formatted = formatMiniPetCollection(result());
    assert.match(formatted, /현재 단계: 2\n완료 단계: 1\n단계 보상: 성장 보상/);
    assert.deepEqual(formatted.split("\n").filter((line) => line.startsWith("✅") || line.startsWith("⬜")),
      grades.map((grade, index) => `${index === 0 ? "✅" : "⬜"} ${grade}`));
  });

  it("keeps a missing collection as stage one and all false", () => {
    const formatted = formatMiniPetCollection(result(false));
    assert.match(formatted, /현재 단계: 1/);
    assert.equal((formatted.match(/⬜/g) ?? []).length, 8);
  });
});
