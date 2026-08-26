import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { isPetTitleSyncCommand, PetTitleSyncService, type PetTitleSyncResult } from "../src/admin/pet-title-sync-service.js";

// 펫 타이틀 동기화 Service의 SQL 순서와 멱등 결과를 기록하는 합성 DB를 만듭니다.
function scriptedDatabase(queryResults: unknown[]) {
  const remaining = [...queryResults];
  const sql: string[] = [];
  let insertId = 200n;
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

describe("pet title sync command boundary", () => {
  it("accepts only the exact legacy command", () => {
    assert.equal(isPetTitleSyncCommand("/펫타이틀동기화"), true);
    assert.equal(isPetTitleSyncCommand("/펫타이틀동기화 해봐"), false);
    assert.equal(isPetTitleSyncCommand("/펫타이틀동기화1"), false);
  });

  it("deletes only orphan pet titles and queues the folded legacy reply", async () => {
    const scripted = scriptedDatabase([
      [],
      [{ pet_id: 31n, player_id: 41n, member_key: "탈퇴 회원", title_count: 2n }],
    ]);
    const result = await new PetTitleSyncService(scripted.database).sync({
      idempotencyKey: "pet-title-sync-event", sourceEventId: "pet-title-sync-event",
      destinationId: "room-pet-title-sync", operatorId: "7",
    });
    assert.equal(result.removedCount, 1);
    assert.equal(result.removedTitleCount, 2);
    assert.deepEqual(result.removedMemberKeys, ["탈퇴 회원"]);
    assert.equal((result.data.match(/\u200b/g) ?? []).length, 500);
    assert.equal(result.data.endsWith("탈퇴 회원"), true);
    assert.ok(scripted.sql.some((statement) => statement.includes("DELETE FROM pet_titles")));
    assert.equal(scripted.sql.some((statement) => statement.includes("DELETE FROM player_pets")), false);
    for (const ledger of ["operations", "command_executions", "command_audit", "outbox_messages"])
      assert.ok(scripted.sql.some((statement) => statement.includes(ledger)), ledger);
  });

  it("returns the stored result without running deletion again", async () => {
    const stored: PetTitleSyncResult = {
      status: "synced", removedCount: 0, removedTitleCount: 0, removedMemberKeys: [],
      data: `펫타이틀데이터 동기화완료 (0)${"\u200b".repeat(500)}`, outboxId: "11", auditId: "12",
    };
    const scripted = scriptedDatabase([[{ result_json: JSON.stringify(stored) }]]);
    const result = await new PetTitleSyncService(scripted.database).sync({
      idempotencyKey: "replay", sourceEventId: "replay", destinationId: "room", operatorId: "7",
    });
    assert.deepEqual(result, stored);
    assert.equal(scripted.sql.some((statement) => statement.includes("DELETE FROM")), false);
  });
});

