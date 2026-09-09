import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { isPetMemberCharacterCountCommand, PetMemberCharacterCountService, type PetMemberCharacterCountResult } from "../src/admin/pet-member-character-count-service.js";

// 펫 회원 글자 수 Service의 snapshot 조회와 응답 원장을 기록하는 합성 DB를 만듭니다.
function scriptedDatabase(queryResults: unknown[]) {
  const remaining = [...queryResults];
  const sql: string[] = [];
  let insertId = 300n;
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

describe("pet member character count command boundary", () => {
  it("accepts only the exact legacy command", () => {
    assert.equal(isPetMemberCharacterCountCommand("/펫멤버글자수"), true);
    assert.equal(isPetMemberCharacterCountCommand("/펫멤버글자수 해봐"), false);
    assert.equal(isPetMemberCharacterCountCommand("/펫멤버글자수1"), false);
  });

  it("queues the stored Rhino UTF-16 character count with legacy formatting", async () => {
    const scripted = scriptedDatabase([[], [{ utf16_character_count: 1234567n }]]);
    const result = await new PetMemberCharacterCountService(scripted.database).count({
      idempotencyKey: "count-event", sourceEventId: "count-event", destinationId: "room", identityId: "9",
    });
    assert.equal(result.data, "총 글자 수 : 1,234,567");
    assert.equal(result.characterCount, "1234567");
    assert.equal(scripted.sql.filter((statement) => statement.includes("INSERT INTO outbox_messages")).length, 1);
    assert.equal(scripted.sql.some((statement) => statement.includes("UPDATE player_") || statement.includes("DELETE ")), false);
  });

  it("records a no-reply result when the legacy snapshot is absent", async () => {
    const scripted = scriptedDatabase([[], []]);
    const result = await new PetMemberCharacterCountService(scripted.database).count({
      idempotencyKey: "missing", sourceEventId: "missing", destinationId: "room", identityId: "9",
    });
    assert.equal(result.status, "missing");
    assert.equal(result.data, null);
    assert.equal(scripted.sql.some((statement) => statement.includes("INSERT INTO outbox_messages")), false);
  });

  it("returns a stored result without a second snapshot read or outbox", async () => {
    const stored: PetMemberCharacterCountResult = {
      status: "counted", characterCount: "10", data: "총 글자 수 : 10", outboxId: "1", auditId: "2",
    };
    const scripted = scriptedDatabase([[{ result_json: JSON.stringify(stored) }]]);
    const result = await new PetMemberCharacterCountService(scripted.database).count({
      idempotencyKey: "replay", sourceEventId: "replay", destinationId: "room", identityId: "9",
    });
    assert.deepEqual(result, stored);
    assert.equal(scripted.sql.some((statement) => statement.includes("pet_member_storage_snapshots")), false);
  });
});
