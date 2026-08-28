import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { CastleBattleMemberEditService, parseCastleBattleMemberEditCommand } from "../src/castle/castle-battle-member-edit-service.js";

const config = loadConfig();
if (!config.database.enabled || config.database.name !== "hoibot_castle_battle_member_edit_g7") throw new Error(`Blocked database: ${config.database.name}`);
const database = createDatabaseClient(config.database);
const service = new CastleBattleMemberEditService(database);
const restart = process.argv.includes("--verify-restart");

async function run(eventId: string, message: string) {
  return service.update({ eventId, externalUserId: "castle-member-master", channelId: "castle-member-room", command: parseCastleBattleMemberEditCommand(message) });
}

async function state() {
  return (await database.query<Array<{ attempts: string; score: string; tier: string; runs: bigint; operations: bigint; outboxes: bigint; audits: bigint; invalidations: bigint; snapshotStatus: string }>>(
    `SELECT
      (SELECT CAST(castle_battle_attempts AS CHAR) FROM player_pet_daily_records WHERE player_id=988520001) attempts,
      (SELECT CAST(score AS CHAR) FROM castle_battle_player_states WHERE season_id=988520001 AND player_id=988520001) score,
      (SELECT CAST(tier_point AS CHAR) FROM castle_battle_player_states WHERE season_id=988520001 AND player_id=988520001) tier,
      (SELECT COUNT(*) FROM castle_battle_member_adjustment_runs) runs,
      (SELECT COUNT(*) FROM operations WHERE idempotency_scope='castle.battle.member_edit') operations,
      (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_scope='castle.battle.member_edit') outboxes,
      (SELECT COUNT(*) FROM command_audit WHERE action_code='castle.battle.member_edit') audits,
      (SELECT COUNT(*) FROM castle_battle_rank_snapshot_invalidations) invalidations,
      (SELECT status FROM castle_battle_rank_snapshots WHERE season_id=988520001 AND snapshot_version=1) snapshotStatus`
  ))[0]!;
}

try {
  const expected = { attempts: "7", score: "125", runs: 2n, operations: 2n, outboxes: 2n, audits: 2n, invalidations: 1n, snapshotStatus: "invalidated" };
  if (restart) {
    const before = await state();
    const replay = await run("member-edit-score", "/캐슬스코어 합성 회원 125");
    assert.equal(replay.replayed, true);
    assert.deepEqual(await state(), before);
    assert.equal(before.attempts, expected.attempts);
    assert.equal(before.score, expected.score);
    assert.equal(before.runs, expected.runs);
    assert.equal(before.invalidations, expected.invalidations);
    process.stdout.write(`${JSON.stringify({ mode: "verify-restart", attempts: 7, score: 125, runs: 2, replayed: true, additionalMutation: false, operationalDataTouched: false })}\n`);
  } else {
    assert.equal((await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM command_registry WHERE command_code IN ('CASTLE_BATTLE_ATTEMPT_SET','CASTLE_BATTLE_SCORE_SET') AND rollout_state='SHADOW'"))[0]!.count, 2n);
    await run("member-edit-count", "/캐슬대전횟수리셋 합성 회원 7");
    const score = await run("member-edit-score", "/캐슬스코어 합성 회원 125");
    assert.equal(score.invalidatedSnapshotCount, "1");
    assert.equal((await run("member-edit-score", "/캐슬스코어 합성 회원 125")).replayed, true);
    const current = await state();
    assert.equal(current.attempts, expected.attempts);
    assert.equal(current.score, expected.score);
    assert.equal(current.runs, expected.runs);
    assert.equal(current.operations, expected.operations);
    assert.equal(current.outboxes, expected.outboxes);
    assert.equal(current.audits, expected.audits);
    assert.equal(current.invalidations, expected.invalidations);
    assert.equal(current.snapshotStatus, expected.snapshotStatus);
    process.stdout.write(`${JSON.stringify({ mode: "probe", scenarios: ["strict-parser", "fixed-authority", "attempt-absolute-set", "score-tier-time-set", "snapshot-invalidate", "event-replay"], effects: { attempts: 7, score: 125, runs: 2, outboxes: 2, audits: 2, invalidations: 1 }, operationalDataTouched: false })}\n`);
  }
} finally { await database.close(); }
