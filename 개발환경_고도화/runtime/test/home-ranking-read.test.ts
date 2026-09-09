import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatHomeRanking, isHomeRankingReadCommand } from "../src/home/home-ranking-read-service.js";

const row = (owner: string, houseName: string, experience: bigint, floorArea: bigint, stableId: string) => ({
  owner,
  houseName,
  experience,
  floorArea,
  stableId
});

describe("home ranking read command", () => {
  it("accepts only the exact legacy command", () => {
    assert.equal(isHomeRankingReadCommand("/펫홈순위"), true);
    for (const value of [undefined, "펫홈순위", "/펫홈순위 ", "/펫홈순위 1", "/펫홈순위목록"]) {
      assert.equal(isHomeRankingReadCommand(value), false);
    }
  });

  it("preserves DB order and renders the legacy header with BIGINT-safe values", () => {
    const data = formatHomeRanking([
      row("⭐첫째", "첫째집", 9007199254740993n, 120n, "11"),
      row("둘째", "둘째집", 12n, 119n, "12")
    ]);
    assert.ok(data.startsWith("🏡 펫스윗홈 순위 🏡\n따라 따라 다~🎵 따라 라리 라라~🎵\n(펫스윗 홈의 평수 순위입니다)\n\n"));
    assert.match(data, /1위 \[⭐첫째\] : 🏡 첫째집\(\+9007199254740993💕\)\[\+120평\]/);
    assert.match(data, /2위 \[둘째\] : 🏡 둘째집\(\+12💕\)\[\+119평\]/);
    assert.ok(data.indexOf("첫째집") < data.indexOf("둘째집"));
  });

  it("inserts exactly 500 allsee characters immediately before rank 11 without truncating rows", () => {
    const data = formatHomeRanking(Array.from({ length: 12 }, (_, index) =>
      row(`회원${index + 1}`, `집${index + 1}`, BigInt(index), BigInt(100 - index), String(index + 1))
    ));
    assert.equal((data.match(/\u200b/g) ?? []).length, 500);
    assert.ok(data.indexOf("10위 [회원10]") < data.indexOf("\u200b"));
    assert.ok(data.indexOf("\u200b") < data.indexOf("11위 [회원11]"));
    assert.match(data, /12위 \[회원12\]/);
  });
});
