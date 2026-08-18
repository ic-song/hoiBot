import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isOpenAllCommand, planOpenAll, type OpenAllState, type RandomSource } from "../src/inventory/open-all-policy.js";
import type {
  OpenAllActor,
  OpenAllRepository,
  OpenAllRepositoryTransaction,
  OpenAllStoredResult
} from "../src/inventory/open-all-repository.js";
import { OpenAllService } from "../src/inventory/open-all-service.js";

const state = (quantities: Record<string, bigint>, guild: OpenAllState["guild"] = null): OpenAllState => ({
  rankLabel: "합성계정", point: 0n, quantities, guild
});

const guild = (overrides: Partial<NonNullable<OpenAllState["guild"]>> = {}): NonNullable<OpenAllState["guild"]> => ({
  guildId: "91", displayName: "합성길드", mark: "S", level: 1, experience: 0n, maxMembers: 5,
  memberPlayerIds: ["21", "22"], ...overrides
});

function sequence(values: number[]): RandomSource & { calls: number } {
  let index = 0;
  return {
    get calls() { return index; },
    next() {
      if (index >= values.length) throw new Error("합성 RNG가 소진되었습니다.");
      return values[index++]!;
    }
  };
}

describe("open-all exact command policy", () => {
  it("accepts only the exact standalone command", () => {
    assert.equal(isOpenAllCommand("/전체오픈"), true);
    for (const message of [undefined, "/전체오픈 ", "/전체오픈 1", "/정리", "ㅇㅇㅇ", "/전체판매"]) {
      assert.equal(isOpenAllCommand(message), false);
    }
  });
});

describe("open-all legacy order and boundaries", () => {
  it("keeps an empty bag unchanged and consumes no RNG", () => {
    const random = sequence([]);
    const result = planOpenAll(state({}), random);
    assert.deepEqual(result.deltas, {});
    assert.deepEqual(result.randomTrace, []);
    assert.equal(result.reply, "[합성계정]님의 전체 오픈!!!\n\n오픈할 상자가 없습니다.");
  });

  it("uses inclusive range boundaries in source order for multiple box kinds", () => {
    const random = sequence([0, 1, 0, 1]);
    const result = planOpenAll(state({ trash_box: 2n, pet_enhance_box: 2n }), random);
    assert.equal(result.quantities.trash, 15n);
    assert.equal(result.quantities.pet_enhance_stone, 5n);
    assert.deepEqual(result.randomTrace, [0, 1, 0, 1]);
    assert.deepEqual(result.openedBoxes, ["trash_box", "pet_enhance_box"]);
  });

  it("preserves the special-food double-add bug and does not reopen a newly created food box", () => {
    const random = sequence([0.70, 0.90]);
    const result = planOpenAll(state({ pet_food_special: 2n }), random);
    assert.equal(result.quantities.pet_food_box, 1n);
    assert.equal(result.quantities.pet_food, 200n);
    assert.deepEqual(result.randomTrace, [0.70, 0.90]);
    assert.deepEqual(result.openedBoxes, ["pet_food_special"]);
    assert.match(result.reply, /펫먹이🍼 x 100\n펫먹이🍼 \+100개/);
  });

  it("keeps guild items when membership lookup fails and reports both failures in source order", () => {
    const result = planOpenAll(state({ guild_contribution_medal: 2n, guild_warehouse_package: 1n, trash_box: 1n }), sequence([0]));
    assert.equal(result.quantities.guild_contribution_medal, 2n);
    assert.equal(result.quantities.guild_warehouse_package, 1n);
    assert.equal(result.guildMutation, null);
    assert.match(result.reply, /길드공헌훈장🌟 2개 사용 실패[\s\S]*길드창고패키지🧳 1개 오픈 실패/);
  });

  it("applies contribution and warehouse-package mutations before fixed boxes without consuming RNG", () => {
    const random = sequence([0]);
    const result = planOpenAll(state({
      guild_contribution_medal: 2n, guild_warehouse_package: 3n, mini_point_box: 1n
    }, guild()), random);
    assert.equal(random.calls, 1);
    assert.equal(result.quantities.guild_contribution_medal, undefined);
    assert.equal(result.quantities.guild_warehouse_package, undefined);
    assert.equal(result.quantities.pet_food, 10n);
    assert.equal(result.quantities.mini_pet_ticket, 6n);
    assert.equal(result.quantities.pet_home_shop_open, 4n);
    assert.deepEqual(result.guildMutation, {
      guildId: "91", contributionDelta: 2n, contributionUseCountDelta: 1n, experienceDelta: 2n,
      levelAfter: 1, maxMembersDelta: 0, resourceDeltas: { point: 150000000n },
      warehouseDeltas: {
        pet_skill_book: 3n, guild_warehouse_pendant: 3n,
        guild_warehouse_pet_enhance: 45n, guild_warehouse_mini_pet_enhance: 15n
      },
      memberPetFoodDelta: 0n
    });
    assert.ok(result.reply.indexOf("길드공헌훈장🌟 2개 사용") < result.reply.indexOf("길드창고패키지🧳 3개 오픈"));
    assert.ok(result.reply.indexOf("길드창고패키지🧳 3개 오픈") < result.reply.indexOf("미니상자🎁 1개 오픈"));
  });

  it("applies every crossed guild level reward and gives the actor the all-member food in the same plan", () => {
    const result = planOpenAll(state({ guild_contribution_medal: 1n }, guild({ level: 10, experience: 39999n })), sequence([]));
    assert.equal(result.guildMutation?.levelAfter, 11);
    assert.equal(result.guildMutation?.maxMembersDelta, 0);
    assert.equal(result.guildMutation?.memberPetFoodDelta, 100000n);
    assert.equal(result.quantities.pet_food, 100005n);
    assert.match(result.reply, /Lv\.10 → 11/);
  });

  it("keeps the 13 exploration-box order and rare-roll boundaries", () => {
    const quantities = {
      spirit_dungeon_box: 1n, enhance_dungeon_box: 1n, event_dungeon_box: 1n,
      pet_food_dungeon_box: 1n, jeondor_dungeon_box: 1n, chicken_dungeon_box: 1n,
      lucky_dungeon_box: 1n, land_document_dungeon_box: 1n, shop_open_dungeon_box: 1n,
      diamond_mine_box: 1n, guild_raid_dungeon_box: 1n, pendant_maze_box: 1n,
      archmage_ruins_box: 1n
    };
    const random = sequence([1, 0, 0.99, 1, 0.009999, 1, 0.01]);
    const result = planOpenAll(state(quantities), random);
    assert.deepEqual(result.openedBoxes.slice(-13), Object.keys(quantities));
    assert.equal(result.quantities.pet_enhance_stone, 100n);
    assert.equal(result.quantities.pet_food, 40n);
    assert.equal(result.quantities.pet_skill_book, 1n);
    assert.equal(result.quantities.pendant_enhance_stone, 4n);
    assert.equal(result.quantities.pendant_restore_stone, 1n);
    assert.equal(result.quantities.pet_skill_book_fragment, 5n);
  });
});

