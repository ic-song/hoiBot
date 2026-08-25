import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApplicationError } from "../src/shared/application-error.js";
import {
  EnhanceRateDrawService,
  isEnhanceRateDrawCommandCandidate,
  readEnhanceRateDrawCount,
  type EnhanceRateDrawCommand,
  type EnhanceRateDrawRandomSource,
  type EnhanceRateDrawRepository,
  type EnhanceRateDrawResult
} from "../src/inventory/enhance-rate-draw-service.js";

const command: EnhanceRateDrawCommand = {
  externalUserId: "synthetic-user", channelId: "synthetic-room",
  message: "/강화뽑기 3", eventId: "synthetic-enhance-rate-draw"
};

class MemoryRepository implements EnhanceRateDrawRepository {
  stored: EnhanceRateDrawResult | undefined;
  fail = false;

  async draw(_command: EnhanceRateDrawCommand, count: bigint, random: EnhanceRateDrawRandomSource): Promise<EnhanceRateDrawResult> {
    if (this.stored !== undefined) return { ...this.stored, duplicate: true };
    const codes: string[] = [];
    for (let index = 0n; index < count; index++) {
      const value = random.next();
      codes.push(value < 0.8 ? "spirit" : value < 0.9 ? "pet" : "mini");
    }
    if (this.fail) throw new Error("synthetic rollback");
    const counts: Record<string, string> = {};
    for (const code of codes) counts[code] = String(Number(counts[code] ?? "0") + 1);
    this.stored = {
      status: "drawn", playerId: "1", data: "opening", resultData: "result",
      outboxId: "2", resultOutboxId: "3", auditId: "4", rateVersion: "enhance-rate-v1",
      requestedCount: count.toString(), drawRewardCodes: codes, rewardCounts: counts
    };
    return this.stored;
  }
}

function sequence(values: number[]): EnhanceRateDrawRandomSource & { calls: number } {
  let index = 0;
  return { get calls() { return index; }, next() { return values[index++]!; } };
}

describe("enhance-rate-draw command contract", () => {
  it("accepts only exact no-arg or complete numeric forms", () => {
    for (const value of ["/강화뽑기", "/강화뽑기 1", "/강화뽑기   0003"]) assert.equal(isEnhanceRateDrawCommandCandidate(value), true);
    for (const value of [undefined, "/강화뽑기 ", "/강화뽑기 1 해봐", "/강화뽑기 -1", "/강화박스오픈"]) assert.equal(isEnhanceRateDrawCommandCandidate(value), false);
  });

  it("defaults to one and handles whitespace and leading zeros", () => {
    assert.equal(readEnhanceRateDrawCount("/강화뽑기"), 1n);
    assert.equal(readEnhanceRateDrawCount("/강화뽑기   0003"), 3n);
    assert.equal(readEnhanceRateDrawCount("/강화뽑기 3 suffix"), null);
  });

  it("rejects zero and values above the bounded maximum", () => {
    assert.throws(() => readEnhanceRateDrawCount("/강화뽑기 0"), (error) => error instanceof ApplicationError && error.code === "ENHANCE_RATE_DRAW_COUNT_REQUIRED");
    assert.throws(() => readEnhanceRateDrawCount("/강화뽑기 1001"), (error) => error instanceof ApplicationError && error.code === "ENHANCE_RATE_DRAW_COUNT_LIMIT");
  });
});

describe("enhance-rate-draw service contract", () => {
  it("preserves exact 80/10/10 boundary draws", async () => {
    const random = sequence([0.799999, 0.8, 0.9]);
    const result = await new EnhanceRateDrawService(new MemoryRepository(), random).handle(command);
    assert.equal(result.status, "drawn");
    if (result.status === "drawn") assert.deepEqual(result.drawRewardCodes, ["spirit", "pet", "mini"]);
  });

  it("replays without consuming RNG or producing another result", async () => {
    const repository = new MemoryRepository(); const random = sequence([0, 0.8, 0.9]);
    const service = new EnhanceRateDrawService(repository, random);
    await service.handle(command); const replay = await service.handle(command);
    assert.equal(replay.status, "drawn"); assert.equal("duplicate" in replay && replay.duplicate, true); assert.equal(random.calls, 3);
  });

  it("retains no result when the repository transaction fails", async () => {
    const repository = new MemoryRepository(); repository.fail = true;
    await assert.rejects(() => new EnhanceRateDrawService(repository, sequence([0, 0.8, 0.9])).handle(command), /synthetic rollback/);
    assert.equal(repository.stored, undefined);
  });
});
