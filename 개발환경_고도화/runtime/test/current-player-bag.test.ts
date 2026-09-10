import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { CurrentPlayerBagService } from "../src/inventory/current-player-bag-service.js";
import { MariaBagRepository } from "../src/inventory/maria-bag-repository.js";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { ApplicationError } from "../src/shared/application-error.js";
import type { BagView } from "../src/inventory/bag.js";

interface ScriptedDatabase {
  database: DatabaseClient;
  sql: string[];
}

// current-player repository의 SELECT 응답과 호출 SQL을 기록합니다.
function scriptedDatabase(active = true, items: readonly object[] = []): ScriptedDatabase {
  const sql: string[] = [];
  const failWrite = async (): Promise<DatabaseWriteResult> => {
    throw new Error("DML_NOT_ALLOWED");
  };
  const query = async <T>(statement: string): Promise<T> => {
    sql.push(statement);
    if (statement.includes("FROM players player")) {
      return (active ? [{ player_id: 18_446_744_073_709_551_615n, display_name: "현재유저" }] : []) as T;
    }
    if (statement.includes("FROM inventory_stacks stack")) return [...items] as T;
    if (statement.includes("FROM configuration_sets config")) return [{ string_value: "합성 광고" }] as T;
    throw new Error(`UNEXPECTED_SQL: ${statement}`);
  };
  return {
    sql,
    database: {
      ping: async () => undefined,
      verifyRollback: async () => true,
      query,
      execute: failWrite,
      withTransaction: async <T>(_work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> => {
        throw new Error("TRANSACTION_NOT_ALLOWED");
      },
      close: async () => undefined
    }
  };
}

const UNSORTED_ITEMS = [
  { display_name: "ABC", quantity: 2n, legacy_bag_order: null },
  { display_name: "양념치킨🐔", quantity: 12n, legacy_bag_order: "21" },
  { display_name: "합성 물약", quantity: 3n, legacy_bag_order: null },
  { display_name: "잡템☠️", quantity: 18_446_744_073_709_551_615n, legacy_bag_order: "20" },
  { display_name: "펫 친밀도🐾 [Lv.2](3/1000)+4💕", quantity: 1n, legacy_bag_order: null }
] as const;

describe("current-player bag read provider", () => {
  it("uses the authenticated current player, keeps 64-bit quantity strings, and pages after legacy ordering", async () => {
    const scripted = scriptedDatabase(true, UNSORTED_ITEMS);
    const service = new CurrentPlayerBagService(new MariaBagRepository(scripted.database));
    const response = await service.execute({
      currentPlayerId: "18446744073709551615",
      limit: 2,
      offset: 1
    });

    assert.deepEqual(response, {
      ownerLabel: "현재유저",
      advertisement: "합성 광고",
      items: [
        { displayName: "잡템☠️", quantity: "18446744073709551615" },
        { displayName: "양념치킨🐔", quantity: "12" }
      ],
      pagination: { limit: 2, offset: 1, total: 5, hasMore: true }
    });
    assert.equal(JSON.stringify(response).includes("playerId"), false);
    assert.equal(scripted.sql.every((statement) => /^\s*SELECT\b/i.test(statement)), true);
    assert.match(scripted.sql[0]!, /player\.status = 'active'/);
    assert.match(scripted.sql[0]!, /player\.deleted_at IS NULL/);
  });

  it("returns an empty page for an active player with an empty bag", async () => {
    const scripted = scriptedDatabase(true, []);
    const response = await new CurrentPlayerBagService(new MariaBagRepository(scripted.database))
      .execute({ currentPlayerId: "18446744073709551615", limit: 100, offset: 0 });
    assert.deepEqual(response.items, []);
    assert.deepEqual(response.pagination, { limit: 100, offset: 0, total: 0, hasMore: false });
  });

  it("fails closed for an inactive or missing current player before inventory reads", async () => {
    const scripted = scriptedDatabase(false, UNSORTED_ITEMS);
    await assert.rejects(
      () => new CurrentPlayerBagService(new MariaBagRepository(scripted.database))
        .execute({ currentPlayerId: "18446744073709551615" }),
      (value: unknown) => value instanceof ApplicationError
        && value.code === "CURRENT_PLAYER_NOT_AVAILABLE"
        && value.statusCode === 404
    );
    assert.equal(scripted.sql.length, 1);
    assert.equal(scripted.sql[0]!.includes("inventory_stacks"), false);
  });

  it("accepts only limit 1..100 and a non-negative integer offset", async () => {
    const repository = { findCurrentPlayerBag: async (): Promise<BagView> => ({
      playerId: "1", ownerLabel: "현재유저", advertisement: "", items: []
    }) };
    const service = new CurrentPlayerBagService(repository);
    for (const input of [
      { currentPlayerId: "1", limit: 0 },
      { currentPlayerId: "1", limit: 101 },
      { currentPlayerId: "1", limit: 1.5 },
      { currentPlayerId: "1", offset: -1 },
      { currentPlayerId: "1", offset: 0.5 },
      { currentPlayerId: "1", offset: Number.MAX_SAFE_INTEGER + 1 }
    ]) {
      await assert.rejects(
        () => service.execute(input),
        (value: unknown) => value instanceof ApplicationError && value.code === "BAG_PAGINATION_INVALID"
      );
    }
    await service.execute({ currentPlayerId: "1", limit: 1, offset: 0 });
    await service.execute({ currentPlayerId: "1", limit: 100, offset: 0 });
  });

  it("rejects invalid current-player context without querying the repository", async () => {
    let calls = 0;
    const service = new CurrentPlayerBagService({
      findCurrentPlayerBag: async (): Promise<BagView | null> => {
        calls += 1;
        return null;
      }
    });
    for (const currentPlayerId of ["", "0", "-1", "9007199254740993x", "18446744073709551616"]) {
      await assert.rejects(
        () => service.execute({ currentPlayerId }),
        (value: unknown) => value instanceof ApplicationError && value.code === "CURRENT_PLAYER_CONTEXT_INVALID"
      );
    }
    assert.equal(calls, 0);
  });

  it("contains no SQL DML in the provider implementation", async () => {
    const directory = fileURLToPath(new URL("../src/inventory/", import.meta.url));
    const sources = await Promise.all([
      readFile(`${directory}current-player-bag-service.ts`, "utf8"),
      readFile(`${directory}maria-bag-repository.ts`, "utf8")
    ]);
    assert.equal(sources.some((source) => /\b(?:INSERT|UPDATE|DELETE|REPLACE|MERGE)\b/i.test(source)), false);
  });
});
