import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isLegendaryStoneDrawCommandCandidate, parseLegendaryStoneDrawCommand } from "../src/shop/legendary-stone-draw-command.js";
import { buildLegendaryStoneDrawMessages, resolveLegendaryStoneDraw } from "../src/shop/legendary-stone-draw-service.js";

describe("legendary stone draw command", () => {
  it("accepts only the exact no-argument and numeric forms", () => {
    assert.equal(isLegendaryStoneDrawCommandCandidate("/전돌뽑기"), true);
    assert.equal(isLegendaryStoneDrawCommandCandidate("/전돌뽑기 10"), true);
    assert.equal(isLegendaryStoneDrawCommandCandidate("/전돌뽑기안내"), false);
    assert.deepEqual(parseLegendaryStoneDrawCommand("/전돌뽑기"), { kind: "draw", count: 1n });
    assert.deepEqual(parseLegendaryStoneDrawCommand("/전돌뽑기 100"), { kind: "draw", count: 100n });
    assert.deepEqual(parseLegendaryStoneDrawCommand("/전돌뽑기 0"), { kind: "usage" });
    assert.deepEqual(parseLegendaryStoneDrawCommand("/전돌뽑기 101"), { kind: "limit" });
    assert.deepEqual(parseLegendaryStoneDrawCommand("/전돌뽑기 1 설명"), { kind: "usage" });
  });

  it("preserves every legacy probability boundary", () => {
    const counts = resolveLegendaryStoneDraw([0, 0.01, 0.03, 0.06, 0.11, 0.21]);
    assert.deepEqual(counts, { stone1: 1n, stone2: 1n, stone3: 1n, stone5: 1n, stone10: 1n, stone50: 1n, totalStone: 71n });
    assert.throws(() => resolveLegendaryStoneDraw([1]), /invalid legendary stone RNG sample/);
  });

  it("builds the two legacy replies and jackpot notice", () => {
    const messages = buildLegendaryStoneDrawMessages({ displayName: "합성 유저", rankEmoji: "⭐", useCount: 2n, remaining: 8n, counts: { stone1: 1n, stone2: 0n, stone3: 0n, stone5: 0n, stone10: 0n, stone50: 1n, totalStone: 51n } });
    assert.equal(messages.primary.length, 2);
    assert.match(messages.primary[0]!, /총 획득 전설의 돌맹이: 51개/);
    assert.match(messages.primary[1]!, /티어 승급티켓🎟 8개/);
    assert.match(messages.notice!, /총 1회 당첨/);
  });
});
