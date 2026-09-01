import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { CommonDailyResetProvider } from "../src/admin/common-daily-reset-provider.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("common daily reset provider MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  let playerId: bigint;
  const periodKey = "2026-09-01";
  const suffix = Date.now().toString();

  before(async () => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 4, connectTimeoutMs: 5_000 });
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    playerId = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!.id;
    await database.execute("INSERT INTO player_counters(player_id,counter_code,period_key,value) VALUES (?,'cntlike',?,3)", [playerId, periodKey]);
    await database.execute("INSERT INTO player_pet_daily_records(player_id,record_date,tower_attempts,mini_battle_attempts,explore_attempts,daily_quest_rewarded,pet_home_comment_count) VALUES (?,?,2,1,4,TRUE,3)", [playerId, periodKey]);
    await database.execute("INSERT INTO attendance_programs(code,display_name,reset_policy_code) VALUES (?,?,?)", [`daily-reset-${suffix}`, "합성 출석", "daily"]);
    const programId = (await database.query<Array<{ id: bigint }>>("SELECT id FROM attendance_programs WHERE code=?", [`daily-reset-${suffix}`]))[0]!.id;
    await database.execute("INSERT INTO player_attendance(player_id,program_id,period_key,attendance_count,last_attended_at,light_enabled) VALUES (?,?,?,1,UTC_TIMESTAMP(3),TRUE)", [playerId, programId, periodKey]);
    await database.execute("UPDATE pet_explore_scheduler_state SET active=TRUE,immediate_run_pending=TRUE,next_run_at=UTC_TIMESTAMP(3),lease_owner='synthetic',lease_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 HOUR) WHERE schedule_code='pet_explore'");
  });

  after(async () => { if (database) await database.close(); });

  it("resets canonical projections atomically, replays by event and keeps preview mutation-free", async () => {
    const provider = new CommonDailyResetProvider(database);
    const preview = await provider.preview(periodKey);
    assert.equal(preview.totalAffected >= 4, true);
    const eventId = `daily-reset-${suffix}`;
    const result = await provider.reset({ eventId, operatorId: playerId.toString(), periodKey });
    assert.equal(result.replayed, false);
    assert.equal(result.steps.length, 5);
    const replay = await provider.reset({ eventId, operatorId: playerId.toString(), periodKey });
    assert.equal(replay.replayed, true);
    const secondEvent = await provider.reset({ eventId: `${eventId}-other`, operatorId: playerId.toString(), periodKey });
    assert.equal(secondEvent.replayed, true);
    const counter = (await database.query<Array<{ value: bigint }>>("SELECT value FROM player_counters WHERE player_id=? AND counter_code='cntlike' AND period_key=?", [playerId, periodKey]))[0]!;
    assert.equal(Number(counter.value), 0);
    const daily = (await database.query<Array<{ tower_attempts: bigint; daily_quest_rewarded: number }>>("SELECT tower_attempts,daily_quest_rewarded FROM player_pet_daily_records WHERE player_id=? AND record_date=?", [playerId, periodKey]))[0]!;
    assert.deepEqual([Number(daily.tower_attempts), Number(daily.daily_quest_rewarded)], [0, 0]);
    const steps = (await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM daily_reset_steps WHERE run_id=?", [result.runId]))[0]!;
    assert.equal(Number(steps.count), 5);
    const operation = (await database.query<Array<{ status: string }>>("SELECT status FROM operations WHERE id=?", [result.operationId]))[0]!;
    assert.equal(operation.status, "completed");
    const outbox = (await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM outbox_messages WHERE operation_id=? AND provider_code='internal'", [result.operationId]))[0]!;
    assert.equal(Number(outbox.count), 1);
    const afterPreview = await provider.preview(periodKey);
    assert.equal(afterPreview.totalAffected, 0);
  });
});
