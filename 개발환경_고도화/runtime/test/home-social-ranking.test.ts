import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HomeSocialRankingService,
  formatHomeSocialRanking,
  normalizeHomeSocialRankingRows,
  parseHomeSocialRankingCommand,
  type HomeSocialRankingRepository,
  type HomeSocialRankingRow
} from "../src/home/home-social-ranking.js";

const row = (playerId: string, rankLabel: string, score: bigint, sortName = rankLabel): HomeSocialRankingRow => ({ playerId, rankLabel, sortName, score });

describe("home social ranking", () => {
  it("accepts only the three exact commands", () => {
    assert.equal(parseHomeSocialRankingCommand("/팔로워순위"), "followers");
    assert.equal(parseHomeSocialRankingCommand("/마음순위"), "hearts");
    assert.equal(parseHomeSocialRankingCommand("/뱃지순위"), "badges");
    assert.equal(parseHomeSocialRankingCommand("/팔로워순위 설명"), null);
    assert.equal(parseHomeSocialRankingCommand("/마음순위 "), null);
  });

  it("drops zero scores, sorts score then Korean label, and keeps exactly 100", () => {
    const rows = Array.from({ length: 101 }, (_, index) => row(String(index), `사용자${String(index).padStart(3, "0")}`, BigInt(101 - index)));
    rows.push(row("zero", "미등록", 0n));
    const normalized = normalizeHomeSocialRankingRows(rows);
    assert.equal(normalized.length, 100);
    assert.equal(normalized[0]!.score, 101n);
    assert.equal(normalized[99]!.score, 2n);
    assert.equal(normalized.some((candidate) => candidate.playerId === "zero"), false);
    assert.deepEqual(normalizeHomeSocialRankingRows([row("2", "하나", 5n), row("1", "가나", 5n)]).map((item) => item.rankLabel), ["가나", "하나"]);
    assert.deepEqual(normalizeHomeSocialRankingRows([
      row("2", "A등급 가나", 5n, "하나"), row("1", "S등급 하나", 5n, "가나")
    ]).map((item) => item.playerId), ["1", "2"]);
  });

  it("formats follower and badge scores with legacy headers and separators", () => {
    const snapshot = { viewerRankLabel: "🧪조회자", rows: [row("1", "🧪대상", 3002n)] };
    assert.equal(formatHomeSocialRanking(snapshot, "followers", "ALLSEE"), "[🧪조회자] 님\n🐾━━ 팔로워 순위 TOP 100 ━━🐾\nALLSEE\n\n1위. 🧪대상 — 팔로워 3,002명");
    assert.match(formatHomeSocialRanking(snapshot, "badges", "ALLSEE"), /뱃지 3,002개$/);
  });

  it("formats all four heart counters in legacy display order", () => {
    const output = formatHomeSocialRanking({ viewerRankLabel: "조회자", rows: [{
      ...row("1", "대상", 10n), hearts: { cute: 1n, cheer: 2n, cool: 3n, love: 4n }
    }] }, "hearts", "ALLSEE");
    assert.match(output, /총 10회/);
    assert.match(output, /귀여워🐾 1 \| 멋져요✨ 3 \| 응원해⭐ 2 \| 사랑해💖 4/);
  });

  it("returns the legacy empty ranking message", () => {
    assert.equal(formatHomeSocialRanking({ viewerRankLabel: "조회자", rows: [] }, "badges", "ALLSEE"),
      "[조회자] 님\n🏅━━ 뱃지 순위 TOP 100 ━━🏅\nALLSEE\n\n[순위에 등록된 유저가 없습니다.]");
  });

  it("reads once without mutation and stays silent for an unknown identity", async () => {
    const calls: string[] = [];
    const repository: HomeSocialRankingRepository = {
      read: async (_provider, externalUserId, kind) => {
        calls.push(`${externalUserId}:${kind}`);
        return externalUserId === "missing" ? null : { viewerRankLabel: "조회자", rows: [row("1", "대상", 1n)] };
      }
    };
    const service = new HomeSocialRankingService(repository, "ALLSEE");
    assert.match((await service.execute({ providerCode: "kakao", externalUserId: "viewer", kind: "followers" }))!, /팔로워 1명/);
    assert.equal(await service.execute({ providerCode: "kakao", externalUserId: "missing", kind: "badges" }), null);
    assert.deepEqual(calls, ["viewer:followers", "missing:badges"]);
  });
});
