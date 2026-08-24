import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HomeSocialFollowService,
  formatHomeSocialFollowList,
  parseHomeSocialFollowCommand,
  type HomeSocialFollowCompletion,
  type HomeSocialFollowListRow,
  type HomeSocialFollowPlayer,
  type HomeSocialFollowRepository,
  type HomeSocialFollowResult,
  type HomeSocialFollowTransaction
} from "../src/home/home-social-follow.js";

const alpha: HomeSocialFollowPlayer = { playerId: "1", displayName: "알파", rankLabel: "🧪알파", activePass: true, premiumPass: true };
const beta: HomeSocialFollowPlayer = { playerId: "2", displayName: "베타", rankLabel: "🧪베타", activePass: true, premiumPass: false };
const gamma: HomeSocialFollowPlayer = { playerId: "3", displayName: "감마", rankLabel: "🧪감마", activePass: false, premiumPass: false };

class MemoryRepository implements HomeSocialFollowRepository {
  players = new Map([alpha, beta, gamma].map((value) => [value.playerId, { ...value }]));
  identities = new Map([["alpha", "1"], ["beta", "2"], ["gamma", "3"]]);
  relations = new Set<string>();
  alerts: string[] = [];
  badges = new Map<string, Set<string>>();
  results = new Map<string, HomeSocialFollowResult>();
  nextId = 1;
  failAfterMutation = false;

  async runInTransaction<T>(work: (transaction: HomeSocialFollowTransaction) => Promise<T>): Promise<T> {
    const snapshot = { relations: new Set(this.relations), alerts: [...this.alerts], badges: new Map([...this.badges].map(([key, value]) => [key, new Set(value)])) };
    try { return await work(this.transaction()); }
    catch (error) { this.relations = snapshot.relations; this.alerts = snapshot.alerts; this.badges = snapshot.badges; throw error; }
  }

  private transaction(): HomeSocialFollowTransaction {
    return {
      resolveActor: async (_provider, external) => this.player(this.identities.get(external)),
      findTargetAtStart: async (content) => {
        const match = [...this.players.values()].filter((candidate) => content === candidate.displayName || content.startsWith(candidate.displayName + " "))
          .sort((left, right) => right.displayName.length - left.displayName.length)[0];
        return match === undefined ? null : { ...match, rest: content.slice(match.displayName.length).trim() };
      },
      lockPlayersOrdered: async (ids) => ids.sort((a, b) => Number(a) - Number(b)).map((id) => this.player(id)).filter((value): value is HomeSocialFollowPlayer => value !== null),
      readPriorResult: async (eventId, commandCode, actorId) => this.results.get(`${eventId}:${commandCode}:${actorId}`) ?? null,
      startCommand: async (eventId, commandCode, actorId) => `${eventId}:${commandCode}:${actorId}`,
      isFollowing: async (follower, followed) => this.relations.has(`${follower}->${followed}`),
      setFollowing: async (follower, followed, active) => {
        if (active) this.relations.add(`${follower}->${followed}`); else this.relations.delete(`${follower}->${followed}`);
        if (this.failAfterMutation) throw new Error("synthetic save fault");
      },
      addAlert: async (_operation, target, actor, type, mutual) => { this.alerts.push(`${target}:${actor}:${type}:${mutual}`); },
      awardEligibleBadges: async (_operation, playerId) => {
        const owned = this.badges.get(playerId) ?? new Set<string>();
        const awarded: string[] = [];
        const followerCount = [...this.relations].filter((relation) => relation.endsWith(`->${playerId}`)).length;
        const mutualCount = [...this.relations].filter((relation) => relation.startsWith(`${playerId}->`) && this.relations.has(relation.split("->").reverse().join("->"))).length;
        for (const [code, earned] of [["followers-1", followerCount >= 1], ["mutual-1", mutualCount >= 1]] as const) {
          if (earned && !owned.has(code)) { owned.add(code); awarded.push(code); this.alerts.push(`${playerId}:${playerId}:badge_earned:false`); }
        }
        this.badges.set(playerId, owned); return awarded;
      },
      recordActivity: async () => {},
      countFollowing: async (playerId) => [...this.relations].filter((relation) => relation.startsWith(`${playerId}->`)).length,
      readList: async (playerId, type) => this.list(playerId, type),
      completeCommand: async (operationId, _completion: HomeSocialFollowCompletion, result) => {
        const completed = { ...result, auditId: String(this.nextId), outboxId: String(this.nextId++) };
        this.results.set(operationId, completed); return completed;
      }
    };
  }

  private player(id: string | undefined): HomeSocialFollowPlayer | null {
    const found = id === undefined ? undefined : this.players.get(id);
    return found === undefined ? null : { ...found };
  }

  private list(playerId: string, type: "followers" | "following"): HomeSocialFollowListRow[] {
    return [...this.relations].flatMap((relation) => {
      const [follower, followed] = relation.split("->") as [string, string];
      const target = type === "followers" && followed === playerId ? follower : type === "following" && follower === playerId ? followed : null;
      if (target === null) return [];
      return [{ playerId: target, rankLabel: this.players.get(target)!.rankLabel, mutual: this.relations.has(`${followed}->${follower}`) }];
    });
  }
}

const input = (externalUserId: string, message: string, eventId: string) => ({ providerCode: "synthetic", externalUserId, channelId: "room", message, eventId });

