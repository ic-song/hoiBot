import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatHomeFurnitureRanking,
  isHomeFurnitureRankCommand
} from "../src/home/home-furniture-rank-read-service.js";

const row = (owner: string, name: string, charm: bigint, grade: string, stableId: string) => ({
  owner,
  name,
  charm,
  grade,
  stableId
});

describe("home furniture rank read command", () => {
  it("accepts only the exact legacy command", () => {
    assert.equal(isHomeFurnitureRankCommand("/가구순위"), true);
    for (const value of [undefined, "가구순위", "/가구순위 ", "/가구순위 1", "/가구순위목록"]) {
      assert.equal(isHomeFurnitureRankCommand(value), false);
    }
  });

  it("preserves DB order and renders the exact legacy header, medals and BIGINT charm", () => {
    const data = formatHomeFurnitureRanking([
      row("첫째", "왕실침대", 9007199254740993n, "SS", "11"),
      row("둘째", "고급침대", 9007199254740992n, "S", "12"),
      row("셋째", "푹신침대", 3n, "A", "13"),
      row("넷째", "나무침대", 2n, "B", "14")
    ]);
    assert.ok(data.startsWith("🛌 펫스윗홈 배치가구 순위 🛌\n(펫하우스 배치 가구매력 기준입니다.)\n\n"));
    assert.match(data, /🥇\. \[첫째\] : 왕실침대\(\+9,007,199,254,740,993💕\)\[SS\]/);
    assert.match(data, /🥈\. \[둘째\] : 고급침대\(\+9,007,199,254,740,992💕\)\[S\]/);
    assert.match(data, /🥉\. \[셋째\] : 푹신침대\(\+3💕\)\[A\]/);
    assert.match(data, / 4\. \[넷째\] : 나무침대\(\+2💕\)\[B\]/);
    assert.ok(data.indexOf("왕실침대") < data.indexOf("고급침대"));
  });

  it("inserts 500 allsee characters immediately before rank 11", () => {
    const data = formatHomeFurnitureRanking(Array.from({ length: 11 }, (_, index) =>
      row(`주인${index + 1}`, `가구${index + 1}`, BigInt(100 - index), "A", String(index + 1))
    ));
    assert.equal((data.match(/\u200b/g) ?? []).length, 500);
    assert.ok(data.indexOf("10. [주인10]") < data.indexOf("\u200b"));
    assert.ok(data.indexOf("\u200b") < data.indexOf("11. [주인11]"));
  });
});
