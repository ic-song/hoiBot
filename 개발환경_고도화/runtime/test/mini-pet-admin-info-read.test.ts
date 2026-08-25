import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApplicationError } from "../src/shared/application-error.js";
import type {
  MiniPetCatalogProjectionRepository, MiniPetPublishedSnapshotInput, MiniPetReadInput, MiniPetReadResult
} from "../src/mini-pet/catalog-projection-repository.js";
import { MiniPetCatalogProjectionService } from "../src/mini-pet/catalog-projection-service.js";
import { formatMiniPetAdminInfo, readMiniPetAdminInfoTarget } from "../src/mini-pet/admin-info-read-command.js";

function result(): MiniPetReadResult {
  return {
    projectionCode: "admin_info", environmentCode: "dev", poolVersion: "pool-v1",
    definitionVersion: "definition-v1", ownedSnapshotVersion: "owned-v1", snapshotAt: "2026-08-25T02:00:00.000Z",
    zeroTotal: false, totalRawProbability: "1", totalNormalizedRate: "100", capacity: 100,
    catalog: [], owned: [], gradeAggregate: [], gradeTotalCount: 0, allowedGrades: [], gradeTable: {}, stageRewards: {},
    collection: [], collectionGrades: [], collectionRepairRequired: false, auditId: "1",
    adminLegacySnapshot: { bag: "가방", profile: "기본", rogue: "노출 금지", battle: "전투" }
  };
}

class FakeRepository implements MiniPetCatalogProjectionRepository {
  lastRead: MiniPetReadInput | undefined;
  async resolveLatestSnapshotPin() { return { poolVersion: "pool-v1", snapshotAt: "2026-08-25T02:00:00.000Z" }; }
  async resolveLatestCollectionSnapshotPin() { return { poolVersion: "pool-v1", snapshotAt: "2026-08-25T02:00:00.000Z" }; }
  async resolveLatestDrawRateSnapshotPin() { return { poolVersion: "draw-v1", snapshotAt: "2026-08-25T02:00:00.000Z" }; }
  async resolveTargetPlayer(_environmentCode: "prod" | "dev", _poolVersion: string, _snapshotAt: string, targetName: string) {
    return { playerId: "2", displayName: targetName };
  }
  async read(input: MiniPetReadInput) { this.lastRead = input; return result(); }
  async publishSnapshot(_input: MiniPetPublishedSnapshotInput) { return { poolVersion: "pool-v1", definitionVersion: "definition-v1", snapshotAt: "2026-08-25T02:00:00.000Z" }; }
}

describe("mini-pet admin info read", () => {
  it("accepts exact command plus a non-empty full target only", () => {
    assert.equal(readMiniPetAdminInfoTarget("/미니펫정보"), "");
    assert.equal(readMiniPetAdminInfoTarget("/미니펫정보 테스트 베타"), "테스트 베타");
    assert.equal(readMiniPetAdminInfoTarget("/미니펫정보 "), undefined);
    assert.equal(readMiniPetAdminInfoTarget("/미니펫정보테스트"), undefined);
  });

  it("pins snapshot and binds viewer, target and request channel", async () => {
    const repository = new FakeRepository();
    const service = new MiniPetCatalogProjectionService(repository, "dev");
    const data = await service.readLatestAdminInfo({ environmentCode: "dev", providerEventId: "event-1",
      viewerExternalUserId: "admin", requestChannelId: "room-1", targetName: "테스트베타" });
    assert.equal(data.targetDisplayName, "테스트베타");
    assert.equal(repository.lastRead?.projectionCode, "admin_info");
    assert.equal(repository.lastRead?.targetPlayerId, "2");
    assert.equal(repository.lastRead?.requestChannelId, "room-1");
    assert.match(repository.lastRead?.requestHash ?? "", /^[a-f0-9]{64}$/);
  });

  it("requires an admin request channel", async () => {
    const service = new MiniPetCatalogProjectionService(new FakeRepository(), "dev");
    await assert.rejects(service.read({ projectionCode: "admin_info", environmentCode: "dev", poolVersion: "pool-v1",
      snapshotAt: "2026-08-25T02:00:00.000Z", providerEventId: "event-2", viewerExternalUserId: "admin", targetPlayerId: "2" }),
    (error: unknown) => error instanceof ApplicationError && error.code === "MINIPET_ADMIN_CHANNEL_REQUIRED");
  });

  it("rejects environment mismatch before resolving target", async () => {
    const service = new MiniPetCatalogProjectionService(new FakeRepository(), "dev");
    await assert.rejects(service.readLatestAdminInfo({ environmentCode: "prod", providerEventId: "event-3",
      viewerExternalUserId: "admin", requestChannelId: "room-1", targetName: "테스트베타" }),
    (error: unknown) => error instanceof ApplicationError && error.code === "MINIPET_ENVIRONMENT_MISMATCH");
  });

  it("formats only fixed allowlist sections in fixed order", () => {
    const data = { ...result(), targetDisplayName: "테스트베타" };
    const formatted = formatMiniPetAdminInfo(data);
    assert.match(formatted, /^🔎 테스트베타님의 미니펫 정보/);
    assert.ok(formatted.indexOf("기본 정보") < formatted.indexOf("전투 정보"));
    assert.ok(formatted.indexOf("전투 정보") < formatted.indexOf("미니펫 가방"));
    assert.doesNotMatch(formatted, /노출 금지|rogue/);
  });
});
