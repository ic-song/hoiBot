import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { RaidStrikeSealCraftService, isRaidStrikeSealCraftCommand } from "../src/raid/raid-strike-seal-craft-service.js";
import { ApplicationError } from "../src/shared/application-error.js";
import { createRequestReuseEnvelope } from "../src/shared/request-reuse-contract.js";

// 레이드 인장 조합 SQL 순서와 mutation 유무를 기록하는 테스트 DB를 만듭니다.
function createScriptedDatabase(queryResults: unknown[], failOn?: string) {
  const remaining = [...queryResults];
  const sql: string[] = [];
  let rolledBack = false;
  let insertId = 500n;
  const transaction: DatabaseTransaction = {
    query: async <T>(statement: string): Promise<T> => {
      sql.push(statement);
      if (remaining.length === 0) throw new Error(`Unexpected query: ${statement}`);
      return remaining.shift() as T;
    },
    execute: async (statement: string): Promise<DatabaseWriteResult> => {
      sql.push(statement);
      if (failOn !== undefined && statement.includes(failOn)) throw new Error("synthetic transaction failure");
      insertId += 1n;
      return { affectedRows: 1n, insertId };
    }
  };
  const database: DatabaseClient = {
    ping: async () => undefined,
    verifyRollback: async () => true,
    query: async () => { throw new Error("Unexpected non-transactional query."); },
    execute: async () => { throw new Error("Unexpected non-transactional execute."); },
    withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => {
      try { return await work(transaction); }
      catch (error) { rolledBack = true; throw error; }
    },
    close: async () => undefined
  };
  return { database, sql, wasRolledBack: () => rolledBack };
}

