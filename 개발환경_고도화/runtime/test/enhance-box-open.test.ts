import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApplicationError } from "../src/shared/application-error.js";
import {
  EnhanceBoxOpenService,
  isEnhanceBoxOpenCommandCandidate,
  readEnhanceBoxOpenCount,
  type EnhanceBoxOpenCommand,
  type EnhanceBoxOpenRandomSource,
  type EnhanceBoxOpenRepository,
  type EnhanceBoxOpenResult
} from "../src/inventory/enhance-box-open-service.js";

const command: EnhanceBoxOpenCommand = {
  externalUserId: "synthetic-user",
  channelId: "synthetic-room",
  message: "/강화박스오픈 2",
  eventId: "synthetic-enhance-box-open"
};

class MemoryRepository implements EnhanceBoxOpenRepository {
  stored: EnhanceBoxOpenResult | undefined;
  calls = 0;
  fail = false;

  async open(request: EnhanceBoxOpenCommand, count: bigint, random: EnhanceBoxOpenRandomSource): Promise<EnhanceBoxOpenResult> {
    this.calls++;
    if (this.stored !== undefined) return { ...this.stored, duplicate: true };
    const rewards: number[] = [];
    for (let index = 0n; index < count; index++) rewards.push(70 + Math.floor(random.next() * 31));
    if (this.fail) throw new Error("synthetic rollback");
    const total = rewards.reduce((sum, value) => sum + value, 0);
    this.stored = {
      status: "opened", playerId: "1", data: "opened", outboxId: "2", auditId: "3",
      rateVersion: "enhance-box-v1", requestedCount: count.toString(), openedCount: count.toString(),
      totalReward: total.toString(), drawRewards: rewards
    };
    return this.stored;
  }
}

function sequence(values: number[]): EnhanceBoxOpenRandomSource & { calls: number } {
  let index = 0;
  return { get calls() { return index; }, next() { return values[index++]!; } };
}

describe("enhance-box-open command contract", () => {
  it("accepts only exact no-arg or full numeric forms", () => {
    for (const value of ["/강화박스오픈", "/강화박스오픈 1", "/강화박스오픈 0002"]) {
      assert.equal(isEnhanceBoxOpenCommandCandidate(value), true);
    }
    for (const value of [undefined, "/강화박스오픈 ", "/강화박스오픈 1 해봐", "/강화박스오픈 -1", "/전체오픈"]) {
      assert.equal(isEnhanceBoxOpenCommandCandidate(value), false);
    }
  });

  it("defaults to one and preserves leading-zero numeric quantities", () => {
    assert.equal(readEnhanceBoxOpenCount("/강화박스오픈"), 1n);
    assert.equal(readEnhanceBoxOpenCount("/강화박스오픈 0002"), 2n);
    assert.equal(readEnhanceBoxOpenCount("/강화박스오픈 2 suffix"), null);
  });

  it("rejects zero and requests above the bounded maximum", () => {
    assert.throws(() => readEnhanceBoxOpenCount("/강화박스오픈 0"), (error) => error instanceof ApplicationError && error.code === "ENHANCE_BOX_OPEN_COUNT_REQUIRED");
    assert.throws(() => readEnhanceBoxOpenCount("/강화박스오픈 1001"), (error) => error instanceof ApplicationError && error.code === "ENHANCE_BOX_OPEN_COUNT_LIMIT");
  });
});

describe("enhance-box-open service contract", () => {
  it("uses one RNG draw per requested box and preserves inclusive boundary evidence", async () => {
    const random = sequence([0, 1 - Number.EPSILON]);
    const result = await new EnhanceBoxOpenService(new MemoryRepository(), random).handle(command);
    assert.equal(result.status, "opened");
    if (result.status !== "opened") return;
    assert.deepEqual(result.drawRewards, [70, 100]);
    assert.equal(result.totalReward, "170");
    assert.equal(random.calls, 2);
  });

  it("replays a duplicate without consuming RNG again", async () => {
    const repository = new MemoryRepository();
    const random = sequence([0, 0.5]);
    const service = new EnhanceBoxOpenService(repository, random);
    await service.handle(command);
    const replay = await service.handle(command);
    assert.equal(replay.status, "opened");
    assert.equal("duplicate" in replay && replay.duplicate, true);
    assert.equal(random.calls, 2);
  });

  it("does not retain a result when the repository transaction fails", async () => {
    const repository = new MemoryRepository();
    repository.fail = true;
    await assert.rejects(() => new EnhanceBoxOpenService(repository, sequence([0, 0])).handle(command), /synthetic rollback/);
    assert.equal(repository.stored, undefined);
  });
});
