import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BagAddService, isBagAddCommandCandidate, parseBagAddCommand } from "../src/inventory/bag-add-service.js";
import type { BagAddRepository, BagAddResult } from "../src/inventory/bag-add.js";
import { InventorySnapshotService, isInventorySnapshotCommand } from "../src/inventory/inventory-snapshot-service.js";
import type { InventorySnapshotRepository, InventorySnapshotResult } from "../src/inventory/inventory-snapshot.js";

class FixtureBagAddRepository implements BagAddRepository {
  addCount = 0;
  constructor(private readonly operatorId: string | null, private readonly result: BagAddResult) {}
  async findAuthorizedOperator(): Promise<string | null> { return this.operatorId; }
  async add(): Promise<BagAddResult> { this.addCount++; return this.result; }
}

class FixtureSnapshotRepository implements InventorySnapshotRepository {
  saveCount = 0;
  constructor(private readonly operatorId: string | null, private readonly result: InventorySnapshotResult) {}
  async findAuthorizedOperator(): Promise<string | null> { return this.operatorId; }
  async save(): Promise<InventorySnapshotResult> { this.saveCount++; return this.result; }
}

describe("legacy bag mutation slice", () => {
  it("accepts the full bag-add form and rejects suffix guide text", () => {
    assert.equal(isBagAddCommandCandidate("/가방추가"), true);
    assert.equal(isBagAddCommandCandidate("/가방"), false);
    assert.deepEqual(parseBagAddCommand("/가방추가 테스트 알파, 합성 물약 3"), {
      targetName: "테스트 알파", itemName: "합성 물약", itemCount: 3n
    });
    assert.equal(parseBagAddCommand("/가방추가 테스트 알파, 합성 물약 3 안내"), null);
    assert.equal(parseBagAddCommand("/가방추가 테스트 알파 합성 물약 3"), null);
  });

  it("silently ignores unauthorized bag additions and preserves the usage reply", async () => {
    const forbidden = new FixtureBagAddRepository(null, { status: "added" });
    assert.deepEqual(await new BagAddService(forbidden).handle({
      externalUserId: "forbidden", channelId: "room", message: "/가방추가 테스트알파, 합성 물약 3", eventId: "1"
    }), { status: "ignored_forbidden" });
    assert.equal(forbidden.addCount, 0);

    const authorized = new FixtureBagAddRepository("1", { status: "added" });
    const invalid = await new BagAddService(authorized).handle({
      externalUserId: "master", channelId: "room", message: "/가방추가 테스트알파, 합성 물약 3 안내", eventId: "2"
    });
    assert.equal(invalid.data, "올바른 명령어 형식을 사용해주세요. 예: /가방추가 [유저명], [아이템명] [갯수]");
    assert.equal(authorized.addCount, 0);
  });

  it("keeps inventory snapshot as an exact command and permission-gated action", async () => {
    assert.equal(isInventorySnapshotCommand("/소지품저장"), true);
    assert.equal(isInventorySnapshotCommand("/소지품저장 지금"), false);
    const repository = new FixtureSnapshotRepository("1", { status: "saved", snapshotId: "7" });
    assert.equal((await new InventorySnapshotService(repository).handle({
      externalUserId: "master", channelId: "room", message: "/소지품저장", eventId: "3"
    })).snapshotId, "7");
    assert.equal(repository.saveCount, 1);
  });
});
