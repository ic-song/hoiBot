import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { FurnitureBoutiqueBoxCraftService, isFurnitureBoutiqueBoxCraftCommand } from "../src/crafting/furniture-boutique-box-craft-service.js";
import { ApplicationError } from "../src/shared/application-error.js";

describe("furniture boutique box craft integration", () => {
  it("wires the exact command guard and service into the Iris dispatch", () => {
    const appSource = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
    assert.match(appSource, /isFurnitureBoutiqueBoxCraftCommand\(normalizedEvent\.message\)/);
    assert.match(appSource, /new FurnitureBoutiqueBoxCraftService\(database!\)\.handle/);
  });
});

// 부띠끄상자 조합 SQL 순서와 mutation 유무를 기록하는 테스트 DB를 만듭니다.
function createScriptedDatabase(queryResults: unknown[]) {
  const remaining = [...queryResults];
  const sql: string[] = [];
  let insertId = 800n;
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
  { item_id: 61n, code: "legacy-pet-home-interior-shop-ticket", quantity: 10000n, version: 2n },
  { item_id: 62n, code: "legacy-furniture-boutique-box", quantity: 1n, version: 3n }
];

describe("furniture boutique box craft policy", () => {
  it("accepts omission or one numeric quantity only", () => {
    for (const message of ["/부띠끄조합", "/부띠끄조합 0", "/부띠끄조합 2"]) assert.equal(isFurnitureBoutiqueBoxCraftCommand(message), true);
    for (const message of ["/부띠끄조합 ", "/부띠끄조합 -1", "/부띠끄조합 2 안내", "/부띠끄조합2"]) assert.equal(isFurnitureBoutiqueBoxCraftCommand(message), false);
  });
});

describe("furniture boutique box craft service", () => {
  it("keeps the legacy silent block during an active castle siege", async () => {
    const scripted = createScriptedDatabase([[{ active_count: 1n }]]);
    const result = await new FurnitureBoutiqueBoxCraftService(scripted.database).handle({
      externalUserId: "kakao-11", channelId: "room-1", message: "/부띠끄조합", eventId: "event-siege"
    });
    assert.deepEqual(result, { status: "blocked_by_castle_siege" });
    assert.equal(scripted.sql.some((statement) => statement.startsWith("UPDATE ") || statement.startsWith("INSERT ")), false);
  });

  it("spends shop tickets and grants boutique boxes with both ledgers atomically", async () => {
    const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [], items]);
    const result = await new FurnitureBoutiqueBoxCraftService(scripted.database).handle({
      externalUserId: "kakao-11", channelId: "room-1", message: "/부띠끄조합 2", eventId: "event-boutique"
    });
    assert.deepEqual(
      { count: result.craftQuantity, shop: result.shopTicketQuantity, box: result.boutiqueBoxQuantity },
      { count: "2", shop: "0", box: "3" }
    );
    assert.equal(result.data, "2개를 조합합니다\n[🌱합성회원 남] 님\n가구 부띠끄상자🧳(/부띠끄오픈) 2개 생성 완료! 🧳✨");
    for (const fragment of ["UPDATE inventory_stacks", "INSERT INTO inventory_ledger", "INSERT INTO command_executions", "INSERT INTO command_audit", "INSERT INTO outbox_messages"]) {
      assert.ok(scripted.sql.some((statement) => statement.includes(fragment)), fragment);
    }
  });

  it("preserves the legacy zero quantity success when the material exists", async () => {
    const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [], items]);
    const result = await new FurnitureBoutiqueBoxCraftService(scripted.database).handle({
      externalUserId: "kakao-11", channelId: "room-1", message: "/부띠끄조합 0", eventId: "event-zero"
    });
    assert.equal(result.craftQuantity, "0");
    assert.equal(result.shopTicketQuantity, "10000");
    assert.equal(result.boutiqueBoxQuantity, "1");
  });

  it("reports the exact required material quantity before mutation", async () => {
    const shortItems = [{ ...items[0], quantity: 9999n }, items[1]];
    const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [], shortItems]);
    await assert.rejects(
      () => new FurnitureBoutiqueBoxCraftService(scripted.database).handle({ externalUserId: "kakao-11", channelId: "room-1", message: "/부띠끄조합 2", eventId: "event-short" }),
      (error: unknown) => error instanceof ApplicationError && error.code === "PET_HOME_SHOP_TICKET_REQUIRED" && error.message === "펫스윗홈인테리어샵🖼️(/샵오픈) 10000개가 필요해요!"
    );
    assert.equal(scripted.sql.some((statement) => statement.startsWith("UPDATE ") || statement.startsWith("INSERT ")), false);
  });
});
