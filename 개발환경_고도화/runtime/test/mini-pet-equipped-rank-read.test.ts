import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApplicationError } from "../src/shared/application-error.js";
import type {
  MiniPetCatalogProjectionRepository, MiniPetPublishedSnapshotInput, MiniPetReadInput, MiniPetReadResult
} from "../src/mini-pet/catalog-projection-repository.js";
import { MiniPetCatalogProjectionService } from "../src/mini-pet/catalog-projection-service.js";
import { formatMiniPetEquippedRank, isMiniPetEquippedRankReadCommand } from "../src/mini-pet/equipped-rank-read-command.js";

function result(count = 2): MiniPetReadResult {
  const owned = Array.from({ length: count }, (_, index) => ({
    ownedId: String(index + 1), playerId: String(index + 1), definitionId: "1", definitionCode: "synthetic",
    name: `합성${index + 1}`, grade: "일반", emoji: "🐾", experience: String(100 - index), equipped: true,
    displayOrder: index + 1, rank: index + 1, ownerDisplayName: `사용자${index + 1}`,
    ownerCheckRank: `🧪사용자${index + 1}`, snapshotVersion: "owned-v1"
  }));
  return {
    projectionCode: "equipped_rank", environmentCode: "dev", poolVersion: "pool-v1",
    definitionVersion: "definition-v1", ownedSnapshotVersion: "owned-v1", snapshotAt: "2026-08-25T02:00:00.000Z",
    zeroTotal: false, totalRawProbability: "1", totalNormalizedRate: "100", capacity: 100,
    catalog: [], owned, gradeAggregate: [], gradeTotalCount: 0, allowedGrades: [], gradeTable: {}, stageRewards: {},
    collection: [], collectionGrades: [], collectionRepairRequired: false, auditId: "1"
  };
}

class FakeRepository implements MiniPetCatalogProjectionRepository {
  lastRead: MiniPetReadInput | undefined;
  async resolveLatestSnapshotPin() { return { poolVersion: "pool-v1", snapshotAt: "2026-08-25T02:00:00.000Z" }; }
  async read(input: MiniPetReadInput) { this.lastRead = input; return result(); }
  async publishSnapshot(_input: MiniPetPublishedSnapshotInput) { return { poolVersion: "pool-v1", definitionVersion: "definition-v1", snapshotAt: "2026-08-25T02:00:00.000Z" }; }
}

describe("mini-pet equipped rank read", () => {
  it("accepts only the exact command", () => {
    assert.equal(isMiniPetEquippedRankReadCommand("/미니펫순위"), true);
    assert.equal(isMiniPetEquippedRankReadCommand("/미니펫순위 "), false);
    assert.equal(isMiniPetEquippedRankReadCommand("/미니펫순위 설명"), false);
  });

  it("pins the latest published snapshot before reading the public rank", async () => {
    const repository = new FakeRepository();
    const service = new MiniPetCatalogProjectionService(repository, "dev");
    const data = await service.readLatestEquippedRank({ environmentCode: "dev", providerEventId: "event-1" });
    assert.equal(data.owned.length, 2);
    assert.equal(repository.lastRead?.projectionCode, "equipped_rank");
    assert.equal(repository.lastRead?.poolVersion, "pool-v1");
    assert.equal(repository.lastRead?.providerEventId, "event-1");
    assert.match(repository.lastRead?.requestHash ?? "", /^[a-f0-9]{64}$/);
  });

  it("rejects an environment mismatch before resolving a snapshot", async () => {
    const service = new MiniPetCatalogProjectionService(new FakeRepository(), "dev");
    await assert.rejects(
      service.readLatestEquippedRank({ environmentCode: "prod", providerEventId: "event-2" }),
      (error: unknown) => error instanceof ApplicationError && error.code === "MINIPET_ENVIRONMENT_MISMATCH"
    );
  });

  it("keeps the empty legacy response as the title only", () => {
    assert.equal(formatMiniPetEquippedRank([]), "🏆 미니펫 종합 순위 🏆");
  });

  it("inserts allsee immediately before the eleventh ranked row", () => {
    const formatted = formatMiniPetEquippedRank(result(11).owned);
    assert.equal((formatted.match(/\u200b/g) ?? []).length, 500);
    assert.ok(formatted.indexOf("\u200b") < formatted.indexOf("11위."));
    assert.match(formatted, /1위\. 🧪사용자1 \| 🐾합성1 \| 일반 \| EXP 100/);
  });
});
