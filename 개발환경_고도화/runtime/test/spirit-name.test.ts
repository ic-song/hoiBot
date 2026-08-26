import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { ApplicationError } from "../src/shared/application-error.js";
import { isSpiritNameCommandCandidate, parseSpiritNameCommand, SpiritNameService } from "../src/pet/spirit-name-service.js";

// 정령 이름 변경 Service가 실행한 SQL 순서를 기록하는 테스트 DB를 만듭니다.
function createScriptedDatabase(queryResults: unknown[]) {
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

describe("spirit name policy", () => {
  it("preserves the legacy prefix and 0-10 character free-form name boundary", () => {
    assert.equal(isSpiritNameCommandCandidate("/정령이름 새 이름"), true);
    assert.equal(isSpiritNameCommandCandidate("/정령이름"), false);
    assert.equal(parseSpiritNameCommand("/정령이름 새 이름"), "새 이름");
    assert.equal(parseSpiritNameCommand("/정령이름 "), "");
    assert.equal(parseSpiritNameCommand("/정령이름 12345678901"), null);
  });
});

describe("spirit name service", () => {
  it("renames the spirit and consumes one ticket atomically", async () => {
    const scripted = createScriptedDatabase([
      [{ active_count: 0n }],
      [{ identity_id: 11n, player_id: 21n, current_display_name: "사용자", rank_emoji: "⭐" }],
      [],
      [{ player_pet_id: 31n, display_name: "이전정령", version: 3n }],
      [{ item_id: 41n, quantity: 2n, version: 5n }]
    ]);
    const result = await new SpiritNameService(scripted.database).handle({
      externalUserId: "kakao-11", channelId: "room-1", message: "/정령이름 새 정령", eventId: "event-spirit-name"
    });

    assert.equal(result.status, "renamed");
    assert.equal(result.spiritName, "새 정령");
    assert.equal(result.ticketQuantity, "1");
    assert.equal(result.data, "정령이름 변경이 완료되었습니다.");
    for (const fragment of [
      "UPDATE player_pet_elementals", "UPDATE inventory_stacks", "INSERT INTO inventory_ledger",
      "INSERT INTO command_executions", "INSERT INTO command_audit", "INSERT INTO outbox_messages",
      "UPDATE operations SET status = 'completed'"
    ]) assert.ok(scripted.sql.some((statement) => statement.includes(fragment)), fragment);
  });

  it("keeps the legacy silent block during an active castle siege", async () => {
    const scripted = createScriptedDatabase([[{ active_count: 1n }]]);
    const result = await new SpiritNameService(scripted.database).handle({
      externalUserId: "kakao-12", channelId: "room-2", message: "/정령이름 새정령", eventId: "event-siege"
    });
    assert.deepEqual(result, { status: "blocked_by_castle_siege" });
    assert.equal(scripted.sql.length, 1);
  });

  it("does not mutate when the spirit is missing", async () => {
    const scripted = createScriptedDatabase([
      [{ active_count: 0n }],
      [{ identity_id: 13n, player_id: 23n, current_display_name: "사용자", rank_emoji: null }],
      [],
      []
    ]);
    await assert.rejects(
      () => new SpiritNameService(scripted.database).handle({
        externalUserId: "kakao-13", channelId: "room-3", message: "/정령이름 새정령", eventId: "event-no-spirit"
      }),
      (error: unknown) => error instanceof ApplicationError && error.code === "SPIRIT_NOT_FOUND"
    );
    assert.equal(scripted.sql.some((statement) => statement.includes("UPDATE player_pet_elementals")), false);
  });
});
