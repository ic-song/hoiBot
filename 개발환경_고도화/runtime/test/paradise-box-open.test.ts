import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApplicationError } from "../src/shared/application-error.js";
import {
  ParadiseBoxOpenService,
  isParadiseBoxOpenCommandCandidate,
  readParadiseBoxOpenCount,
  type ParadiseBoxOpenCommand,
  type ParadiseBoxOpenRandomSource,
  type ParadiseBoxOpenRepository,
  type ParadiseBoxOpenResult
} from "../src/inventory/paradise-box-open-service.js";

const command: ParadiseBoxOpenCommand = {
  externalUserId: "synthetic-user",
  channelId: "synthetic-room",
  message: "/극락오픈 2",
  eventId: "synthetic-paradise-box-open"
};

class MemoryRepository implements ParadiseBoxOpenRepository {
  stored: ParadiseBoxOpenResult | undefined;
  fail = false;

  async open(request: ParadiseBoxOpenCommand, count: bigint, random: ParadiseBoxOpenRandomSource): Promise<ParadiseBoxOpenResult> {
    if (this.stored !== undefined) return { ...this.stored, duplicate: true };
    const rewards: bigint[] = [];
    for (let index = 0n; index < count; index++) rewards.push(BigInt(1 + Math.floor(random.next() * 10)) * 1_000_000n);
    if (this.fail) throw new Error("synthetic rollback");
    const total = rewards.reduce((sum, value) => sum + value, 0n);
    this.stored = {
      status: "opened", playerId: "1", data: "opened", outboxId: "2", auditId: "3",
      rateVersion: "paradise-box-v1", requestedCount: count.toString(), openedCount: count.toString(),
      totalPoint: total.toString(), balanceAfter: total.toString(), drawPoints: rewards.map(String)
    };
    return this.stored;
  }
}

function sequence(values: number[]): ParadiseBoxOpenRandomSource & { calls: number } {
  let index = 0;
  return { get calls() { return index; }, next() { return values[index++]!; } };
}

describe("paradise-box-open command contract", () => {
  it("accepts only exact no-arg or full numeric forms", () => {
    for (const value of ["/극락오픈", "/극락오픈 1", "/극락오픈 0002"]) assert.equal(isParadiseBoxOpenCommandCandidate(value), true);
    for (const value of [undefined, "/극락오픈 ", "/극락오픈 1 해봐", "/극락오픈 -1", "/극락오픈방법"]) assert.equal(isParadiseBoxOpenCommandCandidate(value), false);
  });

  it("defaults to one and preserves leading-zero numeric quantities", () => {
    assert.equal(readParadiseBoxOpenCount("/극락오픈"), 1n);
    assert.equal(readParadiseBoxOpenCount("/극락오픈 0002"), 2n);
    assert.equal(readParadiseBoxOpenCount("/극락오픈 2 suffix"), null);
  });

  it("rejects zero and requests above the bounded maximum", () => {
    assert.throws(() => readParadiseBoxOpenCount("/극락오픈 0"), (error) => error instanceof ApplicationError && error.code === "PARADISE_BOX_OPEN_COUNT_REQUIRED");
    assert.throws(() => readParadiseBoxOpenCount("/극락오픈 1001"), (error) => error instanceof ApplicationError && error.code === "PARADISE_BOX_OPEN_COUNT_LIMIT");
  });
});

describe("paradise-box-open service contract", () => {
  it("uses one RNG draw per box and preserves inclusive 1m/10m boundaries", async () => {
    const random = sequence([0, 1 - Number.EPSILON]);
    const result = await new ParadiseBoxOpenService(new MemoryRepository(), random).handle(command);
    assert.equal(result.status, "opened");
    if (result.status !== "opened") return;
    assert.deepEqual(result.drawPoints, ["1000000", "10000000"]);
    assert.equal(result.totalPoint, "11000000");
    assert.equal(random.calls, 2);
  });

  it("replays a duplicate without consuming RNG again", async () => {
    const repository = new MemoryRepository();
    const random = sequence([0, 0.5]);
    const service = new ParadiseBoxOpenService(repository, random);
    await service.handle(command);
    const replay = await service.handle(command);
    assert.equal(replay.status, "opened");
    assert.equal("duplicate" in replay && replay.duplicate, true);
    assert.equal(random.calls, 2);
  });

  it("does not retain a result when the repository transaction fails", async () => {
    const repository = new MemoryRepository();
    repository.fail = true;
    await assert.rejects(() => new ParadiseBoxOpenService(repository, sequence([0, 0])).handle(command), /synthetic rollback/);
    assert.equal(repository.stored, undefined);
  });
});