const owner = { identity_id: 11n, player_id: 21n, canonical_player_id: "p0000021", current_display_name: "합성회원 남", tier_code: "seedling" };
const items = [
  { item_id: 51n, code: "legacy-junk-item", quantity: 2000n, version: 2n }
];
const sealDefinition = {
  item_id: "i0000043", definition_options: JSON.stringify({ name: "레이드타격대인장👑(+600👾)", exp: 600 }),
  source_identifier: "064bcb1971ffce549b2d5f00810b58d3bcc0bec937d89b5bb232f40037c9f8bf",
  payload_fingerprint: "77cb001679d3e915622e91a872848c4c53b388479d4c88ca68760361e18c6ee9"
};
const successfulQueries = () => [[{ active_count: 0n }], [owner], [], [sealDefinition], items,
  [{ balance: "3000000000.000", version: 4n }], [], []];

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
    const scripted = createScriptedDatabase(successfulQueries());
    const result = await new RaidStrikeSealCraftService(scripted.database).handle({
      externalUserId: "kakao-11", channelId: "room-1", message: "/레이드인장조합 2", eventId: "event-raid-seal"
    });
    assert.deepEqual(
      { count: result.craftQuantity, junk: result.junkQuantity, point: result.pointBalance, seal: result.sealQuantity },
      { count: "2", junk: "0", point: "1000000000", seal: "2" }
    );
    assert.equal(result.data, "[🌱합성회원 남] 님\n레이드타격대인장👑(+600👾) 2개 조합 완료!\n(레이드매력+/펫공격에 적용됩니다.)");
    for (const fragment of ["canonical_item_definition_imports", "object_identity_crosswalks", "UPDATE canonical_owned_item_stacks",
      "INSERT INTO canonical_item_inventory_ledger_entries", "UPDATE inventory_stacks", "UPDATE currency_accounts", "INSERT INTO inventory_ledger",
      "INSERT INTO currency_ledger", "INSERT INTO command_executions", "INSERT INTO command_audit", "INSERT INTO outbox_messages"]) {
      assert.ok(scripted.sql.some((statement) => statement.includes(fragment)), fragment);
    }
    assert.equal(scripted.sql.some((statement) => statement.includes("legacy-raid-strike-seal-600")), false);
  });

  it("normalizes legacy zero quantity to one craft", async () => {
    const scripted = createScriptedDatabase(successfulQueries());
    const result = await new RaidStrikeSealCraftService(scripted.database).handle({
      externalUserId: "kakao-11", channelId: "room-1", message: "/레이드인장조합 0", eventId: "event-zero"
    });
    assert.equal(result.craftQuantity, "1");
    assert.equal(result.junkQuantity, "1000");
  });

  it("reports junk shortage before querying point", async () => {
    const shortItems = [{ ...items[0], quantity: 1999n }];
    const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [], [sealDefinition], shortItems]);
    await assert.rejects(
      () => new RaidStrikeSealCraftService(scripted.database).handle({
        externalUserId: "kakao-11", channelId: "room-1", message: "/레이드인장조합 2", eventId: "event-junk-short"
      }),
      (error: unknown) => error instanceof ApplicationError && error.code === "JUNK_ITEM_REQUIRED"
    );
    assert.equal(scripted.sql.some((statement) => statement.includes("currency_accounts")), false);
  });

  it("formats point shortage and does not mutate", async () => {
    const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [], [sealDefinition], items, [{ balance: "1999999999.000", version: 4n }]]);
    await assert.rejects(
      () => new RaidStrikeSealCraftService(scripted.database).handle({
        externalUserId: "kakao-11", channelId: "room-1", message: "/레이드인장조합 2", eventId: "event-point-short"
      }),
      (error: unknown) => error instanceof ApplicationError && error.code === "POINT_REQUIRED"
        && error.message === "🅟2,000,000,000 포인트가 필요합니다!"
    );
    assert.equal(scripted.sql.some((statement) => statement.includes("UPDATE inventory_stacks")), false);
  });

  it("replays a terminal result after service restart without another inventory effect", async () => {
    const requestReuse = createRequestReuseEnvelope({
      scope: "raid.strike-seal.craft:11", requestKey: "event-raid-seal", sourceEventId: "event-raid-seal",
      actor: { actorType: "external_identity", actorId: "11", playerId: "p0000021" },
      operationKind: "RAID_STRIKE_SEAL_CRAFT", targetType: "ITEM_SOURCE_LOCATOR",
      targetId: "064bcb1971ffce549b2d5f00810b58d3bcc0bec937d89b5bb232f40037c9f8bf",
      payload: { channelId: "room-1", message: "/레이드인장조합 2", craftQuantity: "2" }
    });
    const terminal = { status: "crafted" as const, playerId: "21", craftQuantity: "2", junkQuantity: "0",
      pointBalance: "1000000000", sealQuantity: "2", outboxId: "9", data: "same", auditId: "10", requestReuse };
    const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [{ result_json: JSON.stringify(terminal) }]]);
    const result = await new RaidStrikeSealCraftService(scripted.database).handle({
      externalUserId: "kakao-11", channelId: "room-1", message: "/레이드인장조합 2", eventId: "event-raid-seal"
    });
    assert.deepEqual(result, terminal);
    assert.equal(scripted.sql.some((statement) => /canonical_owned_item_stacks|UPDATE inventory_stacks/.test(statement)), false);
  });

  it("fails closed when the same event changes quantity or channel", async () => {
    const requestReuse = createRequestReuseEnvelope({
      scope: "raid.strike-seal.craft:11", requestKey: "event-conflict", sourceEventId: "event-conflict",
      actor: { actorType: "external_identity", actorId: "11", playerId: "p0000021" },
      operationKind: "RAID_STRIKE_SEAL_CRAFT", targetType: "ITEM_SOURCE_LOCATOR",
      targetId: "064bcb1971ffce549b2d5f00810b58d3bcc0bec937d89b5bb232f40037c9f8bf",
      payload: { channelId: "room-1", message: "/레이드인장조합 1", craftQuantity: "1" }
    });
    const terminal = { status: "crafted" as const, requestReuse };
    for (const command of [
      { channelId: "room-1", message: "/레이드인장조합 2" },
      { channelId: "room-2", message: "/레이드인장조합 1" }
    ]) {
      const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [{ result_json: terminal }]]);
      await assert.rejects(() => new RaidStrikeSealCraftService(scripted.database).handle({
        externalUserId: "kakao-11", eventId: "event-conflict", ...command
      }), (error: unknown) => error instanceof ApplicationError && error.code === "RAID_STRIKE_SEAL_REQUEST_REUSE_CONFLICT");
      assert.equal(scripted.sql.some((statement) => /canonical_owned_item_stacks|UPDATE inventory_stacks/.test(statement)), false);
    }
  });

  it("fails closed before mutation when the exact payload or exp drifts", async () => {
    for (const drift of [
      { ...sealDefinition, payload_fingerprint: "0".repeat(64) },
      { ...sealDefinition, definition_options: JSON.stringify({ name: "레이드타격대인장👑(+600👾)", exp: 601 }) },
      { ...sealDefinition, definition_options: JSON.stringify({ name: "레이드타격대인장👑(+600👾)", exp: "600" }) }
    ]) {
      const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [], [drift]]);
      await assert.rejects(
        () => new RaidStrikeSealCraftService(scripted.database).handle({
          externalUserId: "kakao-11", channelId: "room-1", message: "/레이드인장조합", eventId: "event-drift"
        }),
        (error: unknown) => error instanceof ApplicationError
      );
      assert.equal(scripted.sql.some((statement) => statement.startsWith("UPDATE") || statement.startsWith("INSERT")), false);
    }
  });

  it("rolls back the shared transaction when the canonical inventory ledger fails", async () => {
    const scripted = createScriptedDatabase(successfulQueries(), "INSERT INTO canonical_item_inventory_ledger_entries");
    await assert.rejects(() => new RaidStrikeSealCraftService(scripted.database).handle({
      externalUserId: "kakao-11", channelId: "room-1", message: "/레이드인장조합 2", eventId: "event-rollback"
    }), /synthetic transaction failure/);
    assert.equal(scripted.wasRolledBack(), true);
    assert.equal(scripted.sql.some((statement) => statement.includes("INSERT INTO outbox_messages")), false);
    assert.equal(scripted.sql.some((statement) => statement.includes("UPDATE operations SET status = 'completed'")), false);
  });
});
