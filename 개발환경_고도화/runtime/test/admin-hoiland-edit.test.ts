import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isHoiLandEditCommandCandidate } from "../src/admin/iris-admin-command-service.js";
import { HoiLandEditService } from "../src/admin/hoiland-edit-service.js";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";

// 호이랜드 수정 SQL과 원자 변경을 기록하는 합성 DB를 만듭니다.
function scriptedDatabase(queryResults: unknown[]) {
  const remaining = [...queryResults];
  const sql: string[] = [];
  let insertId = 700n;
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

describe("admin hoiland edit command boundary", () => {
  it("accepts only a full target and nonnegative integer amount", () => {
    for (const message of ["/수정 합성 회원 0", "/수정 여러 단어 회원 250"]) assert.equal(isHoiLandEditCommandCandidate(message), true);
    for (const message of ["/수정", "/수정방법", "/수정 합성 회원 -1", "/수정 합성 회원 1.5", "/수정 합성 회원 2 안내"]) {
      assert.equal(isHoiLandEditCommandCandidate(message), false);
    }
  });

  it("updates every stable category entry and records replies once", async () => {
    const scripted = scriptedDatabase([[], [
      { id: 11n, category_key: "synthetic-a", version: 1n },
      { id: 12n, category_key: "synthetic-b", version: 4n }
    ]]);
    const result = await new HoiLandEditService(scripted.database).setAbsolute({
      playerId: "21", targetDisplayName: "합성 회원", amount: "250", idempotencyKey: "event-hoiland-1",
      operatorId: "7", sourceEventId: "event-hoiland-1", irisReplyDestinationId: "room-1"
    });
    assert.equal(result?.affectedCategoryCount, 2);
    assert.deepEqual(result?.categoryKeys, ["synthetic-a", "synthetic-b"]);
    assert.equal(result?.outboxIds.length, 2);
    assert.equal(result?.data, "[합성 회원] 가 변경되었습니다.");
    assert.equal(scripted.sql.filter((statement) => statement.includes("UPDATE hoiland_entries")).length, 2);
    for (const fragment of ["INSERT INTO operations", "INSERT INTO command_audit", "INSERT INTO command_executions", "INSERT INTO outbox_messages", "INSERT INTO hoiland_edit_mutations"]) {
      assert.ok(scripted.sql.some((statement) => statement.includes(fragment)), fragment);
    }
  });
});
