import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { ApplicationError } from "../src/shared/application-error.js";
import { isPetRenameTicketCraftCommand, PetRenameTicketCraftService } from "../src/pet/pet-rename-ticket-craft-service.js";

// 변경권 조합 Service가 실행한 SQL과 순서를 기록하는 테스트 DB를 만듭니다.
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

const owner = { identity_id: 11n, player_id: 21n, current_display_name: "합성회원 남", tier_code: "seedling" };
const items = [
  { item_id: 31n, code: "legacy-junk-item", quantity: 20n, version: 2n },
  { item_id: 32n, code: "legacy-pet-name-change-ticket", quantity: 2n, version: 3n }
];

describe("pet rename ticket craft policy", () => {
  it("accepts only the exact command", () => {
    assert.equal(isPetRenameTicketCraftCommand("/펫이름조합"), true);
    for (const message of ["/펫이름조합 ", "/펫이름조합 1", "/펫이름조합방법"]) {
      assert.equal(isPetRenameTicketCraftCommand(message), false);
    }
  });
});

describe("pet rename ticket craft service", () => {
  it("spends junk and point and grants a ticket with both ledgers atomically", async () => {
    const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [], items, [{ balance: "200000000.000", version: 4n }]]);
    const result = await new PetRenameTicketCraftService(scripted.database).handle({
      externalUserId: "kakao-11", channelId: "room-1", message: "/펫이름조합", eventId: "event-ticket-craft"
    });
    assert.equal(result.status, "crafted");
    assert.deepEqual({ junk: result.junkQuantity, point: result.pointBalance, ticket: result.ticketQuantity },
      { junk: "10", point: "100000000", ticket: "3" });
    assert.equal(result.data, "행복주민센터에서 [🌱합성회원 남] 님께\n펫 이름변경권🎫을 주었습니다.\n사용법: /펫이름 [변경할이름(6자)]");
    for (const fragment of [
      "UPDATE inventory_stacks", "UPDATE currency_accounts", "INSERT INTO inventory_ledger",
      "INSERT INTO currency_ledger", "INSERT INTO command_executions", "INSERT INTO command_audit",
      "INSERT INTO outbox_messages", "UPDATE operations SET status = 'completed'"
    ]) assert.ok(scripted.sql.some((statement) => statement.includes(fragment)), fragment);
  });

  it("reports junk shortage before querying point", async () => {
    const insufficientItems = [
      { item_id: 31n, code: "legacy-junk-item", quantity: 9n, version: 2n },
      items[1]
    ];
    const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [], insufficientItems]);
    await assert.rejects(
      () => new PetRenameTicketCraftService(scripted.database).handle({
        externalUserId: "kakao-11", channelId: "room-1", message: "/펫이름조합", eventId: "event-junk-short"
      }),
      (error: unknown) => error instanceof ApplicationError && error.code === "JUNK_ITEM_REQUIRED"
    );
    assert.equal(scripted.sql.some((statement) => statement.includes("currency_accounts")), false);
  });

  it("does not mutate when point is insufficient", async () => {
    const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [], items, [{ balance: "99999999.000", version: 4n }]]);
    await assert.rejects(
      () => new PetRenameTicketCraftService(scripted.database).handle({
        externalUserId: "kakao-11", channelId: "room-1", message: "/펫이름조합", eventId: "event-point-short"
      }),
      (error: unknown) => error instanceof ApplicationError && error.code === "POINT_REQUIRED"
    );
    assert.equal(scripted.sql.some((statement) => statement.includes("UPDATE inventory_stacks")), false);
  });
});
