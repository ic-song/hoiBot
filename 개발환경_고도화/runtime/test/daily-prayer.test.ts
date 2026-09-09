import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import {
  DailyPrayerService,
  dailyPrayerPeriodKey,
  formatDailyPrayerReply,
  isDailyPrayerCommand
} from "../src/player/daily-prayer-service.js";

// 일일 기도 SQL 순서와 원자 mutation을 기록하는 테스트 DB를 만듭니다.
function scriptedDatabase(queryResults: unknown[]) {
  const remaining = [...queryResults];
  const sql: string[] = [];
  let insertId = 1000n;
  const transaction: DatabaseTransaction = {
    query: async <T>(statement: string): Promise<T> => { sql.push(statement); return remaining.shift() as T; },
    execute: async (statement: string): Promise<DatabaseWriteResult> => {
      sql.push(statement); insertId += 1n; return { affectedRows: 1n, insertId };
    }
  };
  const database: DatabaseClient = {
    ping: async () => undefined, verifyRollback: async () => true,
    query: async <T>(): Promise<T> => remaining.shift() as T,
    execute: async () => ({ affectedRows: 1n, insertId: 0n }),
    withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(transaction),
    close: async () => undefined
  };
  return { database, sql };
}

describe("daily prayer command boundary", () => {
  it("accepts exact command only and creates a KST period key", () => {
    assert.equal(isDailyPrayerCommand("/기도"), true);
    for (const message of ["/기도 1", "/기도 해줘", "기도", "/기도\n"]) assert.equal(isDailyPrayerCommand(message), false);
    assert.equal(dailyPrayerPeriodKey(new Date("2026-08-24T15:00:00.000Z")), "2026-08-25");
  });
});

describe("daily prayer transactional provider", () => {
  it("records the 3 percent reward, counter, RNG, inventory ledger, audit, execution and outbox", async () => {
    const scripted = scriptedDatabase([[], [{ equipped: 1 }], [], [{ id: 48n }], [{ quantity: 2n, version: 3n }]]);
    const result = await new DailyPrayerService(scripted.database, {
      random: () => 0.029999999,
      now: () => new Date("2026-08-25T01:00:00.000Z")
    }).execute({ playerId: "21", channelId: "room-1", eventId: "iris:prayer-1" });
    assert.equal(result.status, "completed");
    if (result.status !== "completed") return;
    assert.equal(result.rewarded, true);
    assert.equal(result.quantity, "3");
    assert.equal(result.data, formatDailyPrayerReply(true));
    for (const fragment of ["INSERT INTO player_counters", "INSERT INTO rng_events", "UPDATE inventory_stacks", "INSERT INTO inventory_ledger", "INSERT INTO command_audit", "INSERT INTO command_executions", "INSERT INTO outbox_messages"]) {
      assert.ok(scripted.sql.some((statement) => statement.includes(fragment)), fragment);
    }
  });

  it("treats the exact 0.03 boundary as no reward without touching inventory", async () => {
    const scripted = scriptedDatabase([[], [{ equipped: 1 }], []]);
    const result = await new DailyPrayerService(scripted.database, {
      random: () => 0.03,
      now: () => new Date("2026-08-25T01:00:00.000Z")
    }).execute({ playerId: "21", channelId: "room-1", eventId: "iris:prayer-boundary" });
    assert.equal(result.status, "completed");
    if (result.status !== "completed") return;
    assert.equal(result.rewarded, false);
    assert.equal(result.quantity, undefined);
    assert.equal(scripted.sql.some((statement) => statement.includes("inventory_ledger")), false);
  });

  it("keeps missing skill and already-used guards silent and mutation-free", async () => {
    const missingSkill = scriptedDatabase([[], []]);
    assert.deepEqual(await new DailyPrayerService(missingSkill.database).execute({
      playerId: "21", channelId: "room-1", eventId: "iris:prayer-no-skill"
    }), { status: "ignored", reasonCode: "PRAYER_SKILL_REQUIRED" });
    assert.equal(missingSkill.sql.some((statement) => statement.includes("INSERT INTO operations")), false);

    const alreadyUsed = scriptedDatabase([[], [{ equipped: 1 }], [{ value: 1n }]]);
    assert.deepEqual(await new DailyPrayerService(alreadyUsed.database).execute({
      playerId: "21", channelId: "room-1", eventId: "iris:prayer-used"
    }), { status: "ignored", reasonCode: "ALREADY_USED" });
    assert.equal(alreadyUsed.sql.some((statement) => statement.includes("INSERT INTO operations")), false);
  });
});
