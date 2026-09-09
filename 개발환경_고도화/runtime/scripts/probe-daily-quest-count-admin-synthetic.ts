import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { DailyQuestCountAdminService, parseDailyQuestCountAdminCommand } from "../src/admin/daily-quest-count-admin-service.js";

const config = loadConfig();
if (!config.database.enabled || config.database.name !== "hoibot_daily_quest_count_admin_g7") throw new Error(`Blocked database: ${config.database.name}`);
const base = process.env.DAILY_QUEST_COUNT_ADMIN_EVENT_ID ?? "daily-quest-count-admin-fixed";
const restart = process.argv.includes("--verify-restart");
const database = createDatabaseClient(config.database);
const service = new DailyQuestCountAdminService(database);
const success = `${base}-success`;

async function event(id: string): Promise<void> {
  await database.execute(
    "INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,'synthetic-daily-quest-room','daily-quest-master','message','incoming',REPEAT('9',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)",
    [id, id]
  );
}

async function update(id: string, message: string) {
  return service.update({
    command: parseDailyQuestCountAdminCommand(message),
    idempotencyKey: id,
    sourceEventId: id,
    destinationId: "synthetic-daily-quest-room",
    operatorId: "998500001"
  });
}

function failAudit(inner: DatabaseClient): DatabaseClient {
  return {
    ping: () => inner.ping(), query: (sql, params) => inner.query(sql, params), execute: (sql, params) => inner.execute(sql, params),
    verifyRollback: () => inner.verifyRollback(), close: async () => undefined,
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => inner.withTransaction((transaction) => work({
      query: (sql, params) => transaction.query(sql, params),
      execute: async (sql, params) => {
        if (sql.includes("INSERT INTO command_audit")) throw new Error("synthetic daily quest count audit failure");
        return transaction.execute(sql, params);
      }
    }))
  };
}

async function snapshot() {
  return (await database.query<Array<{
    operations: bigint; outboxes: bigint; audits: bigint; mutations: bigint; tower: string; castle: string; mini: string;
    explore: string; rewarded: number; freeUsed: string; rewardCount: string; version: string;
  }>>(`
    SELECT
      (SELECT COUNT(*) FROM operations WHERE idempotency_scope='admin.daily_quest_count.update') operations,
      (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_scope='admin.daily_quest_count.update') outboxes,
      (SELECT COUNT(*) FROM command_audit WHERE action_code='admin.daily_quest_count.update') audits,
      (SELECT COUNT(*) FROM admin_daily_quest_count_mutations) mutations,
      (SELECT CAST(tower_attempts AS CHAR) FROM player_pet_daily_records WHERE player_id=988500001 AND record_date=DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR))) tower,
      (SELECT CAST(castle_battle_attempts AS CHAR) FROM player_pet_daily_records WHERE player_id=988500001 AND record_date=DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR))) castle,
      (SELECT CAST(mini_battle_attempts AS CHAR) FROM player_pet_daily_records WHERE player_id=988500001 AND record_date=DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR))) mini,
      (SELECT CAST(explore_attempts AS CHAR) FROM player_pet_daily_records WHERE player_id=988500001 AND record_date=DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR))) explore,
      (SELECT daily_quest_rewarded FROM player_pet_daily_records WHERE player_id=988500001 AND record_date=DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR))) rewarded,
      (SELECT CAST(value AS CHAR) FROM player_counters WHERE player_id=988500001 AND counter_code='castle_battle_free_used' AND period_key=DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR),'%Y-%m-%d')) freeUsed,
      (SELECT CAST(value AS CHAR) FROM player_counters WHERE player_id=988500001 AND counter_code='daily_quest_reward_count' AND period_key=DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR),'%Y-%m-%d')) rewardCount,
      (SELECT CAST(version AS CHAR) FROM player_pet_daily_records WHERE player_id=988500001 AND record_date=DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR))) version`))[0]!;
}

try {
  const expected = {
    operations: 3n, outboxes: 3n, audits: 3n, mutations: 3n, tower: "3", castle: "2", mini: "4", explore: "7",
    rewarded: 1, freeUsed: "1", rewardCount: "6", version: "3"
  };
  if (restart) {
    const before = await snapshot();
    await update(success, "/일퀘횟수수정 합성 회원 3 2 4 5 6");
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(before, expected);
    process.stdout.write(`${JSON.stringify({ mode: "verify-restart", operations: 3, explore: 7, rewardCount: 6, additionalMutation: false, operationalDataTouched: false })}\n`);
  } else {
    await database.execute("INSERT INTO players(id,status) VALUES (988500001,'active')");
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (988500001,'합성 회원')");
    assert.equal((await database.query<Array<{ rollout_state: string }>>("SELECT rollout_state FROM command_registry WHERE command_code='ADMIN_DAILY_QUEST_COUNT_UPDATE'"))[0]!.rollout_state, "SHADOW");
    await event(success);
    const first = await update(success, "/일퀘횟수수정 합성 회원 3 2 4 5 6");
    assert.equal(first.changed, true);
    assert.deepEqual(await update(success, "/일퀘횟수수정 합성 회원 3 2 4 5 6"), first);
    const preserve = `${base}-preserve`;
    await event(preserve);
    const preserved = await update(preserve, "/일퀘횟수수정 합성 회원 3 2 4 7");
    assert.equal(preserved.after.dailyRewardCount, "6");
    assert.equal(preserved.after.dailyQuestRewarded, true);
    const unchanged = `${base}-unchanged`;
    await event(unchanged);
    assert.equal((await update(unchanged, "/일퀘횟수수정 합성 회원 3 2 4 7")).changed, false);
    await assert.rejects(() => update(`${base}-missing`, "/일퀘횟수수정 없는 회원 1 2 3 4"), /존재하지 않는 유저/);
    const rollback = `${base}-rollback`;
    await event(rollback);
    const rollbackService = new DailyQuestCountAdminService(failAudit(database));
    await assert.rejects(() => rollbackService.update({
      command: parseDailyQuestCountAdminCommand("/일퀘횟수수정 합성 회원 9 8 7 6 0"), idempotencyKey: rollback,
      sourceEventId: rollback, destinationId: "synthetic-daily-quest-room", operatorId: "998500001"
    }), /synthetic daily quest count audit failure/);
    assert.deepEqual(await snapshot(), expected);
    assert.equal(await database.verifyRollback(), true);
    process.stdout.write(`${JSON.stringify({ mode: "probe", scenarios: ["shadow-registry", "six-field-update", "optional-preserve", "unchanged", "missing-target", "replay", "rollback"], effects: { operations: 3, outboxes: 3, audits: 3, mutations: 3, tower: 3, castle: 2, mini: 4, explore: 7, rewardCount: 6 }, operationalDataTouched: false })}\n`);
  }
} finally {
  await database.close();
}
