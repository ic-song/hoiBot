import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { isPetDataCompareCommand, PetDataCompareService, type PetDataCompareResult } from "../src/admin/pet-data-compare-service.js";

// 펫 비교 Service의 snapshot SQL과 두 outbox 순서를 기록하는 합성 DB를 만듭니다.
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

describe("pet data compare command boundary", () => {
  it("accepts only the exact legacy command", () => {
    assert.equal(isPetDataCompareCommand("/펫데이터비교"), true);
    assert.equal(isPetDataCompareCommand("/펫데이터비교 해봐"), false);
    assert.equal(isPetDataCompareCommand("/펫데이터비교1"), false);
  });

  it("reads both counts once and queues the two legacy replies", async () => {
    const scripted = scriptedDatabase([[], [{ member_count: 12n, pet_count: 10n }]]);
    const result = await new PetDataCompareService(scripted.database).compare({
      idempotencyKey: "compare-event", sourceEventId: "compare-event", destinationId: "room", operatorId: "9",
    });
    assert.equal(result.memberCount, 12);
    assert.equal(result.petCount, 10);
    assert.deepEqual(result.replies.map((reply) => reply.data), [
      "member.json 회원 수=> 12",
      "member_pet.json 회원 수 => 10",
    ]);
    assert.equal(scripted.sql.filter((statement) => statement.includes("INSERT INTO outbox_messages")).length, 2);
    assert.equal(scripted.sql.some((statement) => statement.includes("DELETE ") || statement.includes("UPDATE player_")), false);
  });

  it("returns a stored result without a second count or outbox", async () => {
    const stored: PetDataCompareResult = {
      status: "compared", memberCount: 1, petCount: 1,
      replies: [{ data: "member.json 회원 수=> 1", outboxId: "1" }, { data: "member_pet.json 회원 수 => 1", outboxId: "2" }],
      auditId: "3",
    };
    const scripted = scriptedDatabase([[{ result_json: JSON.stringify(stored) }]]);
    const result = await new PetDataCompareService(scripted.database).compare({
      idempotencyKey: "replay", sourceEventId: "replay", destinationId: "room", operatorId: "9",
    });
    assert.deepEqual(result, stored);
    assert.equal(scripted.sql.some((statement) => statement.includes("COUNT(*)")), false);
  });
});