class MemoryOpenAllRepository implements OpenAllRepository {
  stored: OpenAllStoredResult | null = null;
  persistCalls = 0;
  rollbackCount = 0;
  failPersist = false;
  quantities: Record<string, bigint> = { trash_box: 1n };

  async withTransaction<T>(work: (transaction: OpenAllRepositoryTransaction) => Promise<T>): Promise<T> {
    const snapshot = { ...this.quantities };
    try {
      return await work(this.transaction());
    } catch (error) {
      this.quantities = snapshot;
      this.rollbackCount++;
      throw error;
    }
  }

  private transaction(): OpenAllRepositoryTransaction {
    const actor: OpenAllActor = { identityId: "11", playerId: "21", rankLabel: "합성계정" };
    return {
      isCastleSiegeActive: async () => false,
      findActor: async () => actor,
      findStoredResult: async () => this.stored,
      lockState: async () => state(this.quantities),
      persist: async (_actor, _scope, _key, _command, plan) => {
        this.persistCalls++;
        this.quantities = { ...plan.quantities };
        if (this.failPersist) throw new Error("synthetic mid-write failure");
        this.stored = {
          status: "opened", playerId: "21", data: plan.reply, outboxId: "31", auditId: "41",
          pointDelta: plan.pointDelta.toString(), randomTrace: plan.randomTrace,
          openedBoxes: plan.openedBoxes, deferredGuildItems: plan.deferredGuildItems
        };
        return this.stored;
      }
    };
  }
}

describe("open-all transaction/idempotency contract", () => {
  const command = { externalUserId: "synthetic-user", channelId: "synthetic-room", message: "/전체오픈", eventId: "event-open-all" };

  it("replays a duplicate event without a second RNG call or mutation", async () => {
    const repository = new MemoryOpenAllRepository();
    const random = sequence([0]);
    const service = new OpenAllService(repository, random);
    const first = await service.handle(command);
    const duplicate = await service.handle(command);
    assert.equal(first.status, "opened");
    assert.equal(duplicate.status, "opened");
    assert.equal("duplicate" in duplicate && duplicate.duplicate, true);
    assert.equal(repository.persistCalls, 1);
    assert.equal(random.calls, 1);
  });

  it("rolls all state back when persistence fails after mutation begins", async () => {
    const repository = new MemoryOpenAllRepository();
    repository.failPersist = true;
    await assert.rejects(() => new OpenAllService(repository, sequence([0])).handle(command), /synthetic mid-write failure/);
    assert.deepEqual(repository.quantities, { trash_box: 1n });
    assert.equal(repository.rollbackCount, 1);
    assert.equal(repository.stored, null);
  });
});
