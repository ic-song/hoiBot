import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import {
  STARTER_PACKAGE_DEFINITIONS,
  buildStarterPackageOpenReply,
  buildStarterPackageRequiredReply,
  isStarterPackageOpenCommand,
  parseStarterPackageOpenCommand
} from "../src/package/starter-package-open-policy.js";
import type {
  StarterPackageActor,
  StarterPackageCatalog,
  StarterPackageLockedState,
  StarterPackageOpenRepository,
  StarterPackageOpenTransaction,
  StarterPackageStoredResult
} from "../src/package/starter-package-open-repository.js";
import { StarterPackageOpenService } from "../src/package/starter-package-open-service.js";

describe("starter-package raw guard and reply parity", () => {
  it("accepts only the six exact commands", () => {
    for (let stage = 1; stage <= 6; stage++) {
      assert.equal(isStarterPackageOpenCommand(`/초보오픈${stage}`), true);
      assert.equal(parseStarterPackageOpenCommand(`/초보오픈${stage}`).stage, stage);
      for (const suffix of [" ", " 1", "\t", "abc"]) assert.equal(isStarterPackageOpenCommand(`/초보오픈${stage}${suffix}`), false);
    }
    assert.equal(isStarterPackageOpenCommand("/초보오픈7"), false);
  });

  it("preserves all six reward sequences, quantities, point label, and first-supporter wording", () => {
    assert.deepEqual(STARTER_PACKAGE_DEFINITIONS.map(({ rewards }) => rewards.map(({ code, quantity }) => `${code}:${quantity}`)), [
      ["tier_upgrade_ticket:10", "spirit_stone:100", "pet_food_special:30", "pet_food:700"],
      ["tier_upgrade_ticket:10", "spirit_stone:100", "pet_food_special:35", "pet_food:700"],
      ["tier_upgrade_ticket:10", "pet_enhance_stone:200", "spirit_stone:100", "pet_food_special:35", "pet_food:700"],
      ["tier_upgrade_ticket:10", "pet_enhance_stone:200", "spirit_stone:200", "pet_food_special:35"],
      ["tier_upgrade_ticket:10", "pet_enhance_stone:200", "spirit_stone:200", "pet_food_special:35", "pet_food:1000"],
      ["tier_upgrade_ticket:10", "lucky_box:30", "pet_enhance_stone:200", "spirit_stone:200", "pet_food_special:35", "pet_food:1000"]
    ]);
    const replies = STARTER_PACKAGE_DEFINITIONS.map((definition) => buildStarterPackageOpenReply(definition, "합성계정"));
    assert.deepEqual(replies, [
      "초보자 스타터패키지🌟[1] 패키지오픈!!\n\n첫 후원자 [합성계정]님 감사합니다.\n본 후원은 봇개발 기획 및 외주 비용입니다\n더욱더 좋은 커뮤니티 발전에 힘쓰겠습니다 😊\n\n티어 승급티켓🎟 10개\n정령 강화석🥀 100개\n펫먹이특식🥡(/특식오픈) 30개\n펫먹이🍼 700개\n🅟100,000,000",
      "초보자 스타터패키지🌟[2] 패키지오픈!!\n\n후원자 [합성계정]님 감사합니다.\n본 후원은 봇개발 기획 및 외주 비용입니다\n더욱더 좋은 커뮤니티 발전에 힘쓰겠습니다 😊\n\n티어 승급티켓🎟 10개\n정령 강화석🥀 100개\n펫먹이특식🥡(/특식오픈) 35개\n펫먹이🍼 700개\n🅟100,000,000",
      "초보자 스타터패키지🌟[3] 패키지오픈!!\n\n후원자 [합성계정]님 감사합니다.\n본 후원은 봇개발 기획 및 외주 비용입니다\n더욱더 좋은 커뮤니티 발전에 힘쓰겠습니다 😊\n\n티어 승급티켓🎟 10개\n펫 강화석⭐ 200개\n정령 강화석🥀 100개\n펫먹이특식🥡(/특식오픈) 35개\n펫먹이🍼 700개\n🅟100,000,000",
      "초보자 스타터패키지🌟[4] 패키지오픈!!\n\n후원자 [합성계정]님 감사합니다.\n본 후원은 봇개발 기획 및 외주 비용입니다\n더욱더 좋은 커뮤니티 발전에 힘쓰겠습니다 😊\n\n티어 승급티켓🎟 10개\n펫 강화석⭐ 200개\n정령 강화석🥀 200개\n펫먹이특식🥡(/특식오픈) 35개\n🅟100,000,000",
      "초보자 스타터패키지🌟[5] 패키지오픈!!\n\n후원자 [합성계정]님 감사합니다.\n본 후원은 봇개발 기획 및 외주 비용입니다\n더욱더 좋은 커뮤니티 발전에 힘쓰겠습니다 😊\n\n티어 승급티켓🎟 10개\n펫 강화석⭐ 200개\n정령 강화석🥀 200개\n펫먹이특식🥡(/특식오픈) 35개\n펫먹이🍼 1000개\n🅟100,000,000",
      "초보자 스타터패키지🌟[6] 패키지오픈!!\n\n후원자 [합성계정]님 감사합니다.\n본 후원은 봇개발 기획 및 외주 비용입니다\n더욱더 좋은 커뮤니티 발전에 힘쓰겠습니다 😊\n\n티어 승급티켓🎟 10개\n럭키박스🍀(/럭키오픈) 30개\n펫 강화석⭐ 200개\n정령 강화석🥀 200개\n펫먹이특식🥡(/특식오픈) 35개\n펫먹이🍼 1000개\n🅟100,000,000"
    ]);
    assert.equal(buildStarterPackageRequiredReply("합성계정"), "[합성계정] 님\n후원관련은 밑에 링크를 확인해주세요.\nhttps://hoiland123.tistory.com");
  });

  it("keeps one app dispatch and no command literals in app.ts", async () => {
    const app = await readFile(resolve("src/app.ts"), "utf8");
    assert.equal(app.match(/new StarterPackageOpenService\(/g)?.length, 1);
    assert.equal(app.match(/isStarterPackageOpenCommand\(normalizedEvent\.message\)/g)?.length, 1);
    assert.equal(app.includes("/초보오픈"), false);
  });
});

class MemoryRepository implements StarterPackageOpenRepository {
  actor: StarterPackageActor | null = { identityId: "11", playerId: "21", rankLabel: "합성계정" };
  castle = false;
  packageQuantity = 2n;
  point = 100n;
  stored = new Map<string, StarterPackageStoredResult>();
  calls: string[] = [];
  fail = false;

  async withTransaction<T>(work: (transaction: StarterPackageOpenTransaction) => Promise<T>): Promise<T> {
    const snapshot = { packageQuantity: this.packageQuantity, point: this.point, stored: new Map(this.stored) };
    try { return await work(this.transaction()); }
    catch (error) { this.packageQuantity = snapshot.packageQuantity; this.point = snapshot.point; this.stored = snapshot.stored; throw error; }
  }

  private transaction(): StarterPackageOpenTransaction {
    return {
      findActor: async () => { this.calls.push("actor"); return this.actor; },
      findStoredResult: async (scope, key) => { this.calls.push("stored"); return this.stored.get(`${scope}:${key}`) ?? null; },
      isCastleSiegeActive: async () => { this.calls.push("castle"); return this.castle; },
      lockCatalog: async (definition) => { this.calls.push("catalog"); return { packageId: "31", definition, rewards: definition.rewards }; },
      lockState: async (_actor, catalog) => {
        this.calls.push("state");
        const items = new Map<string, { itemId: string; quantity: bigint; version: bigint | null; stackExists: boolean }>();
        items.set(catalog.definition.consumerCode, { itemId: "41", quantity: this.packageQuantity, version: this.packageQuantity === 0n ? null : 1n, stackExists: this.packageQuantity > 0n });
        for (const reward of catalog.rewards) items.set(reward.code, { itemId: reward.code, quantity: 0n, version: null, stackExists: false });
        return { items, pointBalance: this.point, pointVersion: 1n };
      },
      persistRequired: async (actor, scope, key, _command, catalog, state, data) => this.persist(actor, scope, key, catalog, state, data, "package_required"),
      persistOpened: async (actor, scope, key, _command, catalog, state, data) => this.persist(actor, scope, key, catalog, state, data, "opened")
    };
  }

  private async persist(actor: StarterPackageActor, scope: string, key: string, catalog: StarterPackageCatalog,
    state: StarterPackageLockedState, data: string, status: "opened" | "package_required"): Promise<StarterPackageStoredResult> {
    this.calls.push("persist");
    const before = this.packageQuantity;
    if (status === "opened") { this.packageQuantity -= 1n; this.point += catalog.definition.pointQuantity; }
    if (this.fail) throw new Error("synthetic write failure");
    const result: StarterPackageStoredResult = {
      status, playerId: actor.playerId, commandCode: catalog.definition.commandCode, stage: catalog.definition.stage,
      data, outboxId: "51", auditId: "61", packageBefore: before.toString(), packageAfter: this.packageQuantity.toString(),
      pointBefore: state.pointBalance.toString(), pointAfter: this.point.toString(),
      rewards: status === "opened" ? catalog.rewards.map(({ code, displayName, quantity }) => ({ code, displayName, quantity: quantity.toString() })) : []
    };
    this.stored.set(`${scope}:${key}`, result);
    return result;
  }
}

const command = (message = "/초보오픈1", eventId = "starter-event") => ({
  externalUserId: "synthetic-admin-alpha", channelId: "synthetic-room-001", message, eventId
});

describe("starter-package service transaction contract", () => {
  it("keeps unregistered and active-castle requests silent and unchanged", async () => {
    const repository = new MemoryRepository();
    repository.actor = null;
    assert.equal((await new StarterPackageOpenService(repository).handle(command())).status, "ignored_unregistered");
    assert.deepEqual(repository.calls, ["actor"]);
    repository.actor = { identityId: "11", playerId: "21", rankLabel: "합성계정" };
    repository.calls = [];
    repository.castle = true;
    assert.equal((await new StarterPackageOpenService(repository).handle(command())).status, "blocked_by_castle_siege");
    assert.deepEqual(repository.calls, ["actor", "stored", "castle"]);
    assert.equal(repository.packageQuantity, 2n);
  });

  it("persists donation reply for missing/zero package and deletes the semantic zero at quantity one", async () => {
    const repository = new MemoryRepository();
    repository.packageQuantity = 0n;
    const required = await new StarterPackageOpenService(repository).handle(command());
    assert.equal(required.status, "package_required");
    assert.equal(repository.point, 100n);
    repository.packageQuantity = 1n;
    const opened = await new StarterPackageOpenService(repository).handle(command("/초보오픈2", "other"));
    assert.equal(opened.status, "opened");
    assert.equal(repository.packageQuantity, 0n);
    assert.equal(repository.point, 100000100n);
  });

  it("replays committed events without a second effect and rolls back failed writes", async () => {
    const repository = new MemoryRepository();
    const service = new StarterPackageOpenService(repository);
    const first = await service.handle(command());
    const duplicate = await service.handle(command());
    assert.equal(first.status, "opened");
    assert.equal("duplicate" in duplicate && duplicate.duplicate, true);
    assert.equal(repository.packageQuantity, 1n);
    assert.equal(repository.point, 100000100n);
    repository.fail = true;
    await assert.rejects(() => service.handle(command("/초보오픈3", "rollback")), /synthetic write failure/);
    assert.equal(repository.packageQuantity, 1n);
    assert.equal(repository.point, 100000100n);
  });
});
