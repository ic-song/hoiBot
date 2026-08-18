import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import {
  CollectionGenesisOpenService,
  isCollectionGenesisOpenCommand
} from "../src/mini-pet/collection-genesis-open-service.js";
import { ApplicationError } from "../src/shared/application-error.js";

// 컬렉션 창세 오픈 SQL 순서와 mutation 유무를 기록하는 테스트 DB를 만듭니다.
function createScriptedDatabase(queryResults: unknown[]) {
  const remaining = [...queryResults];
  const sql: string[] = [];
  let insertId = 900n;
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
const items = [
  { item_id: 51n, code: "bag_b2fd551a03f6fe6e", quantity: 1n, version: 2n },
  { item_id: 52n, code: "bag_3241894752b82f7a", quantity: 10n, version: 3n }
];
const successMessage = "🐹 컬렉션창세패키지 오픈 완료!\n\n🎁 지급: [컬렉션창세 미니펫🐹] (창세 / 매력+1💕)\n🎟️ 추가지급: 미니펫뽑기🐹(/미니펫오픈) 1500개\n\n👉 /미니펫가방 으로 확인해주세요.";

describe("collection genesis open policy", () => {
  it("accepts the exact no-argument command only", () => {
    assert.equal(isCollectionGenesisOpenCommand("/컬렉션창세오픈"), true);
    for (const message of ["/컬렉션창세오픈 ", "/컬렉션창세오픈 1", "/컬렉션창세오픈 안내", "/컬렉션창세오픈추가"]) {
      assert.equal(isCollectionGenesisOpenCommand(message), false);
    }
  });
});

describe("collection genesis open service", () => {
  it("keeps the legacy silent block during an active castle siege", async () => {
    const scripted = createScriptedDatabase([[{ active_count: 1n }]]);
    const result = await new CollectionGenesisOpenService(scripted.database).handle({
      externalUserId: "kakao-11", channelId: "room-1", message: "/컬렉션창세오픈", eventId: "event-siege"
    });
    assert.deepEqual(result, { status: "blocked_by_castle_siege" });
    assert.equal(scripted.sql.some((statement) => statement.startsWith("UPDATE ") || statement.startsWith("INSERT ")), false);
  });

  it("keeps the legacy silent return for an unregistered sender", async () => {
    const scripted = createScriptedDatabase([[{ active_count: 0n }], []]);
    const result = await new CollectionGenesisOpenService(scripted.database).handle({
      externalUserId: "unknown", channelId: "room-1", message: "/컬렉션창세오픈", eventId: "event-unknown"
    });
    assert.deepEqual(result, { status: "ignored_missing_member" });
    assert.equal(scripted.sql.some((statement) => statement.startsWith("UPDATE ") || statement.startsWith("INSERT ")), false);
  });

  it("blocks a full mini-pet bag before reading or mutating inventory", async () => {
    const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [], [{ bag_count: 8n }]]);
    await assert.rejects(
      () => new CollectionGenesisOpenService(scripted.database).handle({
        externalUserId: "kakao-11", channelId: "room-1", message: "/컬렉션창세오픈", eventId: "event-full"
      }),
      (error: unknown) => error instanceof ApplicationError && error.code === "MINI_PET_BAG_FULL"
        && error.message === "[🌱합성회원 남] 님의\n미니펫 가방이 가득 찼습니다.\n오픈을 진행할 수 없습니다.\n[최대 8개 소지가능]"
    );
    assert.equal(scripted.sql.some((statement) => statement.includes("inventory_stacks")), false);
  });

  it("reports the legacy package shortage without mutation", async () => {
    const shortItems = [{ ...items[0], quantity: 0n }, items[1]];
    const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [], [{ bag_count: 0n }], shortItems]);
    await assert.rejects(
      () => new CollectionGenesisOpenService(scripted.database).handle({
        externalUserId: "kakao-11", channelId: "room-1", message: "/컬렉션창세오픈", eventId: "event-short"
      }),
      (error: unknown) => error instanceof ApplicationError && error.code === "COLLECTION_GENESIS_PACKAGE_REQUIRED"
        && error.message === "❌ [🌱합성회원 남] 님\n[컬렉션창세패키지🐹(/컬렉션창세오픈)] 아이템이 없습니다.\n(보유: 0개)"
    );
    assert.equal(scripted.sql.some((statement) => statement.startsWith("UPDATE ") || statement.startsWith("INSERT ")), false);
  });

  it("consumes the package and grants ticket and mini pet atomically", async () => {
    const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [], [{ bag_count: 0n }], items, [{ id: 61n }]]);
    const result = await new CollectionGenesisOpenService(scripted.database).handle({
      externalUserId: "kakao-11", channelId: "room-1", message: "/컬렉션창세오픈", eventId: "event-open"
    });
    assert.deepEqual(
      { status: result.status, package: result.packageQuantity, ticket: result.ticketQuantity, data: result.data },
      { status: "opened", package: "0", ticket: "1510", data: successMessage }
    );
    for (const fragment of [
      "UPDATE inventory_stacks", "INSERT INTO owned_mini_pets", "INSERT INTO inventory_ledger",
      "INSERT INTO command_executions", "INSERT INTO command_audit", "INSERT INTO outbox_messages"
    ]) assert.ok(scripted.sql.some((statement) => statement.includes(fragment)), fragment);
  });

  it("creates a missing ticket stack on first reward", async () => {
    const missingTicketStack = [items[0], { ...items[1], quantity: null, version: null }];
    const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [], [{ bag_count: 0n }], missingTicketStack, [{ id: 61n }]]);
    const result = await new CollectionGenesisOpenService(scripted.database).handle({
      externalUserId: "kakao-11", channelId: "room-1", message: "/컬렉션창세오픈", eventId: "event-first-ticket"
    });
    assert.equal(result.ticketQuantity, "1500");
    assert.ok(scripted.sql.some((statement) => statement.includes("INSERT INTO inventory_stacks")));
  });

  it("returns the stored result on a repeated event without mutation", async () => {
    const storedResult = { status: "opened" as const, playerId: "21", packageQuantity: "0", ticketQuantity: "1500" };
    const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [{ result_json: JSON.stringify(storedResult) }]]);
    const result = await new CollectionGenesisOpenService(scripted.database).handle({
      externalUserId: "kakao-11", channelId: "room-1", message: "/컬렉션창세오픈", eventId: "event-repeat"
    });
    assert.deepEqual(result, storedResult);
    assert.equal(scripted.sql.some((statement) => statement.startsWith("UPDATE ") || statement.startsWith("INSERT ")), false);
  });
});
