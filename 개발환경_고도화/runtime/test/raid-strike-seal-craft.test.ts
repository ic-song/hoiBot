import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { RaidStrikeSealCraftService, isRaidStrikeSealCraftCommand } from "../src/raid/raid-strike-seal-craft-service.js";
import { ApplicationError } from "../src/shared/application-error.js";

// 레이드 인장 조합 SQL 순서와 mutation 유무를 기록하는 테스트 DB를 만듭니다.
function createScriptedDatabase(queryResults: unknown[]) {
  const remaining = [...queryResults];
  const sql: string[] = [];
  let insertId = 500n;
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
  { item_id: 51n, code: "legacy-junk-item", quantity: 2000n, version: 2n },
  { item_id: 52n, code: "legacy-raid-strike-seal-600", quantity: 0n, version: 3n }
];

describe("raid strike seal craft policy", () => {
  it("accepts omission or one numeric quantity only", () => {
    for (const message of ["/레이드인장조합", "/레이드인장조합 0", "/레이드인장조합 2"]) {
      assert.equal(isRaidStrikeSealCraftCommand(message), true);
    }
    for (const message of ["/레이드인장조합 ", "/레이드인장조합 -1", "/레이드인장조합 2 안내", "/레이드인장조합2"]) {
      assert.equal(isRaidStrikeSealCraftCommand(message), false);
    }
  });
});

describe("raid strike seal craft service", () => {
  it("spends junk and point and grants seals with both ledgers atomically", async () => {
    const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [], items, [{ balance: "3000000000.000", version: 4n }]]);
    const result = await new RaidStrikeSealCraftService(scripted.database).handle({
      externalUserId: "kakao-11", channelId: "room-1", message: "/레이드인장조합 2", eventId: "event-raid-seal"
    });
    assert.deepEqual(
      { count: result.craftQuantity, junk: result.junkQuantity, point: result.pointBalance, seal: result.sealQuantity },
      { count: "2", junk: "0", point: "1000000000", seal: "2" }
    );
    assert.equal(result.data, "[🌱합성회원 남] 님\n레이드타격대인장👑(+600👾) 2개 조합 완료!\n(레이드매력+/펫공격에 적용됩니다.)");
    for (const fragment of ["UPDATE inventory_stacks", "UPDATE currency_accounts", "INSERT INTO inventory_ledger",
      "INSERT INTO currency_ledger", "INSERT INTO command_executions", "INSERT INTO command_audit", "INSERT INTO outbox_messages"]) {
      assert.ok(scripted.sql.some((statement) => statement.includes(fragment)), fragment);
    }
  });

  it("normalizes legacy zero quantity to one craft", async () => {
    const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [], items, [{ balance: "3000000000.000", version: 4n }]]);
    const result = await new RaidStrikeSealCraftService(scripted.database).handle({
      externalUserId: "kakao-11", channelId: "room-1", message: "/레이드인장조합 0", eventId: "event-zero"
    });
    assert.equal(result.craftQuantity, "1");
    assert.equal(result.junkQuantity, "1000");
  });

  it("reports junk shortage before querying point", async () => {
    const shortItems = [{ ...items[0], quantity: 1999n }, items[1]];
    const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [], shortItems]);
    await assert.rejects(
      () => new RaidStrikeSealCraftService(scripted.database).handle({
        externalUserId: "kakao-11", channelId: "room-1", message: "/레이드인장조합 2", eventId: "event-junk-short"
      }),
      (error: unknown) => error instanceof ApplicationError && error.code === "JUNK_ITEM_REQUIRED"
    );
    assert.equal(scripted.sql.some((statement) => statement.includes("currency_accounts")), false);
  });

  it("formats point shortage and does not mutate", async () => {
    const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [], items, [{ balance: "1999999999.000", version: 4n }]]);
    await assert.rejects(
      () => new RaidStrikeSealCraftService(scripted.database).handle({
        externalUserId: "kakao-11", channelId: "room-1", message: "/레이드인장조합 2", eventId: "event-point-short"
      }),
      (error: unknown) => error instanceof ApplicationError && error.code === "POINT_REQUIRED"
        && error.message === "🅟2,000,000,000 포인트가 필요합니다!"
    );
    assert.equal(scripted.sql.some((statement) => statement.includes("UPDATE inventory_stacks")), false);
  });
});