describe("home social follow", () => {
  it("accepts only the four legacy command shapes", () => {
    assert.equal(parseHomeSocialFollowCommand("/팔로워")?.commandCode, "home_social_followers");
    assert.equal(parseHomeSocialFollowCommand("/팔로잉")?.commandCode, "home_social_following");
    assert.equal(parseHomeSocialFollowCommand("/팔로우 베타")?.commandCode, "home_social_follow");
    assert.equal(parseHomeSocialFollowCommand("/언팔로우 베타")?.commandCode, "home_social_unfollow");
    assert.equal(parseHomeSocialFollowCommand("/팔로워순위"), null);
    assert.equal(parseHomeSocialFollowCommand("/팔로우"), null);
  });

  it("creates a normal follow, alert, badge and exact reply", async () => {
    const repository = new MemoryRepository(); const service = new HomeSocialFollowService(repository, "ALLSEE");
    const result = await service.handle(input("alpha", "/팔로우 베타", "normal"));
    assert.equal(result.data, "✅ 🧪베타님을 팔로우했습니다.\n현재 팔로잉: 1명");
    assert.equal(repository.relations.has("1->2"), true);
    assert.equal(repository.alerts.includes("2:1:follow:false"), true);
    assert.equal(repository.badges.get("2")?.has("followers-1"), true);
  });

  it("forms mutual follow and awards both sides without duplicates", async () => {
    const repository = new MemoryRepository(); repository.relations.add("2->1");
    const service = new HomeSocialFollowService(repository, "ALLSEE");
    const result = await service.handle(input("alpha", "/팔로우 베타", "mutual"));
    assert.match(result.data!, /^🤝 🧪베타 님과 맞팔/);
    assert.equal(repository.badges.get("1")?.has("mutual-1"), true);
    assert.equal(repository.badges.get("2")?.has("mutual-1"), true);
  });

  it("rejects duplicate, self, missing and suffix targets without relationship mutation", async () => {
    const repository = new MemoryRepository(); const service = new HomeSocialFollowService(repository, "ALLSEE");
    repository.relations.add("1->2");
    assert.match((await service.handle(input("alpha", "/팔로우 베타", "dup"))).data!, /이미/);
    assert.match((await service.handle(input("alpha", "/팔로우 알파", "self"))).data!, /본인은/);
    assert.match((await service.handle(input("alpha", "/팔로우 없음", "missing"))).data!, /존재하지/);
    assert.match((await service.handle(input("alpha", "/팔로우 베타 추가문구", "suffix"))).data!, /사용법/);
    assert.deepEqual([...repository.relations], ["1->2"]);
  });

  it("enforces both follow pass boundaries", async () => {
    const repository = new MemoryRepository(); const service = new HomeSocialFollowService(repository, "ALLSEE");
    repository.players.get("1")!.activePass = false;
    assert.match((await service.handle(input("alpha", "/팔로우 베타", "sender-pass"))).data!, /전용/);
    repository.players.get("1")!.activePass = true;
    assert.match((await service.handle(input("alpha", "/팔로우 감마", "target-pass"))).data!, /미가입/);
  });

  it("unfollows with expired passes and rejects an absent relationship", async () => {
    const repository = new MemoryRepository(); const service = new HomeSocialFollowService(repository, "ALLSEE");
    repository.relations.add("1->2"); repository.players.get("1")!.activePass = false; repository.players.get("2")!.activePass = false;
    assert.match((await service.handle(input("alpha", "/언팔로우 베타", "unfollow"))).data!, /해제했습니다/);
    assert.equal(repository.relations.size, 0);
    assert.match((await service.handle(input("alpha", "/언팔로우 베타", "unfollow-none"))).data!, /아닙니다/);
  });

  it("rolls back all relationship state when persistence fails", async () => {
    const repository = new MemoryRepository(); repository.failAfterMutation = true;
    await assert.rejects(new HomeSocialFollowService(repository, "ALLSEE").handle(input("alpha", "/팔로우 베타", "fault")), /save fault/);
    assert.equal(repository.relations.size, 0); assert.equal(repository.alerts.length, 0);
  });

  it("reuses the committed event result after restart", async () => {
    const repository = new MemoryRepository();
    const first = await new HomeSocialFollowService(repository, "ALLSEE").handle(input("alpha", "/팔로우 베타", "replay"));
    const replay = await new HomeSocialFollowService(repository, "ALLSEE").handle(input("alpha", "/팔로우 베타", "replay"));
    assert.equal(replay.outboxId, first.outboxId); assert.equal(repository.relations.size, 1);
  });

  it("formats empty, premium, stable non-mutual-first and allsee list parity", () => {
    assert.match(formatHomeSocialFollowList(alpha, "followers", [], "ALLSEE"), /^\[👑호이패스 프리미엄👑\]/);
    assert.match(formatHomeSocialFollowList(alpha, "followers", [], "ALLSEE"), /등록된 유저가 없습니다\.$/);
    const rows = Array.from({ length: 11 }, (_, index) => ({ playerId: String(index), rankLabel: `유저${index}`, mutual: index === 0 }));
    const output = formatHomeSocialFollowList(alpha, "following", rows, "ALLSEE");
    assert.ok(output.indexOf("유저1") < output.indexOf("유저0"));
    assert.equal(output.split("ALLSEE").length - 1, 1);
  });

  it("persists list replies and rejects list reads for an inactive pass", async () => {
    const repository = new MemoryRepository(); repository.relations.add("1->2");
    const service = new HomeSocialFollowService(repository, "ALLSEE");
    assert.match((await service.handle(input("alpha", "/팔로잉", "list"))).data!, /🧪베타/);
    assert.match((await service.handle(input("gamma", "/팔로워", "list-pass"))).data!, /이용자만/);
  });
});
