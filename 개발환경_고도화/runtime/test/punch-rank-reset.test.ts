import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computePunchRankResetChecksum, isPunchRankResetCommand } from "../src/admin/punch-rank-reset-service.js";

const row = { player_id: 1n, best_score: 1000n, best_rank: "전설", total_play: 4n, total_reward: 3n, legend_count: 1n, last_score: 900n, last_rank: "고수", source_order: 2n, version: 1n, updated_at: "2026-08-29 00:00:00.000000" };

describe("punch rank reset contract", () => {
  it("accepts only the exact command", () => {
    assert.equal(isPunchRankResetCommand("/펀치순위초기화"), true);
    assert.equal(isPunchRankResetCommand("/펀치순위초기화 "), false);
    assert.equal(isPunchRankResetCommand("/펀치순위초기화 1"), false);
    assert.equal(isPunchRankResetCommand("/펀치"), false);
    assert.equal(isPunchRankResetCommand("/펀치순위"), false);
  });

  it("keeps snapshot checksum deterministic and mutation-sensitive", () => {
    const checksum = computePunchRankResetChecksum([row]);
    assert.equal(computePunchRankResetChecksum([row]), checksum);
    assert.notEqual(computePunchRankResetChecksum([{ ...row, best_score: 1001n }]), checksum);
    assert.equal(checksum.length, 64);
  });
});
