import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { ApplicationError } from "../src/shared/application-error.js";
import { isPetRenameCommandCandidate, parsePetRenameCommand, PetRenameService } from "../src/pet/pet-rename-service.js";

// 펫 이름 변경 Service가 실행한 SQL과 순서를 기록하는 테스트 DB를 만듭니다.
function createScriptedDatabase(queryResults: unknown[]) {
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
    }
  };
  const database: DatabaseClient = {
    ping: async () => undefined,
    verifyRollback: async () => true,
    query: async () => { throw new Error("Unexpected non-transactional query."); },
    execute: async () => { throw new Error("Unexpected non-transactional execute."); },
    withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(transaction),
    close: async () => undefined
  };
  return { database, sql };
}

describe("pet rename policy", () => {
  it("accepts only one whitespace-free 1-6 character argument", () => {
    assert.equal(isPetRenameCommandCandidate("/펫이름 봉봉"), true);
    assert.equal(parsePetRenameCommand("/펫이름 봉봉"), "봉봉");
    for (const message of ["/펫이름", "/펫이름 ", "/펫이름 봉봉 해봐", "/펫이름 일곱글자입니다"]) {
      assert.equal(parsePetRenameCommand(message), null);
    }
  });
});

describe("pet rename service", () => {
  it("renames the pet and consumes one ticket with ledger, audit and outbox atomically", async () => {
    const scripted = createScriptedDatabase([
      [{ active_count: 0n }],
      [{ identity_id: 11n, player_id: 21n }],
      [],
      [{ id: 31n, display_name: "이전이름", version: 3n }],
      [{ item_id: 41n, quantity: 2n, version: 5n }]
    ]);
    const result = await new PetRenameService(scripted.database).handle({
      externalUserId: "kakao-11", channelId: "room-1", message: "/펫이름 새이름", eventId: "event-pet-rename"
    });

    assert.equal(result.status, "renamed");
    assert.equal(result.petName, "새이름");
    assert.equal(result.ticketQuantity, "1");
    assert.equal(result.data, "펫이름 변경이 완료되었습니다.");
    for (const fragment of [
      "UPDATE player_pets", "UPDATE inventory_stacks", "INSERT INTO inventory_ledger",
      "INSERT INTO command_executions", "INSERT INTO command_audit", "INSERT INTO outbox_messages",
      "UPDATE operations SET status = 'completed'"
    ]) assert.ok(scripted.sql.some((statement) => statement.includes(fragment)), fragment);
  });

  it("does not mutate when the ticket is missing", async () => {
    const scripted = createScriptedDatabase([
      [{ active_count: 0n }],
      [{ identity_id: 12n, player_id: 22n }],
      [],
      [{ id: 32n, display_name: "기존펫", version: 1n }],
      []
    ]);
    await assert.rejects(
      () => new PetRenameService(scripted.database).handle({
        externalUserId: "kakao-12", channelId: "room-2", message: "/펫이름 새펫", eventId: "event-no-ticket"
      }),
      (error: unknown) => error instanceof ApplicationError && error.code === "PET_RENAME_TICKET_REQUIRED"
    );
    assert.equal(scripted.sql.some((statement) => statement.includes("UPDATE player_pets")), false);
  });

  it("keeps the legacy silent block while a castle siege is active", async () => {
    const scripted = createScriptedDatabase([[{ active_count: 1n }]]);
    const result = await new PetRenameService(scripted.database).handle({
      externalUserId: "kakao-13", channelId: "room-3", message: "/펫이름 새펫", eventId: "event-siege"
    });
    assert.deepEqual(result, { status: "blocked_by_castle_siege" });
    assert.equal(scripted.sql.length, 1);
  });
});
