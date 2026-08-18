import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { GenesisTicketCraftService, isGenesisTicketCraftCommand } from "../src/mini-pet/genesis-ticket-craft-service.js";
import { ApplicationError } from "../src/shared/application-error.js";

// 창세 미니펫 티켓 조합 SQL 순서와 mutation 유무를 기록하는 테스트 DB를 만듭니다.
function createScriptedDatabase(queryResults: unknown[]) {
  const remaining = [...queryResults];
  const sql: string[] = [];
  let insertId = 1000n;
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

const owner = { identity_id: 11n, player_id: 21n, current_display_name: "합성회원 남", tier_code: "seedling" };
const ticket = { item_id: 52n, quantity: 12000n, version: 3n };
const successMessage = "🐹 /미니펫창세조합 완료!\n\n미니펫뽑기🐹(/미니펫오픈) 10000개 소모\n🎁 지급: [컬렉션창세 미니펫🐹] (창세 / 매력+1💕)\n\n👉 /미니펫가방 으로 확인해주세요.";

describe("genesis ticket craft policy", () => {
  it("accepts the exact no-argument command only", () => {
    assert.equal(isGenesisTicketCraftCommand("/미니펫창세조합"), true);
    for (const message of ["/미니펫창세조합 ", "/미니펫창세조합 1", "/미니펫창세조합 안내", "/미니펫창세조합추가"]) {
      assert.equal(isGenesisTicketCraftCommand(message), false);
    }
  });
});

describe("genesis ticket craft service", () => {
  it("keeps the legacy silent block during an active castle siege", async () => {
    const scripted = createScriptedDatabase([[{ active_count: 1n }]]);
    const result = await new GenesisTicketCraftService(scripted.database).handle({
      externalUserId: "kakao-11", channelId: "room-1", message: "/미니펫창세조합", eventId: "event-siege"
    });
    assert.deepEqual(result, { status: "blocked_by_castle_siege" });
    assert.equal(scripted.sql.some((statement) => statement.startsWith("UPDATE ") || statement.startsWith("INSERT ")), false);
  });

  it("keeps the legacy silent return for an unregistered sender", async () => {
    const scripted = createScriptedDatabase([[{ active_count: 0n }], []]);
    const result = await new GenesisTicketCraftService(scripted.database).handle({
      externalUserId: "unknown", channelId: "room-1", message: "/미니펫창세조합", eventId: "event-unknown"
    });
    assert.deepEqual(result, { status: "ignored_missing_member" });
    assert.equal(scripted.sql.some((statement) => statement.startsWith("UPDATE ") || statement.startsWith("INSERT ")), false);
  });

  it("blocks a full mini-pet bag before reading or spending tickets", async () => {
    const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [], [{ bag_count: 8n }]]);
    await assert.rejects(
      () => new GenesisTicketCraftService(scripted.database).handle({
        externalUserId: "kakao-11", channelId: "room-1", message: "/미니펫창세조합", eventId: "event-full"
      }),
      (error: unknown) => error instanceof ApplicationError && error.code === "MINI_PET_BAG_FULL"
        && error.message === "[🌱합성회원 남] 님의\n미니펫 가방이 가득 찼습니다.\n조합을 진행할 수 없습니다.\n[최대 8개 소지가능]"
    );
    assert.equal(scripted.sql.some((statement) => statement.includes("inventory_stacks")), false);
  });

  it("uses the executed 10000 ticket cost and preserves the shortage reply", async () => {
    const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [], [{ bag_count: 0n }], [{ ...ticket, quantity: 9999n }]]);
    await assert.rejects(
      () => new GenesisTicketCraftService(scripted.database).handle({
        externalUserId: "kakao-11", channelId: "room-1", message: "/미니펫창세조합", eventId: "event-short"
      }),
      (error: unknown) => error instanceof ApplicationError && error.code === "MINI_PET_TICKET_REQUIRED"
        && error.message === "❌ [🌱합성회원 남] 님\n미니펫뽑기🐹(/미니펫오픈) 10000개가 필요해.\n(보유: 9999개)"
    );
    assert.equal(scripted.sql.some((statement) => statement.startsWith("UPDATE ") || statement.startsWith("INSERT ")), false);
  });

  it("spends 10000 tickets and grants one genesis mini pet atomically", async () => {
    const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [], [{ bag_count: 0n }], [ticket], [{ id: 61n }]]);
    const result = await new GenesisTicketCraftService(scripted.database).handle({
      externalUserId: "kakao-11", channelId: "room-1", message: "/미니펫창세조합", eventId: "event-craft"
    });
    assert.deepEqual(
      { status: result.status, ticket: result.ticketQuantity, data: result.data },
      { status: "crafted", ticket: "2000", data: successMessage }
    );
    for (const fragment of [
      "UPDATE inventory_stacks", "INSERT INTO owned_mini_pets", "INSERT INTO inventory_ledger",
      "INSERT INTO command_executions", "INSERT INTO command_audit", "INSERT INTO outbox_messages"
    ]) assert.ok(scripted.sql.some((statement) => statement.includes(fragment)), fragment);
  });

  it("returns the stored result on a repeated event without mutation", async () => {
    const storedResult = { status: "crafted" as const, playerId: "21", ticketQuantity: "2000" };
    const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [{ result_json: JSON.stringify(storedResult) }]]);
    const result = await new GenesisTicketCraftService(scripted.database).handle({
      externalUserId: "kakao-11", channelId: "room-1", message: "/미니펫창세조합", eventId: "event-repeat"
    });
    assert.deepEqual(result, storedResult);
    assert.equal(scripted.sql.some((statement) => statement.startsWith("UPDATE ") || statement.startsWith("INSERT ")), false);
  });
});
