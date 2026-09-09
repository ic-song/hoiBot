import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { isPetTitleStoreResetCommand, PetTitleStoreResetService, type PetTitleStoreResetResult } from "../src/admin/pet-title-store-reset-service.js";

// 펫 타이틀 전역 초기화의 잠금·삭제·멱등 순서를 기록하는 합성 DB를 만듭니다.
function scriptedDatabase(queryResults: unknown[]) {
  const remaining = [...queryResults]; const sql: string[] = []; let insertId = 400n;
  const transaction: DatabaseTransaction = {
    query: async <T>(statement: string): Promise<T> => {
      sql.push(statement); if (remaining.length === 0) throw new Error(`Unexpected query: ${statement}`);
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

describe("pet title store reset command", () => {
  it("accepts only the exact destructive legacy command", () => {
    assert.equal(isPetTitleStoreResetCommand("/펫타이틀파일생성"), true);
    assert.equal(isPetTitleStoreResetCommand("/펫타이틀파일생성 해봐"), false);
    assert.equal(isPetTitleStoreResetCommand("/펫타이틀파일생성1"), false);
  });

  it("locks and clears both title stores before queuing the fixed reply", async () => {
    const scripted = scriptedDatabase([[], [{ id: 1n }, { id: 2n }], [{ player_pet_id: 3n, title_id: 4n }]]);
    const result = await new PetTitleStoreResetService(scripted.database).reset({
      idempotencyKey: "reset", sourceEventId: "reset", destinationId: "room", operatorId: "7",
    });
    assert.equal(result.removedInstanceCount, 2); assert.equal(result.removedAssignmentCount, 1);
    assert.equal(result.data, "✅ 펫 타이틀 데이터 파일이 성공적으로 생성되었습니다.");
    assert.ok(scripted.sql.some((statement) => statement === "DELETE FROM player_pet_title_instances"));
    assert.ok(scripted.sql.some((statement) => statement === "DELETE FROM pet_titles"));
    for (const ledger of ["operations", "command_executions", "command_audit", "outbox_messages"])
      assert.ok(scripted.sql.some((statement) => statement.includes(ledger)), ledger);
  });

  it("returns the stored result without clearing either store again", async () => {
    const stored: PetTitleStoreResetResult = {
      status: "reset", removedInstanceCount: 2, removedAssignmentCount: 1,
      data: "✅ 펫 타이틀 데이터 파일이 성공적으로 생성되었습니다.", outboxId: "3", auditId: "4",
    };
    const scripted = scriptedDatabase([[{ result_json: JSON.stringify(stored) }]]);
    assert.deepEqual(await new PetTitleStoreResetService(scripted.database).reset({
      idempotencyKey: "replay", sourceEventId: "replay", destinationId: "room", operatorId: "7",
    }), stored);
    assert.equal(scripted.sql.some((statement) => statement.startsWith("DELETE FROM")), false);
  });
});

