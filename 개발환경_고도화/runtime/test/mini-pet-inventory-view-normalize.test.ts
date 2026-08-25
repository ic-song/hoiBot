import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { ApplicationError } from "../src/shared/application-error.js";
import {
  isMiniPetInventoryViewCommand,
  MiniPetInventoryViewNormalizeService
} from "../src/mini-pet/inventory-view-normalize-service.js";

function scriptedDatabase(queryResults: unknown[]) {
  const remaining = [...queryResults];
  const sql: string[] = [];
  let transactions = 0;
  let insertId = 3000n;
  const query = async <T>(statement: string): Promise<T> => {
    sql.push(statement);
    if (remaining.length === 0) throw new Error(`Unexpected query: ${statement}`);
    return remaining.shift() as T;
  };
  const tx: DatabaseTransaction = {
    query,
    execute: async (statement: string): Promise<DatabaseWriteResult> => {
      sql.push(statement);
      insertId += 1n;
      return { affectedRows: 1n, insertId };
    }
  };
  const database: DatabaseClient = {
    ping: async () => undefined,
    verifyRollback: async () => true,
    query,
    execute: async () => { throw new Error("Unexpected execute outside transaction."); },
    withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => {
      transactions += 1;
      return work(tx);
    },
    close: async () => undefined
  };
  return { database, sql, transactionCount: () => transactions };
}

const command = {
  externalUserId: "kakao-minipet",
  channelId: "room-minipet",
  message: "/미니펫가방",
  eventId: "event-minipet",
  environmentCode: "dev" as const
};
const owner = { identity_id: 10n, player_id: 20n, current_display_name: "합성회원" };
const low = {
  owned_mini_pet_id: 101n, player_id: 20n, mini_pet_definition_id: 201n,
  definition_code: "mini-low", display_name: "낮은펫", custom_name: null,
  grade_display_name: "희귀", grade_code: "rare", emoji_value: "L",
  battle_experience: 10n, equipped: 0, state_player_id: 20n,
  stable_owned_id: "00000000-0000-4000-8000-000000000101",
  yakitori_stable_owned_id: null, sort_index: 1
};
const high = {
  ...low,
  owned_mini_pet_id: 102n, mini_pet_definition_id: 202n,
  definition_code: "mini-high", display_name: "높은펫", emoji_value: "H",
  battle_experience: 20n,
  stable_owned_id: "00000000-0000-4000-8000-000000000102",
  sort_index: 2
};

describe("mini-pet inventory view normalize", () => {
  it("accepts only the exact bag command", () => {
    assert.equal(isMiniPetInventoryViewCommand("/미니펫가방"), true);
    assert.equal(isMiniPetInventoryViewCommand("/미니펫가방 1"), false);
    assert.equal(isMiniPetInventoryViewCommand("/미니펫가방 보여줘"), false);
  });

  it("keeps an already normalized read completely mutation-free", async () => {
    const scripted = scriptedDatabase([
      [], [{ environment_code: "dev" }], [owner], [{ bag_shape_code: "array" }],
      [{ ...high, sort_index: 1 }, { ...low, sort_index: 2 }]
    ]);
    const result = await new MiniPetInventoryViewNormalizeService(scripted.database).handle(command);
    assert.equal(result.status, "read");
    assert.deepEqual(result.items?.map((item) => item.ownedMiniPetId), ["102", "101"]);
    assert.equal(scripted.transactionCount(), 0);
    assert.equal(scripted.sql.some((statement) => /INSERT|UPDATE|DELETE/.test(statement)), false);
  });

  it("repairs shape and a swapped unique sort order in one transaction", async () => {
    const before = [{ ...low, sort_index: 1 }, { ...high, sort_index: 2 }];
    const scripted = scriptedDatabase([
      [], [{ environment_code: "dev" }], [owner], [{ bag_shape_code: "missing" }], before,
      [{ environment_code: "dev" }], [owner], [{ bag_shape_code: "missing" }], before, []
    ]);
    const result = await new MiniPetInventoryViewNormalizeService(scripted.database).handle(command);
    assert.equal(result.status, "repaired");
    assert.deepEqual(result.items?.map((item) => [item.ownedMiniPetId, item.sortIndex]), [["102", 1], ["101", 2]]);
    assert.equal(scripted.transactionCount(), 1);
    const neutralize = scripted.sql.findIndex((statement) => statement.includes("SET sort_index = NULL"));
    const assign = scripted.sql.findIndex((statement) => statement.includes("INSERT INTO mini_pet_inventory_owned_states"));
    assert.ok(neutralize >= 0 && assign > neutralize);
    assert.equal(scripted.sql.filter((statement) => statement.includes("INSERT INTO mini_pet_inventory_repair_entries")).length, 2);
  });

  it("rejects a changed request for a completed event", async () => {
    const scripted = scriptedDatabase([[
      { id: 1n, status: "completed", result_json: { status: "repaired" }, request_hash: "different", stale_processing: 0 }
    ]]);
    await assert.rejects(
      () => new MiniPetInventoryViewNormalizeService(scripted.database).handle(command),
      (error: unknown) => error instanceof ApplicationError && error.code === "MINI_PET_INVENTORY_REPLAY_MISMATCH"
    );
  });

  it("rejects an environment mismatch before owner or inventory access", async () => {
    const scripted = scriptedDatabase([[], [{ environment_code: "prod" }]]);
    await assert.rejects(
      () => new MiniPetInventoryViewNormalizeService(scripted.database).handle(command),
      (error: unknown) => error instanceof ApplicationError && error.code === "MINI_PET_INVENTORY_ENVIRONMENT_MISMATCH"
    );
    assert.equal(scripted.sql.length, 2);
  });

  it("ignores an unlinked member without creating an operation", async () => {
    const scripted = scriptedDatabase([[], [{ environment_code: "dev" }], []]);
    const result = await new MiniPetInventoryViewNormalizeService(scripted.database).handle(command);
    assert.deepEqual(result, { status: "ignored_missing_member" });
    assert.equal(scripted.transactionCount(), 0);
  });

  it("refuses more than one hundred owned rows without repair", async () => {
    const rows = Array.from({ length: 101 }, (_, index) => ({
      ...low,
      owned_mini_pet_id: BigInt(1000 + index),
      stable_owned_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      sort_index: index + 1
    }));
    const scripted = scriptedDatabase([[], [{ environment_code: "dev" }], [owner], [{ bag_shape_code: "array" }], rows]);
    await assert.rejects(
      () => new MiniPetInventoryViewNormalizeService(scripted.database).handle(command),
      (error: unknown) => error instanceof ApplicationError && error.code === "MINI_PET_INVENTORY_CAPACITY_EXCEEDED"
    );
    assert.equal(scripted.transactionCount(), 0);
  });
});
