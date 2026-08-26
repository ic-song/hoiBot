import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { isTrialTowerSyncCommand, TrialTowerSyncService, type TrialTowerSyncResult } from "../src/trial/trial-tower-sync-service.js";

// 시련의 탑 동기화 SQL 순서와 멱등 결과를 기록하는 합성 DB를 만듭니다.
function scriptedDatabase(queryResults: unknown[]) {
  const remaining = [...queryResults], sql: string[] = [];
  let insertId = 100n;
  const transaction: DatabaseTransaction = {
    query: async <T>(statement: string): Promise<T> => {
      sql.push(statement);
      if (remaining.length === 0) throw new Error(`Unexpected query: ${statement}`);
      return remaining.shift() as T;
    },
    execute: async (statement: string): Promise<DatabaseWriteResult> => {
      sql.push(statement); insertId += 1n; return { affectedRows: 1n, insertId };
    },
  };
  const database: DatabaseClient = {
    ping: async () => undefined, verifyRollback: async () => true,
    query: async () => { throw new Error("Unexpected non-transactional query."); },
    execute: async () => { throw new Error("Unexpected non-transactional execute."); },
    withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(transaction),
    close: async () => undefined,
  };
  return { database, sql };
}

describe("trial tower sync command boundary", () => {
  it("accepts only the exact legacy command", () => {
    assert.equal(isTrialTowerSyncCommand("/시련의탑동기화"), true);
    assert.equal(isTrialTowerSyncCommand("/시련의탑동기화 해봐"), false);
    assert.equal(isTrialTowerSyncCommand("/시련의탑동기화1"), false);
  });

  it("snapshots and deletes orphan progress before queuing the exact legacy reply", async () => {
    const scripted = scriptedDatabase([[], [{ season_key: "current", player_id: 41n, member_key: "탈퇴 회원", floor: 77n, last_win_at: null, version: 2n }]]);
    const result = await new TrialTowerSyncService(scripted.database).sync({
      idempotencyKey: "trial-sync-event", sourceEventId: "trial-sync-event", destinationId: "room", operatorId: "7",
    });
    assert.equal(result.removedCount, 1);
    assert.deepEqual(result.removedMemberKeys, ["탈퇴 회원"]);
    assert.equal((result.data.match(/\u200b/g) ?? []).length, 500);
    assert.equal(result.data, `시련의탑동기화데이터 동기화완료 (1)${"\u200b".repeat(500)}탈퇴 회원`);
    const snapshotIndex = scripted.sql.findIndex((statement) => statement.includes("INSERT INTO trial_tower_sync_removals"));
    const deleteIndex = scripted.sql.findIndex((statement) => statement.includes("DELETE FROM trial_tower_progress"));
    assert.ok(snapshotIndex >= 0 && deleteIndex > snapshotIndex);
    for (const ledger of ["operations", "command_executions", "command_audit", "outbox_messages"])
      assert.ok(scripted.sql.some((statement) => statement.includes(ledger)), ledger);
  });

  it("returns the stored result without deleting progress again", async () => {
    const stored: TrialTowerSyncResult = { status: "synced", removedCount: 0, removedMemberKeys: [], data: `시련의탑동기화데이터 동기화완료 (0)${"\u200b".repeat(500)}`, outboxId: "11", auditId: "12" };
    const scripted = scriptedDatabase([[{ result_json: JSON.stringify(stored) }]]);
    const result = await new TrialTowerSyncService(scripted.database).sync({ idempotencyKey: "replay", sourceEventId: "replay", destinationId: "room", operatorId: "7" });
    assert.deepEqual(result, stored);
    assert.equal(scripted.sql.some((statement) => statement.includes("DELETE FROM")), false);
  });
});
