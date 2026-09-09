import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { isPetDataSyncCommand, PetDataSyncService, type PetDataSyncResult } from "../src/admin/pet-data-sync-service.js";

// 펫 동기화 Service의 SQL 순서와 멱등 결과를 기록하는 합성 DB를 만듭니다.
function scriptedDatabase(queryResults: unknown[]) {
  const remaining = [...queryResults];
  const sql: string[] = [];
  let insertId = 100n;
  const transaction: DatabaseTransaction = {
    query: async <T>(statement: string): Promise<T> => {
      sql.push(statement);
      if (remaining.length === 0) throw new Error(`Unexpected query: ${statement}`);
      return remaining.shift() as T;
    },
    execute: async (statement: string): Promise<DatabaseWriteResult> => {
      sql.push(statement);
      insertId += 1n;
      return { affectedRows: 1n, insertId };
    },
  };
  const database: DatabaseClient = {
    ping: async () => undefined,
    verifyRollback: async () => true,
    query: async () => { throw new Error("Unexpected non-transactional query."); },
    execute: async () => { throw new Error("Unexpected non-transactional execute."); },
    withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(transaction),
    close: async () => undefined,
  };
  return { database, sql };
}

describe("pet data sync command boundary", () => {
  it("accepts only the exact legacy command", () => {
    assert.equal(isPetDataSyncCommand("/펫데이터동기화"), true);
    assert.equal(isPetDataSyncCommand("/펫데이터동기화 해봐"), false);
    assert.equal(isPetDataSyncCommand("/펫데이터동기화1"), false);
  });

  it("deletes every orphan pet relation and queues the folded legacy reply", async () => {
    const scripted = scriptedDatabase([
      [],
      [{ pet_id: 31n, player_id: 41n, member_key: "탈퇴 회원" }],
    ]);
    const result = await new PetDataSyncService(scripted.database).sync({
      idempotencyKey: "pet-sync-event", sourceEventId: "pet-sync-event",
      destinationId: "room-pet-sync", operatorId: "7",
    });
    assert.equal(result.removedCount, 1);
    assert.deepEqual(result.removedMemberKeys, ["탈퇴 회원"]);
    assert.equal((result.data.match(/\u200b/g) ?? []).length, 500);
    assert.equal(result.data.endsWith("탈퇴 회원"), true);
    for (const table of [
      "pet_titles", "pet_skills", "pet_equipment", "player_pet_elementals", "pet_skill_inventory",
      "player_pet_pendants", "player_pet_intimacy", "pet_expedition_runs", "player_pets",
    ]) assert.ok(scripted.sql.some((statement) => statement.includes(`DELETE FROM ${table}`)), table);
    for (const ledger of ["operations", "command_executions", "command_audit", "outbox_messages"])
      assert.ok(scripted.sql.some((statement) => statement.includes(ledger)), ledger);
  });

  it("returns the stored result without running deletion again", async () => {
    const stored: PetDataSyncResult = {
      status: "synced", removedCount: 0, removedMemberKeys: [], data: `펫데이터 동기화완료 (0)${"\u200b".repeat(500)}`,
      outboxId: "11", auditId: "12",
    };
    const scripted = scriptedDatabase([[{ result_json: JSON.stringify(stored) }]]);
    const result = await new PetDataSyncService(scripted.database).sync({
      idempotencyKey: "replay", sourceEventId: "replay", destinationId: "room", operatorId: "7",
    });
    assert.deepEqual(result, stored);
    assert.equal(scripted.sql.some((statement) => statement.includes("DELETE FROM")), false);
  });
});
