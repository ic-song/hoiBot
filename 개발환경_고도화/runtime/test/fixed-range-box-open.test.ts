import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import {
  fixedRangeSeed,
  parseFixedRangeBoxCommand,
  planFixedRangeBoxOpen,
  type FixedRangeRandomSource
} from "../src/inventory/fixed-range-box-open-policy.js";
import type {
  FixedRangeBoxActor,
  FixedRangeBoxLockedState,
  FixedRangeBoxOpenRepository,
  FixedRangeBoxOpenTransaction,
  FixedRangeBoxStoredResult
} from "../src/inventory/fixed-range-box-open-repository.js";
import { FixedRangeBoxOpenService } from "../src/inventory/fixed-range-box-open-service.js";

function sequence(values: number[]): FixedRangeRandomSource & { calls: number } {
  let index = 0;
  return {
    get calls() { return index; },
    next() {
      const value = values[index++];
      if (value === undefined) throw new Error("합성 RNG가 소진되었습니다.");
      return value;
    }
  };
}

describe("fixed-range box raw-input parity", () => {
  it("keeps one shared dispatch for both command definitions", async () => {
    const app = await readFile(resolve("src/app.ts"), "utf8");
    assert.equal(app.match(/new FixedRangeBoxOpenService\(/g)?.length, 1);
    assert.equal(app.match(/isFixedRangeBoxCommandCandidate\(normalizedEvent\.message\)/g)?.length, 1);
    assert.equal(FIXED_COMMANDS.filter((commandName) => app.includes(commandName)).length, 0,
      "명령 문자열은 공용 policy 정의에만 존재해야 합니다.");
  });

  it("preserves exact, one-space, multi-space, tab, and rejected suffix boundaries", () => {
    assert.deepEqual(
      ["/정령오픈", "/정령오픈 2", "/정령오픈  2", "/정령오픈\t2"].map((message) => {
        const parsed = parseFixedRangeBoxCommand(message)!;
        return [parsed.parseMode, parsed.requestedOpenCount];
      }),
      [["exact_default_one", 1], ["single_space_number", 2], ["multi_space_all", null], ["whitespace_default_one", 1]]
    );
    for (const message of ["/정령오픈 -1", "/정령오픈 1.5", "/정령오픈 1abc", "/치킨오픈 -1", "/치킨오픈 2개"]) {
      assert.equal(parseFixedRangeBoxCommand(message), null);
    }
  });

  it("caps to locked stock and keeps inclusive 5..10 RNG boundaries in roll order", () => {
    const parsed = parseFixedRangeBoxCommand("/치킨오픈 99")!;
    const plan = planFixedRangeBoxOpen({
      parsed, boxQuantity: 3n, rewardQuantity: 4n, rewardStackExists: true, rankLabel: "합성계정",
      rngSeed: "seed", random: sequence([0, 1, 0.5])
    });
    assert.equal(plan.effectiveOpenCount, 3);
    assert.deepEqual(plan.rngTrace, [5, 10, 8]);
    assert.equal(plan.totalQuantity, 23n);
    assert.equal(plan.boxAfter, 0n);
    assert.equal(plan.rewardAfter, 27n);
    assert.equal(plan.reply, "치킨상자🐔 3개 오픈!!\n[합성계정] 님 양념치킨🐔 23개 획득");
  });

  it("runs zero rolls for explicit zero and preserves a missing zero reward stack", () => {
    const parsed = parseFixedRangeBoxCommand("/정령오픈 0")!;
    const random = sequence([]);
    const plan = planFixedRangeBoxOpen({
      parsed, boxQuantity: 2n, rewardQuantity: 0n, rewardStackExists: false, rankLabel: "합성계정",
      rngSeed: "zero", random
    });
    assert.equal(random.calls, 0);
    assert.equal(plan.effectiveOpenCount, 0);
    assert.deepEqual(plan.rngTrace, []);
    assert.equal(plan.createRewardZeroStack, true);
    assert.equal(plan.boxAfter, 2n);
    assert.equal(plan.rewardAfter, 0n);
  });

  it("derives a stable command-specific seed", () => {
    assert.equal(fixedRangeSeed("event-1", "spirit_box_open"), fixedRangeSeed("event-1", "spirit_box_open"));
    assert.notEqual(fixedRangeSeed("event-1", "spirit_box_open"), fixedRangeSeed("event-1", "chicken_box_open"));
  });
});

const FIXED_COMMANDS = ["/정령오픈", "/치킨오픈"] as const;

class MemoryFixedRangeRepository implements FixedRangeBoxOpenRepository {
  castleActive = false;
  actor: FixedRangeBoxActor | null = { identityId: "11", playerId: "21", rankLabel: "합성계정" };
  state: FixedRangeBoxLockedState = {
    boxItemId: "31", boxQuantity: 2n, boxVersion: 1n,
    rewardItemId: "32", rewardQuantity: 0n, rewardVersion: null, rewardStackExists: false
  };
  stored = new Map<string, FixedRangeBoxStoredResult>();
  persistCalls = 0;
  failPersistCount = 0;

  async withTransaction<T>(work: (transaction: FixedRangeBoxOpenTransaction) => Promise<T>): Promise<T> {
    const snapshot = { ...this.state };
    try {
      return await work(this.transaction());
    } catch (error) {
      this.state = snapshot;
      throw error;
    }
  }

  private transaction(): FixedRangeBoxOpenTransaction {
    return {
      isCastleSiegeActive: async () => this.castleActive,
      findActor: async () => this.actor,
      findStoredResult: async (scope, key) => this.stored.get(`${scope}:${key}`) ?? null,
      lockState: async () => ({ ...this.state }),
      persist: async (actor, scope, key, _command, definition, _state, plan) => {
        this.persistCalls++;
        this.state.boxQuantity = plan.boxAfter;
        this.state.rewardQuantity = plan.rewardAfter;
        this.state.rewardStackExists = true;
        if (this.failPersistCount > 0) {
          this.failPersistCount--;
          throw new Error("synthetic persistence failure");
        }
        const result: FixedRangeBoxStoredResult = {
          status: "opened", playerId: actor.playerId, commandCode: definition.commandCode,
          data: plan.reply, outboxId: "41", auditId: "51", requestedOpenCount: plan.requestedOpenCount,
          effectiveOpenCount: plan.effectiveOpenCount, rngSeed: plan.rngSeed, rngTrace: plan.rngTrace,
          totalQuantity: plan.totalQuantity.toString(), boxBefore: plan.boxBefore.toString(), boxAfter: plan.boxAfter.toString(),
          rewardBefore: plan.rewardBefore.toString(), rewardAfter: plan.rewardAfter.toString(),
          rewardZeroStackCreated: plan.createRewardZeroStack
        };
        this.stored.set(`${scope}:${key}`, result);
        return result;
      }
    };
  }
}

const command = (message: string, eventId = "fixed-event") => ({
  externalUserId: "synthetic-user", channelId: "synthetic-room", message, eventId
});

describe("fixed-range box transaction and replay contract", () => {
  it("keeps castle and unregistered-member behavior silent and requires a positive box stack", async () => {
    const repository = new MemoryFixedRangeRepository();
    repository.castleActive = true;
    assert.equal((await new FixedRangeBoxOpenService(repository).handle(command("/정령오픈"))).status, "blocked_by_castle_siege");
    repository.castleActive = false;
    repository.actor = null;
    assert.equal((await new FixedRangeBoxOpenService(repository).handle(command("/정령오픈"))).status, "ignored_unregistered");
    repository.actor = { identityId: "11", playerId: "21", rankLabel: "합성계정" };
    repository.state.boxQuantity = 0n;
    const required = await new FixedRangeBoxOpenService(repository).handle(command("/정령오픈"));
    assert.deepEqual(required, { status: "box_required", data: "정령상자🥀가 필요합니다." });
  });

  it("replays a committed event from stored result with zero additional RNG calls", async () => {
    const repository = new MemoryFixedRangeRepository();
    const random = sequence([0]);
    const service = new FixedRangeBoxOpenService(repository, () => random);
    const first = await service.handle(command("/정령오픈"));
    const duplicate = await service.handle(command("/정령오픈"));
    assert.equal(first.status, "opened");
    assert.equal(duplicate.status, "opened");
    assert.equal("duplicate" in duplicate && duplicate.duplicate, true);
    assert.equal(repository.persistCalls, 1);
    assert.equal(random.calls, 1);
  });

  it("rolls state back and retries an uncommitted event with the identical deterministic trace", async () => {
    const repository = new MemoryFixedRangeRepository();
    repository.failPersistCount = 1;
    const traces: number[][] = [];
    const service = new FixedRangeBoxOpenService(repository, () => {
      const random = sequence([0, 1]);
      const original = random.next.bind(random);
      const trace: number[] = [];
      traces.push(trace);
      random.next = () => { const value = original(); trace.push(value); return value; };
      return random;
    });
    await assert.rejects(() => service.handle(command("/정령오픈 2", "retry-event")), /synthetic persistence failure/);
    assert.equal(repository.state.boxQuantity, 2n);
    const retry = await service.handle(command("/정령오픈 2", "retry-event"));
    assert.equal(retry.status, "opened");
    assert.deepEqual(traces, [[0, 1], [0, 1]]);
    assert.equal("rngTrace" in retry && retry.rngTrace.join(","), "5,10");
  });

  it("caps later events against the remaining locked quantity", async () => {
    const repository = new MemoryFixedRangeRepository();
    const service = new FixedRangeBoxOpenService(repository, () => sequence([0, 0]));
    const first = await service.handle(command("/치킨오픈", "event-a"));
    const second = await service.handle(command("/치킨오픈 9", "event-b"));
    assert.equal("effectiveOpenCount" in first && first.effectiveOpenCount, 1);
    assert.equal("effectiveOpenCount" in second && second.effectiveOpenCount, 1);
    assert.equal(repository.state.boxQuantity, 0n);
  });
});
