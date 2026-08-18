import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { ApplicationError } from "../src/shared/application-error.js";
import {
  CASTLE_CARD_CONSUMER,
  CASTLE_CARD_REWARDS,
  castleCardSeed,
  isCastleCardOpenCommandCandidate,
  parseCastleCardOpenCommand,
  planCastleCardOpen,
  selectCastleCardReward,
  type CastleCardRandomSource
} from "../src/inventory/castle-card-open-policy.js";
import type {
  CastleCardActor,
  CastleCardItemState,
  CastleCardLockedState,
  CastleCardOpenRepository,
  CastleCardOpenTransaction,
  CastleCardStoredResult
} from "../src/inventory/castle-card-open-repository.js";
import { CastleCardOpenService } from "../src/inventory/castle-card-open-service.js";

function sequence(values: number[]): CastleCardRandomSource & { calls: number } {
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

describe("castle-card raw parser parity", () => {
  it("preserves exact, numeric, zero, multi-space, tab, and guard rejection behavior", () => {
    assert.deepEqual(parseCastleCardOpenCommand("/카드오픈"), {
      rawMessage: "/카드오픈", parseMode: "exact_default_one", openCount: 1
    });
    assert.equal(parseCastleCardOpenCommand("/카드오픈 3").openCount, 3);
    assert.deepEqual(parseCastleCardOpenCommand("/카드오픈\t3"), {
      rawMessage: "/카드오픈\t3", parseMode: "tab_default_one", openCount: 1
    });
    for (const message of ["/카드오픈 0", "/카드오픈  3"]) {
      assert.throws(() => parseCastleCardOpenCommand(message),
        (error: unknown) => error instanceof ApplicationError && error.code === "CASTLE_CARD_OPEN_COUNT_REQUIRED");
    }
    for (const message of ["/카드오픈 -1", "/카드오픈 1.5", "/카드오픈 2abc", "/카드오픈 2 "]) {
      assert.equal(isCastleCardOpenCommandCandidate(message), false);
    }
  });

  it("keeps one app dispatch and keeps command literals inside the policy", async () => {
    const app = await readFile(resolve("src/app.ts"), "utf8");
    assert.equal(app.match(/new CastleCardOpenService\(/g)?.length, 1);
    assert.equal(app.match(/isCastleCardOpenCommandCandidate\(normalizedEvent\.message\)/g)?.length, 1);
    assert.equal(app.includes("/카드오픈"), false);
  });
});

describe("castle-card RNG thresholds and message order", () => {
  it("moves an exact threshold to the next branch and keeps just-below values in the prior branch", () => {
    const thresholds = CASTLE_CARD_REWARDS.slice(0, -1).map(({ upperExclusive }) => upperExclusive!);
    for (let index = 0; index < thresholds.length; index++) {
      const threshold = thresholds[index]!;
      assert.equal(selectCastleCardReward(threshold).code, CASTLE_CARD_REWARDS[index + 1]!.code);
      assert.equal(selectCastleCardReward(threshold - Number.EPSILON).code, CASTLE_CARD_REWARDS[index]!.code);
    }
    assert.equal(selectCastleCardReward(0.314).code, "trash_box");
  });

  it("uses one RNG call per open, quantity four for pet food, and first-appearance aggregate order", () => {
    const random = sequence([0.114, 0, 0.0003, 0.114]);
    const plan = planCastleCardOpen({
      parsed: parseCastleCardOpenCommand("/카드오픈 4"), rankLabel: "합성계정", rngSeed: "seed", random
    });
    assert.equal(random.calls, 4);
    assert.deepEqual(plan.aggregates, [
      { rewardCode: "pet_food", rewardName: "펫먹이🍼", quantity: "8" },
      { rewardCode: "castle_immortal_unit", rewardName: "캐슬불멸유닛🐉(+1500💕)", quantity: "1" },
      { rewardCode: "castle_myth_unit", rewardName: "캐슬신화유닛🧚🏻‍♀(+1000💕)", quantity: "1" }
    ]);
    assert.deepEqual(plan.rngTrace.map(({ rewardCode }) => rewardCode), [
      "pet_food", "castle_immortal_unit", "castle_myth_unit", "pet_food"
    ]);
    assert.equal(plan.specialNotices.length, 2);
    assert.match(plan.specialNotices[0]!, /불멸유닛 등장/);
    assert.match(plan.specialNotices[1]!, /신화급 유닛 등장/);
    assert.equal(plan.delayedReply,
      "[합성계정] 님의 보상 결과:\n🎁 펫먹이🍼 x 8\n🎁 캐슬불멸유닛🐉(+1500💕) x 1\n🎁 캐슬신화유닛🧚🏻‍♀(+1000💕) x 1");
  });

  it("derives a stable event-and-command seed", () => {
    assert.equal(castleCardSeed("event-1"), castleCardSeed("event-1"));
    assert.notEqual(castleCardSeed("event-1"), castleCardSeed("event-2"));
  });
});

function itemState(quantity = 0n, stackExists = false): CastleCardItemState {
  return { itemId: "1", quantity, version: stackExists ? 1n : null, stackExists };
}

class MemoryCastleCardRepository implements CastleCardOpenRepository {
  actor: CastleCardActor | null = { identityId: "11", playerId: "21", rankLabel: "합성계정", senderName: "합성계정" };
  castleActive = false;
  state: CastleCardLockedState;
  stored = new Map<string, CastleCardStoredResult>();
  persistCalls = 0;
  failPersistCount = 0;
  callOrder: string[] = [];

  constructor(consumerQuantity = 3n) {
    const items = new Map<string, CastleCardItemState>();
    items.set(CASTLE_CARD_CONSUMER.code, itemState(consumerQuantity, true));
    for (const reward of CASTLE_CARD_REWARDS) items.set(reward.code, itemState());
    this.state = { items };
  }

  async withTransaction<T>(work: (transaction: CastleCardOpenTransaction) => Promise<T>): Promise<T> {
    const snapshot = new Map([...this.state.items].map(([code, state]) => [code, { ...state }]));
    try {
      return await work(this.transaction());
    } catch (error) {
      this.state = { items: snapshot };
      throw error;
    }
  }

  private transaction(): CastleCardOpenTransaction {
    return {
      findActor: async () => { this.callOrder.push("actor"); return this.actor; },
      findStoredResult: async (scope, key) => { this.callOrder.push("stored"); return this.stored.get(`${scope}:${key}`) ?? null; },
      lockState: async () => { this.callOrder.push("stacks"); return this.state; },
      isCastleSiegeActive: async () => { this.callOrder.push("castle"); return this.castleActive; },
      persist: async (actor, scope, key, _command, _state, plan) => {
        this.callOrder.push("persist");
        this.persistCalls++;
        const consumer = this.state.items.get(CASTLE_CARD_CONSUMER.code)!;
        consumer.quantity -= BigInt(plan.openCount);
        consumer.stackExists = consumer.quantity > 0n;
        for (const aggregate of plan.aggregates) {
          const reward = this.state.items.get(aggregate.rewardCode)!;
          reward.quantity += BigInt(aggregate.quantity);
          reward.stackExists = true;
        }
        if (this.failPersistCount > 0) {
          this.failPersistCount--;
          throw new Error("synthetic persistence failure");
        }
        const result: CastleCardStoredResult = {
          status: "opened", playerId: actor.playerId, commandCode: "castle_card_open",
          immediateOutboxId: "31", immediateData: plan.immediateReply, delayedOutboxIds: ["32"], auditId: "41",
          openCount: plan.openCount, rngSeed: plan.rngSeed, rngTrace: plan.rngTrace, aggregates: plan.aggregates
        };
        this.stored.set(`${scope}:${key}`, result);
        return result;
      }
    };
  }
}

const command = (message: string, eventId = "castle-card-event") => ({
  externalUserId: "synthetic-admin-alpha", channelId: "synthetic-room-001", message, eventId
});

describe("castle-card service transaction and replay contract", () => {
  it("locks actor and stacks before the castle recheck and keeps castle/unregistered silent", async () => {
    const repository = new MemoryCastleCardRepository();
    repository.castleActive = true;
    assert.equal((await new CastleCardOpenService(repository).handle(command("/카드오픈"))).status, "blocked_by_castle_siege");
    assert.deepEqual(repository.callOrder, ["actor", "stored", "stacks", "castle"]);
    repository.callOrder = [];
    repository.castleActive = false;
    repository.actor = null;
    assert.equal((await new CastleCardOpenService(repository).handle(command("/카드오픈"))).status, "ignored_unregistered");
    assert.deepEqual(repository.callOrder, ["actor"]);
  });

  it("preserves the mismatched shortage name and actual consumer key", async () => {
    const repository = new MemoryCastleCardRepository(1n);
    const result = await new CastleCardOpenService(repository).handle(command("/카드오픈 2"));
    assert.deepEqual(result, {
      status: "consumer_required",
      data: "[합성계정] 합성계정 님\n캐슬카드🃏이 부족합니다. (보유: 1개)"
    });
    assert.equal(repository.state.items.get("pet_food_special")?.quantity, 1n);
    assert.equal(repository.persistCalls, 0);
  });

  it("replays a committed event without RNG or a second mutation", async () => {
    const repository = new MemoryCastleCardRepository();
    const random = sequence([0.314]);
    const service = new CastleCardOpenService(repository, () => random);
    const first = await service.handle(command("/카드오픈"));
    const duplicate = await service.handle(command("/카드오픈"));
    assert.equal(first.status, "opened");
    assert.equal("duplicate" in duplicate && duplicate.duplicate, true);
    assert.equal(random.calls, 1);
    assert.equal(repository.persistCalls, 1);
  });

  it("rolls back and retries an uncommitted event with the same trace", async () => {
    const repository = new MemoryCastleCardRepository(2n);
    repository.failPersistCount = 1;
    const traces: number[][] = [];
    const service = new CastleCardOpenService(repository, () => {
      const values = [0, 0.114];
      traces.push(values);
      return sequence(values);
    });
    await assert.rejects(() => service.handle(command("/카드오픈 2", "retry")), /synthetic persistence failure/);
    assert.equal(repository.state.items.get(CASTLE_CARD_CONSUMER.code)?.quantity, 2n);
    const retry = await service.handle(command("/카드오픈 2", "retry"));
    assert.equal(retry.status, "opened");
    assert.deepEqual(traces, [[0, 0.114], [0, 0.114]]);
    assert.deepEqual("rngTrace" in retry ? retry.rngTrace.map(({ chance }) => chance) : [], [0, 0.114]);
  });
});
