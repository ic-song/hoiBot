import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { handleFreeMarketHistoryCommand, MariaFreeMarketHistoryRepository } from "../src/market/free-market-history-service.js";

const enabled = process.env.FREE_MARKET_HISTORY_MARIADB_TEST === "true";
let database: DatabaseClient;
let operationId = "";

describe("free-market history MariaDB integration", { skip: !enabled }, () => {
  before(async () => {
    database = createDatabaseClient({
      enabled: true,
      host: process.env.DB_HOST ?? "127.0.0.1",
      port: Number(process.env.DB_PORT ?? "3308"),
      user: process.env.DB_USER ?? "hoibot_app",
      password: process.env.DB_PASSWORD ?? "",
      name: process.env.DB_NAME ?? "hoibot_rehearsal_free_market_history_20260825",
      connectionLimit: 2,
      connectTimeoutMs: 5_000
    });
    const operation = await database.execute(
      `INSERT INTO operations (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, result_json, completed_at)
       VALUES (UUID(), 'test.free_market_history', 'settlement-900000099', 'system', NULL, 'system', 'completed', JSON_OBJECT('synthetic', TRUE), UTC_TIMESTAMP(3))`
    );
    operationId = operation.insertId.toString();
    await database.execute(
      `INSERT INTO market_listings (id, seller_player_id, asset_type_code, item_id, inventory_instance_id, quantity, price_currency_code, price_amount, status, version, created_at, closed_at)
       VALUES (900000099, 900000001, 'stack', 900000001, NULL, 2, 'point', 350000000.000, 'sold', 2, '2026-08-24 15:00:00.000', '2026-08-24 15:30:00.000')`
    );
    await database.execute(
      `INSERT INTO market_settlements (operation_id, listing_id, buyer_player_id, gross_amount, fee_amount, net_amount, settled_at)
       VALUES (?, 900000099, 900000002, 350000000.000, 24500000.000, 325500000.000, '2026-08-24 15:30:00.000')`,
      [operationId]
    );
    await database.execute(
      `INSERT INTO market_events (listing_id, operation_id, event_code, detail_json, created_at)
       VALUES (900000099, ?, 'sold', JSON_OBJECT('feeBasisPoints', '700'), '2026-08-24 15:30:00.000')`,
      [operationId]
    );
  });

  after(async () => {
    if (database === undefined) return;
    await database.execute("DELETE FROM market_events WHERE listing_id = 900000099");
    await database.execute("DELETE FROM market_settlements WHERE listing_id = 900000099");
    await database.execute("DELETE FROM market_listings WHERE id = 900000099");
    if (operationId !== "") await database.execute("DELETE FROM operations WHERE id = ?", [operationId]);
    await database.close();
  });

  it("reads a sold settlement without mutating market state", async () => {
    const beforeRows = await database.query<Array<{ total: bigint }>>(
      "SELECT COUNT(*) AS total FROM market_settlements"
    );
    const message = await handleFreeMarketHistoryCommand(
      "/자유시장거래현황",
      new MariaFreeMarketHistoryRepository(database)
    );
    const afterRows = await database.query<Array<{ total: bigint }>>(
      "SELECT COUNT(*) AS total FROM market_settlements"
    );
    assert.match(message!, /합성 당근/);
    assert.match(message!, /🅟350,000,000\(3\.5억\)/);
    assert.match(message!, /자회원🏪\(수수료 7%\)/);
    assert.match(message!, /08\/25 00:30/);
    assert.equal(afterRows[0]!.total, beforeRows[0]!.total);
  });
});
