import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatPetIntimacyFullness,
  formatPetIntimacyRanking,
  isPetIntimacyRankCommand,
  type PetIntimacyRankRow,
} from "../src/pet/pet-intimacy-rank-read-service.js";

const row = (name: string, level: bigint, fullnessExp: bigint): PetIntimacyRankRow => ({
  playerId: name,
  displayName: name,
  rankEmoji: "🌱",
  level,
  fullnessExp,
});

describe("pet intimacy rank read command", () => {
  it("accepts only the exact legacy command", () => {
    assert.equal(isPetIntimacyRankCommand("/펫친밀도순위"), true);
    for (const value of ["/펫친밀도순위 1", "/펫친밀도순위목록", "펫친밀도순위"]) {
      assert.equal(isPetIntimacyRankCommand(value), false);
    }
  });

  it("keeps BIGINT-safe legacy k formatting and the current top badge", () => {
    assert.equal(formatPetIntimacyFullness(999n), "999");
    assert.equal(formatPetIntimacyFullness(1000n), "1k");
    assert.equal(formatPetIntimacyFullness(1550n), "1.6k");
    const data = formatPetIntimacyRanking([row("첫째", 9n, 1550n), row("둘째", 8n, 900n)]);
    assert.match(data, /1등 \[🍼첫째\] : Lv\.9 \( 1\.6k🍼 \)/);
    assert.match(data, /2등 \[🌱둘째\] : Lv\.8 \( 900🍼 \)/);
  });

  it("limits output to 100 and inserts allsee only after the first ten rows", () => {
    const data = formatPetIntimacyRanking(Array.from({ length: 101 }, (_, index) => row(`유저${index + 1}`, 100n - BigInt(index), 1000n)));
    assert.equal((data.match(/\u200b/g) ?? []).length, 500);
    assert.match(data, /100등/);
    assert.doesNotMatch(data, /101등/);
    assert.ok(data.indexOf("10등") < data.indexOf("\u200b"));
    assert.ok(data.indexOf("\u200b") < data.indexOf("11등"));
  });
});
