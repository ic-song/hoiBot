import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deterministicGuildTerritoryDrawBps,
  parseGuildTerritoryAttackCommand,
  resolveGuildTerritorySnapshotCombat,
} from "../src/guild/guild-territory-attack-service.js";
import { isPointEditCommandCandidate } from "../src/admin/iris-admin-command-service.js";

const snapshot = (charm: bigint, criticalBps: number, multiplierBps = 20_000) => ({
  player_id: 1n,
  guild_id: 1n,
  castle_charm: charm,
  critical_bps: criticalBps,
  critical_multiplier_bps: multiplierBps,
  surprise_defense_bonus_bps: 0,
  pet_snapshot_json: {},
});

describe("guild territory attack boundary", () => {
  it("accepts only exact /영지공격 [1-9] commands", () => {
    for (let targetNo = 1; targetNo <= 9; targetNo += 1) {
      assert.deepEqual(parseGuildTerritoryAttackCommand(`/영지공격 ${targetNo}`), { targetNo });
      assert.equal(isPointEditCommandCandidate(`/영지공격 ${targetNo}`), true);
    }
    for (const message of [undefined, "/영지공격", "/영지공격 0", "/영지공격 10", "/영지공격 1 추가", "/영지공격 1 ", " /영지공격 1"]) {
      assert.equal(parseGuildTerritoryAttackCommand(message), null);
      assert.equal(isPointEditCommandCandidate(message), false);
    }
  });

  it("repeats deterministic draws and keeps them in the basis-point range", () => {
    const seed = "synthetic-event|101|1|dimension_outcome";
    const first = deterministicGuildTerritoryDrawBps(seed);
    assert.equal(deterministicGuildTerritoryDrawBps(seed), first);
    assert.ok(first >= 0 && first < 10_000);
    assert.notEqual(deterministicGuildTerritoryDrawBps(`${seed}-other`), first);
  });

  it("uses pinned snapshot critical values and lets the defender win ties", () => {
    const tie = resolveGuildTerritorySnapshotCombat({
      attacker: snapshot(100n, 0),
      defender: snapshot(100n, 0),
      attackerDrawBps: 9_999,
      defenderDrawBps: 9_999,
    });
    assert.deepEqual(tie, {
      attackerWins: false,
      attackerCritical: false,
      defenderCritical: false,
      attackerFinalCharm: 100n,
      defenderFinalCharm: 100n,
    });
    const critical = resolveGuildTerritorySnapshotCombat({
      attacker: snapshot(60n, 10_000, 20_000),
      defender: snapshot(100n, 0),
      attackerDrawBps: 9_999,
      defenderDrawBps: 9_999,
    });
    assert.equal(critical.attackerCritical, true);
    assert.equal(critical.attackerFinalCharm, 120n);
    assert.equal(critical.attackerWins, true);
  });
});
